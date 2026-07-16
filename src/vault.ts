import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fs from "fs-extra";
import YAML from "yaml";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { input, select } from "@inquirer/prompts";
import { auditPackage, severityWeight, type AuditReport } from "./audit.js";
import { getPackagesDirectory } from "./config.js";
import { connectVault, getVaultConnection, readVaultConnections } from "./vault-config.js";
import { providerFor } from "./vault-providers.js";
import { validatePackage } from "./manifest.js";
import { registerPackage } from "./registry.js";
import type { InstalledPackage } from "./types.js";
import { AGENTS, installToAgents, isAgentName, type AgentInstallSelection, type AgentName } from "./agents.js";
import { installRuleToAgents, supportsRules } from "./rules.js";
import { installPrompts, supportsPromptTarget } from "./prompts.js";
import { installAgentAssets, supportsAgentTarget } from "./agent-assets.js";
import type { VaultApproval, VaultConnection, VaultLock, VaultManifest, VaultPolicy, VaultProviderKind } from "./vault-types.js";

const exec = promisify(execFile);
const DEFAULT_POLICY: VaultPolicy = { reviewers: [], approvalsRequired: 1, blockSeverities: ["high", "critical"], preventSelfApproval: true };

function manifestPath(root: string): string { return path.join(root, "epx-vault.yaml"); }
function lockPath(root: string): string { return path.join(root, "epx-vault.lock"); }

async function readVault(root: string): Promise<{ manifest: VaultManifest; lock: VaultLock }> {
  if (!(await fs.pathExists(manifestPath(root)))) throw new Error(`not an EPX vault: ${root}`);
  const manifest = YAML.parse(await fs.readFile(manifestPath(root), "utf8")) as VaultManifest;
  if (manifest?.schemaVersion !== 1 || !manifest.name || !manifest.policy) throw new Error("invalid epx-vault.yaml");
  const lock: VaultLock = await fs.pathExists(lockPath(root)) ? await fs.readJson(lockPath(root)) as VaultLock : { schemaVersion: 1, revision: 0, assets: {} };
  if (lock?.schemaVersion !== 1 || typeof lock.revision !== "number" || !lock.assets) throw new Error("invalid epx-vault.lock");
  return { manifest, lock };
}

export async function initVault(directory: string, name = path.basename(path.resolve(directory))): Promise<string> {
  const root = path.resolve(directory);
  await fs.ensureDir(root);
  if ((await fs.readdir(root)).length > 0) throw new Error("vault directory must be empty");
  const manifest: VaultManifest = { schemaVersion: 1, name, policy: DEFAULT_POLICY };
  const lock: VaultLock = { schemaVersion: 1, revision: 0, assets: {} };
  await fs.ensureDir(path.join(root, "assets")); await fs.ensureDir(path.join(root, "approvals"));
  await fs.writeFile(manifestPath(root), YAML.stringify(manifest)); await fs.writeJson(lockPath(root), lock, { spaces: 2 });
  return root;
}

