#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { addCommand, auditCommand, listCommand, removeCommand, updateCommand, validateCommand } from "./commands.js";
import type { AuditSeverity } from "./audit.js";
import { ADDITIONAL_AGENT_NAMES, AGENTS, type AgentName, type InstallScope } from "./agents.js";
import { printBanner } from "./banner.js";
import { RULE_TARGET_NAMES } from "./rules.js";
import { addMcpUrl, MCP_TARGETS } from "./mcp.js";
import { PROMPT_TARGET_NAMES } from "./prompts.js";
import { AGENT_TARGET_NAMES } from "./agent-assets.js";
import { installContextPacks, installTemplates } from "./simple-assets.js";
import { addSourceToVault, approveVaultAsset, approveWithLocalProfile, auditVaultAsset, initVault, interactiveConnectVault, listVaults, localApprovalContext, publishToVault, setupCloudFolderVault, syncVault, vaultStatus, type CloudVaultChoice } from "./vault.js";
import { connectVault } from "./vault-config.js";
import type { VaultProviderKind } from "./vault-types.js";
import { ensureProfile, readProfile, saveProfile } from "./profile.js";

printBanner();

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const program = new Command()
  .name("epx")
  .description("ExplainX Package Exchange - install AI assets from GitHub")
  .version(packageJson.version);

program.command("add")
  .description("Install an AI asset from a GitHub repository")
  .argument("<owner/repo>", "GitHub repository")
  .option("-s, --skill <name>", "skill to install when the repository contains multiple skills")
  .option("-r, --rule <name>", "rule to install from any supported rules layout")
  .option("-c, --command <name>", "command to install from a GitHub repository")
  .option("-p, --prompt <name>", "prompt to install from a GitHub repository")
  .option("-t, --target <agent...>", "target agent ID (73 agents supported)")
  .option("--codex", "install for Codex")
  .option("--claude-code", "install for Claude Code")
  .option("--cursor", "install for Cursor")
  .option("--gemini", "install for Gemini CLI")
  .option("--copilot", "install for GitHub Copilot")
  .option("--all-agents", "install for every supported agent")
  .option("-g, --global", "install globally instead of in the current project")
  .action((source: string, options: {
    target?: AgentName[];
    codex?: boolean;
    claudeCode?: boolean;
    cursor?: boolean;
    gemini?: boolean;
    copilot?: boolean;
    allAgents?: boolean;
    global?: boolean;
    skill?: string;
    rule?: string;
    command?: string;
    prompt?: string;
  }) => addCommand(source, {
    targets: [
      ...(options.allAgents
        ? options.rule
          ? RULE_TARGET_NAMES
          : options.command || options.prompt
            ? PROMPT_TARGET_NAMES
          : ADDITIONAL_AGENT_NAMES.filter((name) => !options.global || Boolean(AGENTS[name].globalDirectory))
        : []),
      ...(options.target ?? []),
      ...(options.codex ? ["codex" as const] : []),
      ...(options.claudeCode ? ["claude-code" as const] : []),
      ...(options.cursor ? ["cursor" as const] : []),
      ...(options.gemini ? ["gemini-cli" as const] : []),
      ...(options.copilot ? ["github-copilot" as const] : [])
    ],
    scope: options.global ? "global" as InstallScope : undefined,
    interactive: true,
    skill: options.skill,
    rule: options.rule,
    command: options.command,
    prompt: options.prompt
  }));

program.command("list")
  .alias("ls")
  .description("List installed AI assets")
  .action(listCommand);

interface PromptAddCliOptions {
  target?: string[];
  codex?: boolean;
  claudeCode?: boolean;
  cursor?: boolean;
  gemini?: boolean;
  copilot?: boolean;
  allAgents?: boolean;
  global?: boolean;
}

function promptTargets(options: PromptAddCliOptions): string[] {
  return [
    ...(options.allAgents ? PROMPT_TARGET_NAMES : []),
    ...(options.target ?? []),
    ...(options.codex ? ["codex"] : []),
    ...(options.claudeCode ? ["claude-code"] : []),
    ...(options.cursor ? ["cursor"] : []),
    ...(options.gemini ? ["gemini-cli"] : []),
    ...(options.copilot ? ["github-copilot"] : [])
  ];
}

