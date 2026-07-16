import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { confirm, select } from "@inquirer/prompts";
import { searchableAgentCheckbox } from "./agent-prompt.js";
import { AGENTS, type AgentInstallSelection, type AgentName, type InstallScope } from "./agents.js";
import { getPackagesDirectory } from "./config.js";
import type { InstalledPackage } from "./types.js";

interface RuleTarget {
  project: string;
  global?: string;
  extension?: ".md" | ".mdc" | ".instructions.md";
  managedSection?: boolean;
}

export const RULE_TARGETS: Record<string, RuleTarget> = {
  "claude-code": { project: ".claude/rules", global: ".claude/rules" },
  cursor: { project: ".cursor/rules", global: ".cursor/rules", extension: ".mdc" },
  "github-copilot": { project: ".github/instructions", global: ".copilot/instructions", extension: ".instructions.md" },
  codex: { project: "AGENTS.md", global: ".codex/AGENTS.md", managedSection: true },
  "gemini-cli": { project: "GEMINI.md", global: ".gemini/GEMINI.md", managedSection: true },
  cline: { project: ".clinerules", global: ".clinerules" },
  roo: { project: ".roo/rules", global: ".roo/rules" },
  windsurf: { project: ".windsurf/rules", global: ".codeium/windsurf/rules" }
};

export const RULE_TARGET_NAMES = Object.keys(RULE_TARGETS);

export function supportsRules(name: string): boolean {
  return Object.hasOwn(RULE_TARGETS, name);
}

export async function promptForRules(rules: string[]): Promise<string[] | null> {
  return searchableAgentCheckbox({
    message: "Which rules do you want to install?",
    universal: [],
    choices: rules.map((name) => ({ name, value: name, path: "rule" })),
    pageSize: 12,
    noun: "rules"
  });
}

export async function promptForRuleInstall(packageName: string): Promise<AgentInstallSelection | null> {
  const names = Object.keys(RULE_TARGETS);
  const agents = await searchableAgentCheckbox({
    message: "Which agents should use this rule?",
    universal: [],
    choices: names.map((name) => ({ name: AGENTS[name].label, value: name, path: RULE_TARGETS[name].project })),
    pageSize: 9
  });
  if (agents === null) return null;
  if (agents.length === 0) return null;
  const scope = await select<InstallScope>({
    message: "Installation scope",
    choices: [
      { name: "Project (install in the current directory)", value: "project" },
      { name: "Global (install for your user account)", value: "global" }
    ]
  });
  const proceed = await confirm({ message: `Install rule ${packageName} for ${agents.map((name) => AGENTS[name].label).join(", ")}?`, default: true });
  return proceed ? { agents, scope } : null;
}

function destination(agent: AgentName, scope: InstallScope, name: string, projectDirectory: string): string {
  const target = RULE_TARGETS[agent];
  if (!target) throw new Error(`${AGENTS[agent]?.label ?? agent} does not have a supported rule adapter`);
  const directory = scope === "global" ? target.global : target.project;
  if (!directory) throw new Error(`${AGENTS[agent].label} does not support global rules`);
  const root = scope === "global" ? os.homedir() : projectDirectory;
  return target.managedSection
    ? path.join(root, directory)
    : path.join(root, directory, `${name}${target.extension ?? ".md"}`);
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trimStart();
}

function formatRule(content: string, agent: AgentName, name: string): string {
  const body = stripFrontmatter(content);
  if (agent === "cursor") return `---\ndescription: ${name}\nalwaysApply: true\n---\n${body}`;
  if (agent === "github-copilot") return `---\ndescription: '${name}'\napplyTo: '**'\n---\n${body}`;
  return body;
}

export async function installRuleToAgents(pkg: InstalledPackage, selection: AgentInstallSelection, projectDirectory = process.cwd()): Promise<string[]> {
  if (pkg.type !== "rule") throw new Error(`'${pkg.name}' is not a rule package`);
  const directory = path.join(getPackagesDirectory(), pkg.name, "rules");
  const files = (await fs.readdir(directory)).filter((file) => /\.(md|mdc)$/i.test(file));
  if (files.length === 0) throw new Error(`rules directory was not found for ${pkg.name}`);
  const destinations: string[] = [];
  for (const sourceFile of files) {
    const name = path.basename(sourceFile).replace(/\.(md|mdc)$/i, "");
    const content = await fs.readFile(path.join(directory, sourceFile), "utf8");
    for (const agent of selection.agents) {
      const file = destination(agent, selection.scope, name, projectDirectory);
      destinations.push(file);
      const formatted = formatRule(content, agent, name);
      if (RULE_TARGETS[agent].managedSection) {
      const start = `<!-- epx:rule:${name}:start -->`;
      const end = `<!-- epx:rule:${name}:end -->`;
      const block = `${start}\n${formatted.trim()}\n${end}`;
      const existing = await fs.pathExists(file) ? await fs.readFile(file, "utf8") : "";
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matcher = new RegExp(`<!-- epx:rule:${escapedName}:start -->[\\s\\S]*?<!-- epx:rule:${escapedName}:end -->`, "g");
      const next = matcher.test(existing) ? existing.replace(matcher, block) : `${existing.trimEnd()}${existing ? "\n\n" : ""}${block}\n`;
      await fs.outputFile(file, next);
      } else {
        await fs.outputFile(file, formatted);
      }
    }
  }
  return [...new Set(destinations)];
}