export async function digestDirectory(root: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name.startsWith(".epx-tmp-")) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic links are not allowed in vault assets: ${path.relative(root, file)}`);
      if (entry.isDirectory()) await walk(file); else files.push(file);
    }
  }
  await walk(root); files.sort();
  for (const file of files) { hash.update(path.relative(root, file).split(path.sep).join("/")); hash.update("\0"); hash.update(await fs.readFile(file)); hash.update("\0"); }
  return hash.digest("hex");
}

async function copyAssetAtomically(source: string, destination: string): Promise<void> {
  const staging = `${destination}.epx-tmp-${process.pid}`;
  await fs.remove(staging); await fs.copy(source, staging, { dereference: false });
  await fs.remove(destination); await fs.move(staging, destination);
}

function publisherIdentity(): string {
  return process.env.EPX_IDENTITY || process.env.GIT_AUTHOR_EMAIL || process.env.USER || os.userInfo().username;
}

export interface PublishOptions { vault: string; allowRisk?: boolean; publisher?: string }
export async function publishToVault(source: string, options: PublishOptions): Promise<{ name: string; digest: string; report: AuditReport }> {
  const connection = await getVaultConnection(options.vault); const provider = providerFor(connection);
  const remoteRoot = await provider.prepare(connection); const { lock } = await readVault(remoteRoot);
  const sourceRoot = path.resolve(source); if (!(await fs.pathExists(sourceRoot))) throw new Error(`asset directory does not exist: ${source}`);
  const validation = await validatePackage(sourceRoot); const report = await auditPackage(sourceRoot);
  if (!options.allowRisk && severityWeight[report.summary.highestRisk] >= severityWeight.high && ["high", "critical"].includes(report.summary.highestRisk)) {
    throw new Error(`publication blocked: audit risk is ${report.summary.highestRisk}; review findings before publishing`);
  }
  const digest = await digestDirectory(sourceRoot); const staging = await fs.mkdtemp(path.join(os.tmpdir(), "epx-vault-publish-"));
  try {
    await fs.copy(remoteRoot, staging, { filter: (file) => path.basename(file) !== ".git" });
    await copyAssetAtomically(sourceRoot, path.join(staging, "assets", validation.manifest.name));
    await fs.remove(path.join(staging, "approvals", validation.manifest.name));
    const next: VaultLock = { ...lock, revision: lock.revision + 1, assets: { ...lock.assets, [validation.manifest.name]: {
      name: validation.manifest.name, version: validation.manifest.version, type: validation.manifest.type, digest,
      publisher: options.publisher ?? publisherIdentity(), publishedAt: new Date().toISOString(), auditRisk: report.summary.highestRisk
    } } };
    await fs.writeJson(lockPath(staging), next, { spaces: 2 }); await provider.publish(connection, staging, lock.revision);
  } finally { await fs.remove(staging); }
  return { name: validation.manifest.name, digest, report };
}

function approvalPayload(asset: string, digest: string, reviewer: string): string { return `epx-vault-approval-v1\n${asset}\n${digest}\n${reviewer}\n`; }

async function sshSign(payload: string, privateKey: string): Promise<string> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "epx-sign-")); const file = path.join(temporary, "payload");
  try { await fs.writeFile(file, payload); await exec("ssh-keygen", ["-Y", "sign", "-f", privateKey, "-n", "epx-vault", file]); return (await fs.readFile(`${file}.sig`)).toString("base64"); }
  catch (error) { throw new Error(`could not sign approval: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await fs.remove(temporary); }
}

async function verifyApproval(approval: VaultApproval, policy: VaultPolicy): Promise<boolean> {
  const reviewer = policy.reviewers.find((item) => item.id === approval.reviewer); if (!reviewer) return false;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "epx-verify-"));
  try {
    const allowed = path.join(temporary, "allowed_signers"); const signature = path.join(temporary, "signature");
    await fs.writeFile(allowed, `${reviewer.id} ${reviewer.publicKey.trim()}\n`); await fs.writeFile(signature, Buffer.from(approval.signature, "base64"));
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ssh-keygen", ["-Y", "verify", "-f", allowed, "-I", reviewer.id, "-n", "epx-vault", "-s", signature], { stdio: ["pipe", "ignore", "ignore"] });
      child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`ssh-keygen exited ${code}`)));
      child.stdin.end(approvalPayload(approval.asset, approval.digest, approval.reviewer));
    });
    return true;
  } catch { return false; } finally { await fs.remove(temporary); }
}

export async function approveVaultAsset(vaultName: string, asset: string, reviewer: string, privateKey: string): Promise<VaultApproval> {
  const connection = await getVaultConnection(vaultName); const provider = providerFor(connection); const root = await provider.prepare(connection);
  const { manifest, lock } = await readVault(root); const entry = lock.assets[asset]; if (!entry) throw new Error(`asset '${asset}' is not in vault '${vaultName}'`);
  if (!manifest.policy.reviewers.some((item) => item.id === reviewer)) throw new Error(`'${reviewer}' is not a named vault reviewer`);
  if (manifest.policy.preventSelfApproval && entry.publisher === reviewer) throw new Error("publishers cannot approve their own asset version");
  const approval: VaultApproval = { schemaVersion: 1, asset, digest: entry.digest, reviewer, approvedAt: new Date().toISOString(), signature: await sshSign(approvalPayload(asset, entry.digest, reviewer), path.resolve(privateKey.replace(/^~(?=$|\/)/, os.homedir()))) };
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "epx-vault-approve-"));
  try {
    await fs.copy(root, staging, { filter: (file) => path.basename(file) !== ".git" });
    await fs.outputJson(path.join(staging, "approvals", asset, entry.digest, `${reviewer}.json`), approval, { spaces: 2 });
    const next = { ...lock, revision: lock.revision + 1 }; await fs.writeJson(lockPath(staging), next, { spaces: 2 }); await provider.publish(connection, staging, lock.revision);
  } finally { await fs.remove(staging); }
  return approval;
}