function configurePromptAdd(command: Command, type: "command" | "prompt"): void {
  command
    .argument("<owner/repo>", "GitHub repository")
    .argument("[name]", `${type} name; omit to browse detected ${type}s`)
    .option("-t, --target <agent...>", "target agent")
    .option("--codex", "install for Codex")
    .option("--claude-code", "install for Claude Code")
    .option("--cursor", "install for Cursor")
    .option("--gemini", "install for Gemini CLI")
    .option("--copilot", "install for GitHub Copilot")
    .option("--all-agents", "install for every supported prompt client")
    .option("-g, --global", "install globally instead of in the current project")
    .action((source: string, name: string | undefined, options: PromptAddCliOptions) => addCommand(source, {
      assetType: type,
      ...(type === "command" ? { command: name } : { prompt: name }),
      targets: promptTargets(options),
      scope: options.global ? "global" : undefined,
      interactive: true
    }));
}

const prompt = program.command("prompt").description("Install reusable prompts from GitHub");
configurePromptAdd(prompt.command("add").description("Install one or more prompts"), "prompt");

const cmd = program.command("cmd").alias("command").description("Install reusable commands from GitHub");
configurePromptAdd(cmd.command("add").description("Install one or more commands"), "command");

const agent = program.command("agent").description("Install custom agents and subagents from GitHub");
agent.command("add")
  .description("Install one or more custom agents")
  .argument("<owner/repo>", "GitHub repository")
  .argument("[name]", "agent name; omit to browse detected agents")
  .option("-t, --target <client...>", "target AI client")
  .option("--claude-code", "install for Claude Code")
  .option("--gemini", "install for Gemini CLI")
  .option("--copilot", "install for GitHub Copilot")
  .option("--all-agents", "install for every supported custom-agent client")
  .option("-g, --global", "install globally instead of in the current project")
  .action((source: string, name: string | undefined, options: { target?: string[]; claudeCode?: boolean; gemini?: boolean; copilot?: boolean; allAgents?: boolean; global?: boolean }) => addCommand(source, {
    agentAsset: true,
    agent: name,
    targets: [...(options.allAgents ? AGENT_TARGET_NAMES : []), ...(options.target ?? []), ...(options.claudeCode ? ["claude-code"] : []), ...(options.gemini ? ["gemini-cli"] : []), ...(options.copilot ? ["github-copilot"] : [])],
    scope: options.global ? "global" : undefined,
    interactive: true
  }));

const instruction = program.command("instruction").alias("instructions").description("Install persistent instructions from GitHub");
instruction.command("add")
  .description("Install one or more instruction files")
  .argument("<owner/repo>", "GitHub repository")
  .argument("[name]", "instruction name; omit to browse detected instructions")
  .option("-t, --target <agent...>", "target agent")
  .option("--codex", "install for Codex")
  .option("--claude-code", "install for Claude Code")
  .option("--cursor", "install for Cursor")
  .option("--all-agents", "install for every supported instruction client")
  .option("-g, --global", "install globally instead of in the current project")
  .action((source: string, name: string | undefined, options: { target?: string[]; codex?: boolean; claudeCode?: boolean; cursor?: boolean; allAgents?: boolean; global?: boolean }) => addCommand(source, {
    ruleAsset: true,
    rule: name,
    targets: [...(options.allAgents ? RULE_TARGET_NAMES : []), ...(options.target ?? []), ...(options.codex ? ["codex"] : []), ...(options.claudeCode ? ["claude-code"] : []), ...(options.cursor ? ["cursor"] : [])],
    scope: options.global ? "global" : undefined,
    interactive: true
  }));

const template = program.command("template").description("Install project templates from GitHub");
template.command("add")
  .description("Copy a template into the current project without overwriting files")
  .argument("<owner/repo>", "GitHub repository")
  .argument("[name]", "template name; omit to browse templates")
  .action(async (source: string, name?: string) => {
    const installed = await installTemplates(source, name);
    console.log(installed.length ? `✔ Installed template${installed.length === 1 ? "" : "s"}: ${installed.join(", ")}` : "Installation cancelled.");
  });

