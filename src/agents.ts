import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { confirm, select } from "@inquirer/prompts";
import { getPackagesDirectory } from "./config.js";
import type { InstalledPackage } from "./types.js";
import { searchableAgentCheckbox } from "./agent-prompt.js";

export interface AgentDefinition {
  label: string;
  projectDirectory: string;
  globalDirectory?: string;
}

const definitions: Array<[string, string, string, string?]> = [
  ["aider-desk", "AiderDesk", ".aider-desk/skills", ".aider-desk/skills"],
  ["amp", "Amp", ".agents/skills", ".config/agents/skills"],
  ["antigravity", "Antigravity", ".agents/skills", ".gemini/antigravity/skills"],
  ["antigravity-cli", "Antigravity CLI", ".agents/skills", ".gemini/antigravity-cli/skills"],
  ["astrbot", "AstrBot", "data/skills", ".astrbot/data/skills"],
  ["autohand-code", "Autohand Code CLI", ".autohand/skills", ".autohand/skills"],
  ["augment", "Augment", ".augment/skills", ".augment/skills"],
  ["bob", "IBM Bob", ".bob/skills", ".bob/skills"],
  ["claude-code", "Claude Code", ".claude/skills", ".claude/skills"],
  ["openclaw", "OpenClaw", "skills", ".openclaw/skills"],
  ["cline", "Cline", ".agents/skills", ".agents/skills"],
  ["codearts-agent", "CodeArts Agent", ".codeartsdoer/skills", ".codeartsdoer/skills"],
  ["codebuddy", "CodeBuddy", ".codebuddy/skills", ".codebuddy/skills"],
  ["codemaker", "Codemaker", ".codemaker/skills", ".codemaker/skills"],
  ["codestudio", "Code Studio", ".codestudio/skills", ".codestudio/skills"],
  ["codex", "Codex", ".agents/skills", ".codex/skills"],
  ["command-code", "Command Code", ".commandcode/skills", ".commandcode/skills"],
  ["continue", "Continue", ".continue/skills", ".continue/skills"],
  ["cortex", "Cortex Code", ".cortex/skills", ".snowflake/cortex/skills"],
  ["crush", "Crush", ".crush/skills", ".config/crush/skills"],
  ["cursor", "Cursor", ".agents/skills", ".cursor/skills"],
  ["deepagents", "Deep Agents", ".agents/skills", ".deepagents/agent/skills"],
  ["devin", "Devin for Terminal", ".devin/skills", ".config/devin/skills"],
  ["dexto", "Dexto", ".agents/skills", ".agents/skills"],
  ["droid", "Droid", ".factory/skills", ".factory/skills"],
  ["eve", "Eve", "agent/skills"],
  ["firebender", "Firebender", ".agents/skills", ".firebender/skills"],
  ["forgecode", "ForgeCode", ".forge/skills", ".forge/skills"],
  ["gemini-cli", "Gemini CLI", ".agents/skills", ".gemini/skills"],
  ["github-copilot", "GitHub Copilot", ".agents/skills", ".copilot/skills"],
  ["goose", "Goose", ".goose/skills", ".config/goose/skills"],
  ["hermes-agent", "Hermes Agent", ".hermes/skills", ".hermes/skills"],
  ["inference-sh", "inference.sh", ".inferencesh/skills", ".inferencesh/skills"],
  ["jazz", "Jazz", ".jazz/skills", ".jazz/skills"],
  ["junie", "Junie", ".junie/skills", ".junie/skills"],
  ["iflow-cli", "iFlow CLI", ".iflow/skills", ".iflow/skills"],
  ["kilo", "Kilo Code", ".kilocode/skills", ".kilocode/skills"],
  ["kimi-code-cli", "Kimi Code CLI", ".agents/skills", ".agents/skills"],
  ["kiro-cli", "Kiro CLI", ".kiro/skills", ".kiro/skills"],
  ["kode", "Kode", ".kode/skills", ".kode/skills"],
  ["lingma", "Lingma", ".lingma/skills", ".lingma/skills"],
  ["loaf", "Loaf", ".agents/skills", ".agents/skills"],
  ["mcpjam", "MCPJam", ".mcpjam/skills", ".mcpjam/skills"],
  ["mistral-vibe", "Mistral Vibe", ".vibe/skills", ".vibe/skills"],
  ["moxby", "Moxby", ".moxby/skills", ".moxby/skills"],
  ["mux", "Mux", ".mux/skills", ".mux/skills"],
  ["opencode", "OpenCode", ".agents/skills", ".config/opencode/skills"],
  ["openhands", "OpenHands", ".openhands/skills", ".openhands/skills"],
  ["ona", "Ona", ".ona/skills", ".ona/skills"],
  ["pi", "Pi", ".pi/skills", ".pi/agent/skills"],
  ["qoder", "Qoder", ".qoder/skills", ".qoder/skills"],
  ["qoder-cn", "Qoder CN", ".qoder/skills", ".qoder-cn/skills"],
  ["qwen-code", "Qwen Code", ".qwen/skills", ".qwen/skills"],
  ["replit", "Replit", ".agents/skills", ".config/agents/skills"],
  ["reasonix", "Reasonix", ".reasonix/skills", ".reasonix/skills"],
  ["rovodev", "Rovo Dev", ".rovodev/skills", ".rovodev/skills"],
  ["roo", "Roo Code", ".roo/skills", ".roo/skills"],
  ["tabnine-cli", "Tabnine CLI", ".tabnine/agent/skills", ".tabnine/agent/skills"],
  ["terramind", "Terramind", ".terramind/skills", ".terramind/skills"],
  ["tinycloud", "Tinycloud", ".tinycloud/skills", ".tinycloud/skills"],
  ["trae", "Trae", ".trae/skills", ".trae/skills"],
  ["trae-cn", "Trae CN", ".trae/skills", ".trae-cn/skills"],
  ["warp", "Warp", ".agents/skills", ".agents/skills"],
  ["windsurf", "Windsurf", ".windsurf/skills", ".codeium/windsurf/skills"],
  ["zed", "Zed", ".agents/skills", ".agents/skills"],
  ["zcode", "ZCode", ".zcode/skills", ".zcode/skills"],
  ["zencoder", "Zencoder", ".zencoder/skills", ".zencoder/skills"],
  ["zenflow", "Zenflow", ".zencoder/skills", ".zencoder/skills"],
  ["neovate", "Neovate", ".neovate/skills", ".neovate/skills"],
  ["pochi", "Pochi", ".pochi/skills", ".pochi/skills"],
  ["promptscript", "PromptScript", ".agents/skills"],
  ["adal", "AdaL", ".adal/skills", ".adal/skills"],
  ["universal", "Universal", ".agents/skills", ".config/agents/skills"]
];

