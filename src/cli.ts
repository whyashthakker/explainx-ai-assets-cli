#!/usr/bin/env node
import { Command } from "commander";
import { addCommand, auditCommand, listCommand, removeCommand, updateCommand, validateCommand } from "./commands.js";
import type { AuditSeverity } from "./audit.js";

const program = new Command()
  .name("epx")
  .description("ExplainX Package Exchange - install AI assets from GitHub")
  .version("0.1.0");

program.command("add")
  .description("Install an AI asset from a GitHub repository")
  .argument("<owner/repo>", "GitHub repository")
  .action(addCommand);

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
  .argument("[directory]", "EPX package directory", process.cwd())
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