const context = program.command("context").description("Install agent context and knowledge packs from GitHub");
context.command("add")
  .description("Install context and link it from agent instruction files")
  .argument("<owner/repo>", "GitHub repository")
  .argument("[name]", "context pack name; omit to browse packs")
  .action(async (source: string, name?: string) => {
    const installed = await installContextPacks(source, name);
    console.log(installed.length ? `✔ Installed context pack${installed.length === 1 ? "" : "s"}: ${installed.join(", ")}` : "Installation cancelled.");
  });

const mcp = program.command("mcp").description("Install and manage Model Context Protocol servers");
mcp.command("add")
  .description("Install a remote MCP server URL for one or more AI agents")
  .argument("<url>", "Streamable HTTP or SSE MCP server URL")
  .option("-n, --name <name>", "server name (defaults to the URL hostname)")
  .option("-t, --target <agent...>", "target MCP client")
  .option("--codex", "install for Codex")
  .option("--claude-code", "install for Claude Code")
  .option("--cursor", "install for Cursor")
  .option("--gemini", "install for Gemini CLI")
  .option("--copilot", "install for GitHub Copilot")
  .option("--all-agents", "install for every supported MCP client")
  .action(async (url: string, options: { name?: string; target?: string[]; codex?: boolean; claudeCode?: boolean; cursor?: boolean; gemini?: boolean; copilot?: boolean; allAgents?: boolean }) => {
    const targets = [
      ...(options.allAgents ? Object.keys(MCP_TARGETS) : []),
      ...(options.target ?? []),
      ...(options.codex ? ["codex"] : []),
      ...(options.claudeCode ? ["claude-code"] : []),
      ...(options.cursor ? ["cursor"] : []),
      ...(options.gemini ? ["gemini-cli"] : []),
      ...(options.copilot ? ["github-copilot"] : [])
    ];
    const destinations = await addMcpUrl(url, { name: options.name, targets, scope: "global", interactive: true });
    if (destinations.length === 0) { console.log("Installation cancelled."); return; }
    console.log(`\n✔ Installed MCP server in ${destinations.length} configuration${destinations.length === 1 ? "" : "s"}`);
    for (const destination of destinations) console.log(`  → ${destination}`);
  });

const vault = program.command("vault").description("Manage private, audited AI asset vaults");

const profile = program.command("profile").description("Manage the local EPX identity");
profile.command("set")
  .description("Create or update the local profile")
  .requiredOption("--name <name>", "display name")
  .requiredOption("--email <email>", "email address")
  .action(async (options: { name: string; email: string }) => { const saved = await saveProfile(options.name, options.email); console.log(`✔ Saved EPX profile for ${saved.name} <${saved.email}>`); });
profile.command("show").description("Show the local profile").action(async () => {
  const saved = await readProfile(); if (!saved) { console.log("No EPX profile configured."); return; }
  console.log(`${saved.name} <${saved.email}>\nID: ${saved.id}`);
});

interface CloudInitOptions { dropbox?: boolean; googleDrive?: boolean; onedrive?: boolean; icloud?: boolean; local?: boolean }
function selectedCloud(options: CloudInitOptions): CloudVaultChoice | undefined {
  const selected: CloudVaultChoice[] = [
    ...(options.dropbox ? ["Dropbox" as const] : []), ...(options.googleDrive ? ["Google Drive" as const] : []),
    ...(options.onedrive ? ["OneDrive" as const] : []), ...(options.icloud ? ["iCloud Drive" as const] : []),
    ...(options.local ? ["Local/network folder" as const] : [])
  ];
  if (selected.length > 1) throw new Error("choose only one cloud provider flag");
  return selected[0];
}

