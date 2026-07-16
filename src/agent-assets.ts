import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import YAML from "yaml";
import { confirm, select } from "@inquirer/prompts";
import { searchableAgentCheckbox } from "./agent-prompt.js";
import { AGENTS, type AgentInstallSelection, type InstallScope } from "./agents.js";
import { getPackagesDirectory } from "./config.js";
import type { InstalledPackage } from "./types.js";

const TARGETS: Record<string, { project: string; global: string; extension: string }> = {
  "claude-code": { project: ".claude/agents", global: ".claude/agents", extension: ".md" },
  "github-copilot": { project: ".github/agents", global: ".copilot/agents", extension: ".agent.md" },
  "gemini-cli": { project: ".gemini/agents", global: ".gemini/agents", extension: ".md" }
};
export const AGENT_TARGET_NAMES = Object.keys(TARGETS);
export const supportsAgentTarget = (name: string) => Object.hasOwn(TARGETS, name);

export async function promptForAgentAssets(names: string[]): Promise<string[] | null> {
  return searchableAgentCheckbox({ message: "Which agents do you want to install?", universal: [], choices: names.map((name) => ({ name, value: name, path: "agent" })), noun: "custom agents", pageSize: 12 });
}

export async function promptForAgentTargets(name: string): Promise<AgentInstallSelection | null> {
  const agents = await searchableAgentCheckbox({ message: "Which AI clients should receive these custom agents?", universal: [], choices: Object.entries(TARGETS).map(([value, target]) => ({ name: AGENTS[value].label, value, path: target.project })), noun: "agent clients" });
  if (!agents?.length) return null;
  const scope = await select<InstallScope>({ message: "Installation scope", choices: [{ name: "Project (install in the current directory)", value: "project" }, { name: "Global (install for your user account)", value: "global" }] });
  return await confirm({ message: `Install ${name} for ${agents.map((agent) => AGENTS[agent].label).join(", ")}?`, default: true }) ? { agents, scope } : null;
}

function normalize(content: string, name: string): string {
  let metadata: Record<string, unknown> = {};
  let body = content;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    try { metadata = YAML.parse(match[1]) ?? {}; } catch { metadata = {}; }
    body = content.slice(match[0].length);
  }
  const description = typeof metadata.description === "string" ? metadata.description : `${name} custom agent`;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${body.trim()}\n`;
}

export async function installAgentAssets(pkg: InstalledPackage, selection: AgentInstallSelection, project = process.cwd()): Promise<string[]> {
  if (pkg.type !== "agent") throw new Error(`${pkg.name} is not an agent package`);
  const source = path.join(getPackagesDirectory(), pkg.name, "agents");
  const destinations: string[] = [];
  for (const file of await fs.readdir(source)) {
    const name = file.replace(/\.agent\.md$/i, "").replace(/\.md$/i, "");
    const content = normalize(await fs.readFile(path.join(source, file), "utf8"), name);
    for (const client of selection.agents) {
      const target = TARGETS[client];
      const root = selection.scope === "global" ? os.homedir() : project;
      const destination = path.join(root, selection.scope === "global" ? target.global : target.project, `${name}${target.extension}`);
      await fs.outputFile(destination, content);
      destinations.push(destination);
    }
  }
  return [...new Set(destinations)];
}