export const AGENTS: Record<string, AgentDefinition> = Object.fromEntries(
  definitions.map(([name, label, projectDirectory, globalDirectory]) => [
    name,
    { label, projectDirectory, ...(globalDirectory ? { globalDirectory } : {}) }
  ])
);

export type AgentName = string;
export type InstallScope = "project" | "global";

export const UNIVERSAL_AGENT_NAMES = Object.entries(AGENTS)
  .filter(([name, agent]) => name !== "universal" && agent.projectDirectory === ".agents/skills")
  .map(([name]) => name);

export const ADDITIONAL_AGENT_NAMES = Object.keys(AGENTS)
  .filter((name) => name !== "universal" && !UNIVERSAL_AGENT_NAMES.includes(name));

export interface AgentInstallSelection {
  agents: AgentName[];
  scope: InstallScope;
}

export function isAgentName(value: string): value is AgentName {
  return Object.hasOwn(AGENTS, value);
}

export async function promptForAgentInstall(packageName: string): Promise<AgentInstallSelection | null> {
  const agents = await searchableAgentCheckbox({
    message: "Which agents do you want to install to?",
    universal: UNIVERSAL_AGENT_NAMES.map((name) => AGENTS[name].label),
    choices: ADDITIONAL_AGENT_NAMES.map((name) => ({
      name: AGENTS[name].label,
      value: name,
      path: AGENTS[name].projectDirectory
    })),
    pageSize: 9
  });
  if (agents === null) return null;

  const scope = await select<InstallScope>({
    message: "Installation scope",
    choices: [
      { name: "Project (install in the current directory)", value: "project" },
      { name: "Global (install for your user account)", value: "global" }
    ]
  });

  const installableAgents = scope === "global"
    ? agents.filter((name) => Boolean(AGENTS[name].globalDirectory))
    : agents;
  const allAgents = ["universal", ...installableAgents];
  const destinations = getUniqueAgentDestinations(allAgents, scope, packageName).join("\n  ");
  const proceed = await confirm({
    message: `Install ${packageName} to:\n  ${destinations}\nProceed?`,
    default: true
  });
  return proceed ? { agents: allAgents, scope } : null;
}

export function getAgentDestination(
  agentName: AgentName,
  scope: InstallScope,
  packageName: string,
  projectDirectory = process.cwd()
): string {
  const agent = AGENTS[agentName];
  if (!agent) throw new Error(`unknown agent '${agentName}'`);
  if (scope === "global" && !agent.globalDirectory) {
    throw new Error(`${agent.label} does not support global skill installation`);
  }
  const root = scope === "global" ? os.homedir() : projectDirectory;
  const directory = scope === "global" ? agent.globalDirectory! : agent.projectDirectory;
  return path.join(root, directory, packageName);
}

export function getUniqueAgentDestinations(
  agentNames: AgentName[],
  scope: InstallScope,
  packageName: string,
  projectDirectory = process.cwd()
): string[] {
  return [...new Set(agentNames.map((name) => getAgentDestination(name, scope, packageName, projectDirectory)))];
}

export async function installToAgents(
  pkg: InstalledPackage,
  selection: AgentInstallSelection,
  projectDirectory = process.cwd()
): Promise<string[]> {
  if (pkg.type !== "skill") {
    throw new Error(`agent installation currently supports skill packages; '${pkg.name}' is a ${pkg.type}`);
  }
  const source = path.join(getPackagesDirectory(), pkg.name, "skills");
  if (!(await fs.pathExists(source))) throw new Error(`skills directory was not found for ${pkg.name}`);

  const requested = selection.agents.includes("universal")
    ? selection.agents
    : ["universal", ...selection.agents];
  const destinations = getUniqueAgentDestinations(requested, selection.scope, pkg.name, projectDirectory);
  for (const destination of destinations) {
    await fs.remove(destination);
    await fs.ensureDir(destination);
    await fs.copy(source, destination);
  }
  return destinations;
}