async function validApprovals(root: string, manifest: VaultManifest, asset: string, digest: string): Promise<VaultApproval[]> {
  const directory = path.join(root, "approvals", asset, digest); if (!(await fs.pathExists(directory))) return [];
  const approvals: VaultApproval[] = [];
  for (const name of await fs.readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    try { const approval = await fs.readJson(path.join(directory, name)) as VaultApproval; if (approval.asset === asset && approval.digest === digest && await verifyApproval(approval, manifest.policy)) approvals.push(approval); } catch { /* invalid approvals do not count */ }
  }
  return approvals;
}

export async function syncVault(vaultName: string, dryRun = false): Promise<{ installed: string[]; pending: string[] }> {
  const connection = await getVaultConnection(vaultName); const root = await providerFor(connection).prepare(connection); const { manifest, lock } = await readVault(root);
  const installed: string[] = []; const pending: string[] = [];
  for (const entry of Object.values(lock.assets)) {
    const source = path.join(root, "assets", entry.name); if (!(await fs.pathExists(source))) throw new Error(`vault asset is unavailable or partially synchronized: ${entry.name}`);
    if (await digestDirectory(source) !== entry.digest) throw new Error(`vault asset digest mismatch: ${entry.name}`);
    if ((await validApprovals(root, manifest, entry.name, entry.digest)).length < manifest.policy.approvalsRequired) { pending.push(entry.name); continue; }
    if (manifest.policy.blockSeverities.includes(entry.auditRisk as "high" | "critical")) { pending.push(entry.name); continue; }
    if (dryRun) { installed.push(entry.name); continue; }
    const validated = await validatePackage(source);
    const targets = (validated.manifest.targets ?? []).filter((target): target is AgentName => isAgentName(target) && Boolean(AGENTS[target].globalDirectory))
      .filter((target) => entry.type === "rule" ? supportsRules(target) : entry.type === "command" || entry.type === "prompt" ? supportsPromptTarget(target) : entry.type === "agent" ? supportsAgentTarget(target) : true);
    const receiptsPath = path.join(path.dirname(getPackagesDirectory()), "vault-installs.json");
    const receipts = await fs.pathExists(receiptsPath) ? await fs.readJson(receiptsPath) as Record<string, { destinations: Record<string, string> }> : {};
    const receiptKey = `${vaultName}:${entry.name}`; const previous = receipts[receiptKey];
    if (previous) {
      let conflict = false;
      for (const [destination, digest] of Object.entries(previous.destinations)) if (!(await fs.pathExists(destination)) || await digestDirectoryOrFile(destination) !== digest) { conflict = true; break; }
      if (conflict) { pending.push(`${entry.name} (local changes)`); continue; }
    }
    await copyAssetAtomically(source, path.join(getPackagesDirectory(), entry.name));
    const pkg: InstalledPackage = { ...validated.manifest, source: connection.location, installedAt: new Date().toISOString(), vault: vaultName, vaultProvider: connection.provider, digest: entry.digest, approvedDigest: entry.digest, installedTargets: targets, installedScope: "global" };
    await registerPackage(pkg);
    if (targets.length) {
      const selection: AgentInstallSelection = { agents: targets, scope: "global" };
      const destinations = entry.type === "rule" ? await installRuleToAgents(pkg, selection)
        : entry.type === "command" || entry.type === "prompt" ? await installPrompts(pkg, selection)
        : entry.type === "agent" ? await installAgentAssets(pkg, selection)
        : await installToAgents(pkg, selection);
      receipts[receiptKey] = { destinations: Object.fromEntries(await Promise.all(destinations.map(async (destination) => [destination, await digestDirectoryOrFile(destination)]))) };
      await fs.outputJson(receiptsPath, receipts, { spaces: 2, mode: 0o600 });
    }
    installed.push(entry.name);
  }
  return { installed, pending };
}

