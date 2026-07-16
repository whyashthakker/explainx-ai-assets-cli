import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import axios from "axios";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getVaultCacheDirectory } from "./config.js";
import type { VaultConnection, VaultLock, VaultProvider } from "./vault-types.js";

const exec = promisify(execFile);

async function readRevision(root: string): Promise<number> {
  try { return (await fs.readJson(path.join(root, "epx-vault.lock")) as VaultLock).revision ?? 0; }
  catch { return 0; }
}

async function assertNoCloudConflicts(root: string): Promise<void> {
  if (!(await fs.pathExists(root))) return;
  const conflicts: string[] = [];
  const placeholders: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (/(conflicted copy|conflict|duplicate)/i.test(entry.name)) conflicts.push(file);
      if (/\.icloud$/i.test(entry.name)) placeholders.push(file);
      if (entry.isDirectory()) await walk(file);
    }
  }
  await walk(root);
  if (conflicts.length) throw new Error(`cloud conflict copies detected: ${conflicts.map((file) => path.relative(root, file)).join(", ")}`);
  if (placeholders.length) throw new Error(`cloud placeholder files are not fully synchronized: ${placeholders.map((file) => path.relative(root, file)).join(", ")}`);
}

async function replaceDirectoryAtomically(source: string, destination: string, expectedRevision: number): Promise<void> {
  await assertNoCloudConflicts(destination);
  const actual = await readRevision(destination);
  if (actual !== expectedRevision) throw new Error(`stale vault revision: expected ${expectedRevision}, found ${actual}; sync before publishing`);
  await fs.ensureDir(path.dirname(destination));
  const staging = `${destination}.epx-tmp-${process.pid}`;
  const backup = `${destination}.epx-backup-${process.pid}`;
  await fs.remove(staging);
  await fs.copy(source, staging, { dereference: false });
  try {
    if (await fs.pathExists(destination)) await fs.move(destination, backup);
    await fs.move(staging, destination);
    await fs.remove(backup);
  } catch (error) {
    if (!(await fs.pathExists(destination)) && await fs.pathExists(backup)) await fs.move(backup, destination);
    throw error;
  } finally { await fs.remove(staging); }
}

export class FolderVaultProvider implements VaultProvider {
  readonly kind = "folder" as const;
  async prepare(connection: VaultConnection): Promise<string> {
    const location = path.resolve(connection.location.replace(/^~(?=$|\/)/, os.homedir()));
    if (!(await fs.pathExists(location))) throw new Error(`vault folder is unavailable or not fully synchronized: ${location}`);
    await assertNoCloudConflicts(location);
    const stat = await fs.stat(location);
    if (!stat.isDirectory()) throw new Error(`vault location is not a directory: ${location}`);
    return location;
  }
  async publish(connection: VaultConnection, localRoot: string, expectedRevision: number): Promise<void> {
    await replaceDirectoryAtomically(localRoot, path.resolve(connection.location.replace(/^~(?=$|\/)/, os.homedir())), expectedRevision);
  }
}

async function git(args: string[], cwd?: string): Promise<string> {
  try { return (await exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 })).stdout.trim(); }
  catch (error) { throw new Error(`git failed: ${error instanceof Error ? error.message : String(error)}`); }
}

export class GitVaultProvider implements VaultProvider {
  readonly kind = "git" as const;
  async prepare(connection: VaultConnection): Promise<string> {
    const root = path.join(getVaultCacheDirectory(), connection.name);
    if (await fs.pathExists(path.join(root, ".git"))) {
      await git(["pull", "--ff-only"], root);
    } else {
      await fs.ensureDir(getVaultCacheDirectory());
      await git(["clone", "--", connection.location, root]);
    }
    return root;
  }
  async publish(connection: VaultConnection, localRoot: string, expectedRevision: number): Promise<void> {
    const checkout = await this.prepare(connection);
    const actual = await readRevision(checkout);
    if (actual !== expectedRevision) throw new Error(`stale vault revision: expected ${expectedRevision}, found ${actual}; sync before publishing`);
    for (const entry of await fs.readdir(checkout)) if (entry !== ".git") await fs.remove(path.join(checkout, entry));
    for (const entry of await fs.readdir(localRoot)) if (entry !== ".git") await fs.copy(path.join(localRoot, entry), path.join(checkout, entry));
    await git(["add", "--all"], checkout);
    if (!(await git(["status", "--porcelain"], checkout))) return;
    await git(["commit", "-m", "chore(vault): publish EPX assets"], checkout);
    await git(["push"], checkout);
  }
}

async function mcpCall(connection: VaultConnection, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tokenName = `EPX_VAULT_TOKEN_${connection.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const token = process.env[tokenName];
  const response = await axios.post(connection.location, { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }, {
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, timeout: 60_000
  });
  if (response.data?.error) throw new Error(`MCP vault error: ${response.data.error.message ?? "request failed"}`);
  const text = response.data?.result?.content?.find?.((item: { type?: string }) => item.type === "text")?.text;
  return text ? JSON.parse(text) : response.data?.result?.structuredContent;
}

export class McpVaultProvider implements VaultProvider {
  readonly kind = "mcp" as const;
  async prepare(connection: VaultConnection): Promise<string> {
    const payload = await mcpCall(connection, "vault_get_snapshot", {}) as { files: Record<string, string> };
    if (!payload?.files) throw new Error("MCP vault returned an invalid snapshot");
    const root = path.join(getVaultCacheDirectory(), connection.name);
    await fs.remove(root); await fs.ensureDir(root);
    for (const [relative, base64] of Object.entries(payload.files)) {
      const output = path.resolve(root, relative);
      if (!output.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("MCP vault returned an unsafe path");
      await fs.ensureDir(path.dirname(output)); await fs.writeFile(output, Buffer.from(base64, "base64"));
    }
    return root;
  }
  async publish(connection: VaultConnection, localRoot: string, expectedRevision: number): Promise<void> {
    const files: Record<string, string> = {};
    async function walk(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else files[path.relative(localRoot, file)] = (await fs.readFile(file)).toString("base64");
      }
    }
    await walk(localRoot);
    await mcpCall(connection, "vault_put_snapshot", { expectedRevision, files });
  }
}

export function providerFor(connection: VaultConnection): VaultProvider {
  if (connection.provider === "git") return new GitVaultProvider();
  if (connection.provider === "mcp") return new McpVaultProvider();
  return new FolderVaultProvider();
}

export const providerInternals = { readRevision, assertNoCloudConflicts, replaceDirectoryAtomically };
