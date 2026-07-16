#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { addCommand, auditCommand, listCommand, removeCommand, updateCommand, validateCommand } from "./commands.js";
import type { AuditSeverity } from "./audit.js";
import { ADDITIONAL_AGENT_NAMES, AGENTS, type AgentName, type InstallScope } from "./agents.js";
import { printBanner } from "./banner.js";

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
  .option("-t, --target <agent...>", "target agent ID (73 agents supported)")
  .option("--codex", "install for Codex")
  .option("--claude-code", "install for Claude Code")
  .option("--cursor", "install for Cursor")
  .option("--all-agents", "install for every supported agent")
  .option("-g, --global", "install globally instead of in the current project")
  .action((source: string, options: {
    target?: AgentName[];
    codex?: boolean;
    claudeCode?: boolean;
    cursor?: boolean;
    allAgents?: boolean;
    global?: boolean;
    skill?: string;
  }) => addCommand(source, {
    targets: [
      ...(options.allAgents
        ? ADDITIONAL_AGENT_NAMES.filter((name) => !options.global || Boolean(AGENTS[name].globalDirectory))
        : []),
      ...(options.target ?? []),
      ...(options.codex ? ["codex" as const] : []),
      ...(options.claudeCode ? ["claude-code" as const] : []),
      ...(options.cursor ? ["cursor" as const] : [])
    ],
    scope: options.global ? "global" as InstallScope : undefined,
    interactive: true,
    skill: options.skill
  }));

program.command("list")
  .alias("ls")
  .description("List installed AI assets")
  .action(listCommand);

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

program.parseAsync().catch(() => {
  process.exitCode = 1;
});