const init = program.command("init").description("Initialize EPX resources");
init.command("vault")
  .description("Create and connect a synchronized-folder vault")
  .argument("<name>", "vault name")
  .option("--dropbox", "use the locally synchronized Dropbox client")
  .option("--google-drive", "use the locally synchronized Google Drive client")
  .option("--onedrive", "use the locally synchronized OneDrive client")
  .option("--icloud", "use the locally synchronized iCloud Drive folder")
  .option("--local", "use a local or network folder")
  .action(async (name: string, options: CloudInitOptions) => {
    await ensureProfile();
    const result = await setupCloudFolderVault(name, selectedCloud(options), true); console.log(`✔ Created and connected ${result.name}\n  → ${result.location}`);
  });

vault.command("init")
  .description("Create an EPX vault in an empty directory")
  .argument("[directory]", "vault directory", process.cwd())
  .option("-n, --name <name>", "vault name")
  .action(async (directory: string, options: { name?: string }) => { await ensureProfile(); console.log(`✔ Created vault at ${await initVault(directory, options.name)}`); });

vault.command("connect")
  .description("Connect a Git, synchronized-folder, or MCP vault")
  .argument("[name]", "local vault name")
  .argument("[location]", "Git URL, folder path, or MCP URL")
  .option("-p, --provider <provider>", "git, folder, or mcp")
  .action(async (name: string | undefined, location: string | undefined, options: { provider?: string }) => {
    if (!name && !location) { const result = await interactiveConnectVault(); console.log(`✔ Connected ${result.name} (${result.provider})`); return; }
    if (name && !location && !options.provider) { const result = await setupCloudFolderVault(name); console.log(`✔ Connected ${result.name}\n  → ${result.location}`); return; }
    if (!name || !location) throw new Error("connect requires both <name> and <location>");
    const inferred = options.provider ?? (/^https?:\/\/.+\/mcp(?:\/)?$/i.test(location) ? "mcp" : /^(?:git@|ssh:\/\/)|\.git$/i.test(location) ? "git" : "folder");
    if (!["git", "folder", "mcp"].includes(inferred)) throw new Error("provider must be git, folder, or mcp");
    const result = await connectVault(name, inferred as VaultProviderKind, location); console.log(`✔ Connected ${result.name} (${result.provider})`);
  });

vault.command("list").alias("ls").description("List connected vaults").action(async () => {
  const connections = await listVaults(); if (!connections.length) { console.log("No vaults connected."); return; }
  for (const item of connections) console.log(`${item.name}\t${item.provider}\t${item.location}`);
});

vault.command("add")
  .description("Download an AI asset directly into a vault without installing it locally")
  .argument("<owner/repo>", "GitHub repository")
  .requiredOption("--vault <name>", "connected vault")
  .option("--skill <name>", "skill name for repositories containing multiple skills")
  .option("--rule <name>", "rule name")
  .option("--command <name>", "command name")
  .option("--prompt <name>", "prompt name")
  .option("--agent <name>", "custom agent name")
  .option("--block-risk", "reject high or critical heuristic findings during publication")
  .action(async (source: string, options: { vault: string; skill?: string; rule?: string; command?: string; prompt?: string; agent?: string; blockRisk?: boolean }) => {
    await ensureProfile();
    console.log(`◇ Downloading ${source}`);
    const result = await addSourceToVault(source, { vault: options.vault, blockRisk: options.blockRisk }, {
      skill: options.skill, rule: options.rule, ruleAsset: Boolean(options.rule), command: options.command, prompt: options.prompt,
      assetType: options.prompt ? "prompt" : options.command ? "command" : undefined, agent: options.agent, agentAsset: Boolean(options.agent)
    }, { downloaded: () => console.log("✔ Downloaded"), validated: () => console.log("✔ Package validated"), publishing: () => console.log("◇ Auditing and publishing to vault") });
    console.log(`✔ Added ${result.name} directly to vault '${options.vault}'\n  digest: ${result.digest}\n  risk: ${result.report.summary.highestRisk}\n  status: pending approval`);
  });

vault.command("publish")
  .description("Audit and publish a package for reviewer approval")
  .argument("<source>", "local EPX package directory")
  .requiredOption("--vault <name>", "connected vault")
  .option("--block-risk", "reject high or critical heuristic findings during publication")
  .action(async (source: string, options: { vault: string; blockRisk?: boolean }) => {
    await ensureProfile();
    const result = await publishToVault(source, options); console.log(`✔ Published ${result.name}\n  digest: ${result.digest}\n  risk: ${result.report.summary.highestRisk}\n  status: pending approval`);
  });

