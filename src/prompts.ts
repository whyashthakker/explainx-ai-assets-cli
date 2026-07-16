import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { confirm, select } from "@inquirer/prompts";
import { searchableAgentCheckbox } from "./agent-prompt.js";
import { AGENTS, type AgentInstallSelection, type InstallScope } from "./agents.js";
import { getPackagesDirectory } from "./config.js";
import type { InstalledPackage } from "./types.js";

const TARGETS: Record<string, { project: string; global: string; format: "md" | "copilot" | "gemini" }> = {
  codex: { project: ".codex/prompts", global: ".codex/prompts", format: "md" },
  "claude-code": { project: ".claude/commands", global: ".claude/commands", format: "md" },
  cursor: { project: ".cursor/commands", global: ".cursor/commands", format: "md" },
  "github-copilot": { project: ".github/prompts", global: ".copilot/prompts", format: "copilot" },
  "gemini-cli": { project: ".gemini/commands", global: ".gemini/commands", format: "gemini" }
};
export const PROMPT_TARGET_NAMES = Object.keys(TARGETS);
export const supportsPromptTarget = (name: string) => Object.hasOwn(TARGETS, name);

export async function promptForPromptTargets(name: string): Promise<AgentInstallSelection | null> {
  const agents = await searchableAgentCheckbox({ message: "Which agents should receive these commands/prompts?", universal: [], choices: Object.entries(TARGETS).map(([value, target]) => ({ name: AGENTS[value].label, value, path: target.project })), noun: "prompt clients" });
  if (!agents?.length) return null;
  const scope = await select<InstallScope>({ message: "Installation scope", choices: [{ name: "Project (install in the current directory)", value: "project" }, { name: "Global (install for your user account)", value: "global" }] });
  return await confirm({ message: `Install ${name} for ${agents.map((agent) => AGENTS[agent].label).join(", ")}?`, default: true }) ? { agents, scope } : null;
}

export async function promptForPromptAssets(names: string[], type: string): Promise<string[] | null> {
  return searchableAgentCheckbox({ message: `Which ${type}s do you want to install?`, universal: [], choices: names.map((name) => ({ name, value: name, path: type })), noun: `${type}s`, pageSize: 12 });
}

function body(content: string): string {
  if (/^prompt\s*=/.test(content.trimStart())) {
    const match = content.match(/prompt\s*=\s*"""([\s\S]*?)"""/);
    if (match) return match[1].trim();
  }
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export async function installPrompts(pkg: InstalledPackage, selection: AgentInstallSelection, project = process.cwd()): Promise<string[]> {
  if (pkg.type !== "command" && pkg.type !== "prompt") throw new Error(`${pkg.name} is not a command or prompt package`);
  const source = path.join(getPackagesDirectory(), pkg.name, `${pkg.type}s`);
  const files = await fs.readdir(source);
  const destinations: string[] = [];
  for (const sourceFile of files) {
    const name = sourceFile.replace(/\.prompt\.md$/i, "").replace(/\.(md|toml)$/i, "");
    const content = body(await fs.readFile(path.join(source, sourceFile), "utf8"));
    for (const agent of selection.agents) {
      const target = TARGETS[agent];
      const root = selection.scope === "global" ? os.homedir() : project;
      const extension = target.format === "gemini" ? ".toml" : target.format === "copilot" ? ".prompt.md" : ".md";
      const destination = path.join(root, selection.scope === "global" ? target.global : target.project, `${name}${extension}`);
      const output = target.format === "gemini" ? `description = "Installed by EPX"\nprompt = """\n${content.replace(/"""/g, '\\"\\"\\"')}\n"""\n` : target.format === "copilot" ? `---\ndescription: '${name}'\n---\n${content}\n` : `${content}\n`;
      await fs.outputFile(destination, output);
      destinations.push(destination);
    }
  }
  return [...new Set(destinations)];
}
