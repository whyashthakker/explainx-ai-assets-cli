import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { confirm } from "@inquirer/prompts";
import { searchableAgentCheckbox } from "./agent-prompt.js";
import { AGENTS, type AgentInstallSelection, type AgentName, type InstallScope } from "./agents.js";

interface McpTarget {
  project: string;
  global: string;
  format: "claude" | "cursor" | "gemini" | "copilot" | "codex";
}

export const MCP_TARGETS: Record<string, McpTarget> = {
  codex: { project: ".codex/config.toml", global: ".codex/config.toml", format: "codex" },
  "claude-code": { project: ".mcp.json", global: ".claude.json", format: "claude" },
  cursor: { project: ".cursor/mcp.json", global: ".cursor/mcp.json", format: "cursor" },
  "gemini-cli": { project: ".gemini/settings.json", global: ".gemini/settings.json", format: "gemini" },
  "github-copilot": { project: ".vscode/mcp.json", global: ".config/Code/User/mcp.json", format: "copilot" }
};

export interface AddMcpOptions {
  name?: string;
  targets?: string[];
  scope?: InstallScope;
  interactive?: boolean;
  projectDirectory?: string;
}

function serverName(url: URL): string {
  const parts = url.hostname.replace(/^mcp\./, "").split(".");
  return (parts[0] || "mcp-server").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function displayName(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/[-_]+/g, " ")} MCP`;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  if (!(await fs.pathExists(file))) return {};
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("root must be an object");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`cannot update ${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function mergeJson(file: string, format: McpTarget["format"], name: string, url: string): Promise<void> {
  const config = await readJson(file);
  if (format === "copilot") {
    const servers = typeof config.servers === "object" && config.servers ? config.servers as Record<string, unknown> : {};
    config.inputs ??= [];
    config.servers = { ...servers, [displayName(name)]: { type: "http", url } };
  } else {
    const servers = typeof config.mcpServers === "object" && config.mcpServers ? config.mcpServers as Record<string, unknown> : {};
    const definition = format === "gemini"
      ? { httpUrl: url }
      : format === "claude" ? { type: "http", url } : { url };
    config.mcpServers = { ...servers, [displayName(name)]: definition };
  }
  await fs.outputJson(file, config, { spaces: 2 });
  await fs.appendFile(file, "\n");
}

async function mergeCodex(file: string, name: string, url: string): Promise<void> {
  const start = `# epx:mcp:${name}:start`;
  const end = `# epx:mcp:${name}:end`;
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  const escapedUrl = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const block = `${start}\n[mcp_servers.${safeName}]\nurl = "${escapedUrl}"\n${end}`;
  const existing = await fs.pathExists(file) ? await fs.readFile(file, "utf8") : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`# epx:mcp:${escapedName}:start[\\s\\S]*?# epx:mcp:${escapedName}:end`, "g");
  const next = matcher.test(existing) ? existing.replace(matcher, block) : `${existing.trimEnd()}${existing ? "\n\n" : ""}${block}\n`;
  await fs.outputFile(file, next);
}

async function promptForMcpTargets(name: string): Promise<AgentInstallSelection | null> {
  const agents = await searchableAgentCheckbox({
    message: "Which agents should receive this MCP server?",
    universal: [],
    choices: Object.entries(MCP_TARGETS).map(([value, target]) => ({ name: AGENTS[value].label, value, path: `~/${target.global}` })),
    noun: "MCP clients",
    pageSize: 7
  });
  if (agents === null || agents.length === 0) return null;
  const proceed = await confirm({ message: `Install ${displayName(name)} for ${agents.map((agent) => AGENTS[agent].label).join(", ")}?`, default: true });
  return proceed ? { agents, scope: "global" } : null;
}

function globalDestination(agent: AgentName): string {
  if (agent !== "github-copilot") return path.join(os.homedir(), MCP_TARGETS[agent].global);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library/Application Support/Code/User/mcp.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), "Code/User/mcp.json");
  return path.join(os.homedir(), ".config/Code/User/mcp.json");
}

export async function addMcpUrl(source: string, options: AddMcpOptions = {}): Promise<string[]> {
  let parsed: URL;
  try { parsed = new URL(source); } catch { throw new Error("MCP source must be a valid http:// or https:// URL"); }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) throw new Error("MCP URL must use http or https");
  const name = options.name?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || serverName(parsed);
  const requested = [...new Set(options.targets ?? [])];
  const unsupported = requested.find((agent) => !MCP_TARGETS[agent]);
  if (unsupported) throw new Error(`${AGENTS[unsupported]?.label ?? unsupported} does not have a supported MCP adapter`);
  let selection: AgentInstallSelection | null | undefined = requested.length
    ? { agents: requested, scope: options.scope ?? "global" }
    : undefined;
  if (!selection && options.interactive && process.stdin.isTTY) selection = await promptForMcpTargets(name);
  if (!selection) return [];
  const destinations: string[] = [];
  for (const agent of selection.agents) {
    const target = MCP_TARGETS[agent];
    const file = selection.scope === "global"
      ? globalDestination(agent)
      : path.join(options.projectDirectory ?? process.cwd(), target.project);
    if (target.format === "codex") await mergeCodex(file, name, parsed.toString());
    else await mergeJson(file, target.format, name, parsed.toString());
    destinations.push(file);
  }
  return [...new Set(destinations)];
}