vault.command("approve")
  .description("Sign approval for an exact asset digest")
  .argument("<asset>", "asset name")
  .requiredOption("--vault <name>", "connected vault")
  .option("--reviewer <identity>", "advanced: reviewer identity from vault policy")
  .option("--key <path>", "advanced: SSH private key used to sign")
  .action(async (asset: string, options: { vault: string; reviewer?: string; key?: string }) => {
    if (Boolean(options.reviewer) !== Boolean(options.key)) throw new Error("--reviewer and --key must be used together");
    if (options.reviewer && options.key) {
      const approval = await approveVaultAsset(options.vault, asset, options.reviewer, options.key); console.log(`✔ Approved ${asset}\n  digest: ${approval.digest}\n  reviewer: ${approval.reviewer}`); return;
    }
    await ensureProfile(); const context = await localApprovalContext(options.vault, asset);
    let allowSelfApproval = false;
    if (context.selfPublished) {
      allowSelfApproval = await confirm({ message: `You published '${asset}' and its audit risk is ${context.risk}. Self-approve this exact digest anyway?`, default: false });
      if (!allowSelfApproval) { console.log("Approval cancelled."); return; }
    }
    const result = await approveWithLocalProfile(options.vault, asset, allowSelfApproval);
    console.log(`✔ Approved ${asset}\n  digest: ${result.approval.digest}\n  reviewer: local profile${result.selfApproved ? " (owner self-approval)" : ""}`);
  });

vault.command("audit")
  .description("Audit an asset held in a connected vault")
  .argument("<asset>", "asset name")
  .requiredOption("--vault <name>", "connected vault")
  .option("--json", "output JSON")
  .action(async (asset: string, options: { vault: string; json?: boolean }) => {
    const report = await auditVaultAsset(options.vault, asset); console.log(options.json ? JSON.stringify(report, null, 2) : `Audited ${report.summary.filesScanned} files — highest risk: ${report.summary.highestRisk}`);
  });

vault.command("status")
  .description("Show vault revision and approval state")
  .argument("<name>", "connected vault")
  .action(async (name: string) => {
    const result = await vaultStatus(name); console.log(`${result.connection.name} (${result.connection.provider}) revision ${result.revision}`);
    for (const asset of result.assets) console.log(`${asset.name}\t${asset.status}\t${asset.risk}`);
  });

vault.command("sync")
  .description("Install approved vault assets into the canonical EPX registry")
  .argument("<name>", "connected vault")
  .option("--dry-run", "show eligible assets without writing")
  .action(async (name: string, options: { dryRun?: boolean }) => {
    const result = await syncVault(name, options.dryRun); const prefix = options.dryRun ? "Would install" : "Installed";
    console.log(`${prefix}: ${result.installed.join(", ") || "none"}`); if (result.pending.length) console.log(`Pending or blocked: ${result.pending.join(", ")}`);
  });

program.command("remove")
  .alias("rm")
  .description("Remove an installed AI asset")
  .argument("<name>", "installed package name")
  .action(removeCommand);

program.command("update")
  .description("Update installed assets from GitHub releases or tags")
  .action(updateCommand);

program.command("validate")
  .description("Validate an EPX package in the current directory")
  .argument("[directory]", "package directory", process.cwd())
  .action(validateCommand);

program.command("audit")
  .description("Audit local AI assets for security risk signals")
  .argument("[package-or-directory]", "installed package name or EPX package directory", process.cwd())
  .option("--json", "output the full report as JSON")
  .option("--fail-on <severity>", "exit with code 1 at or above: low, medium, high, critical", "high")
  .action((directory: string, options: { json?: boolean; failOn?: string }) => {
    const allowed = ["low", "medium", "high", "critical"];
    if (options.failOn && !allowed.includes(options.failOn)) throw new Error(`invalid severity '${options.failOn}'`);
    return auditCommand(directory, { json: options.json, failOn: options.failOn as AuditSeverity });
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