async function digestDirectoryOrFile(target: string): Promise<string> {
  if ((await fs.stat(target)).isDirectory()) return digestDirectory(target);
  return crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex");
}

export async function auditVaultAsset(vaultName: string, asset: string): Promise<AuditReport> {
  const connection = await getVaultConnection(vaultName); const root = await providerFor(connection).prepare(connection);
  const directory = path.join(root, "assets", asset); if (!(await fs.pathExists(directory))) throw new Error(`asset '${asset}' is not in vault '${vaultName}'`);
  return auditPackage(directory);
}

export async function vaultStatus(vaultName: string): Promise<{ connection: VaultConnection; revision: number; assets: Array<{ name: string; status: string; risk: string }> }> {
  const connection = await getVaultConnection(vaultName); const root = await providerFor(connection).prepare(connection); const { manifest, lock } = await readVault(root);
  const assets = [];
  for (const entry of Object.values(lock.assets)) assets.push({ name: entry.name, risk: entry.auditRisk, status: (await validApprovals(root, manifest, entry.name, entry.digest)).length >= manifest.policy.approvalsRequired ? "approved" : "pending" });
  return { connection, revision: lock.revision, assets };
}

export interface CloudFolder { service: "Google Drive" | "iCloud Drive" | "Dropbox" | "OneDrive"; path: string }
export async function detectCloudFolders(home = os.homedir(), platform = process.platform): Promise<CloudFolder[]> {
  const candidates: CloudFolder[] = [];
  const addMatches = async (service: CloudFolder["service"], parent: string, pattern: RegExp): Promise<void> => {
    if (!(await fs.pathExists(parent))) return;
    for (const name of await fs.readdir(parent)) if (pattern.test(name) && (await fs.stat(path.join(parent, name))).isDirectory()) candidates.push({ service, path: path.join(parent, name) });
  };
  if (platform === "darwin") {
    await addMatches("Google Drive", path.join(home, "Library/CloudStorage"), /^GoogleDrive-/i); await addMatches("Dropbox", path.join(home, "Library/CloudStorage"), /^Dropbox/i); await addMatches("OneDrive", path.join(home, "Library/CloudStorage"), /^OneDrive/i);
    const icloud = path.join(home, "Library/Mobile Documents/com~apple~CloudDocs"); if (await fs.pathExists(icloud)) candidates.push({ service: "iCloud Drive", path: icloud });
  } else if (platform === "win32") {
    for (const [service, variable] of [["Google Drive", "GoogleDrive"], ["Dropbox", "Dropbox"], ["OneDrive", "OneDrive"]] as const) if (process.env[variable] && await fs.pathExists(process.env[variable]!)) candidates.push({ service, path: process.env[variable]! });
  } else {
    for (const [service, folder] of [["Google Drive", "Google Drive"], ["Dropbox", "Dropbox"], ["OneDrive", "OneDrive"]] as const) { const candidate = path.join(home, folder); if (await fs.pathExists(candidate)) candidates.push({ service, path: candidate }); }
  }
  return candidates;
}

export async function interactiveConnectVault(): Promise<VaultConnection> {
  const provider = await select<VaultProviderKind | "cloud">({ message: "Which vault provider do you want to use?", choices: [
    { name: "Private Git repository", value: "git" }, { name: "Google Drive / iCloud / Dropbox / OneDrive", value: "cloud" }, { name: "Local or network folder", value: "folder" }, { name: "MCP server", value: "mcp" }
  ] });
  let location: string; let actual: VaultProviderKind = provider === "cloud" ? "folder" : provider;
  if (provider === "cloud") {
    const folders = await detectCloudFolders();
    location = folders.length ? await select({ message: "Which synchronized cloud folder?", choices: [...folders.map((folder) => ({ name: `${folder.service} (${folder.path})`, value: folder.path })), { name: "Enter another path", value: "" }] }) : "";
    if (!location) location = await input({ message: "Cloud folder path" });
  } else location = await input({ message: provider === "git" ? "Git repository URL" : provider === "mcp" ? "MCP server URL" : "Vault folder path" });
  const name = await input({ message: "Vault name", default: path.basename(location).replace(/\.git$/, "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "vault" });
  return connectVault(name, actual, location);
}

export async function listVaults(): Promise<VaultConnection[]> { return Object.values((await readVaultConnections()).vaults); }
