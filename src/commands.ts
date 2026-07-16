import path from "node:path";
import chalk from "chalk";
import fs from "fs-extra";
import ora from "ora";
import semver from "semver";
import { getPackagesDirectory } from "./config.js";
import { getLatestRef } from "./github.js";
import { installPackage } from "./install.js";
import { validatePackage } from "./manifest.js";
import { readRegistry, writeRegistry } from "./registry.js";
import { auditPackage, severityWeight, type AuditSeverity } from "./audit.js";
import { AGENTS, installToAgents, isAgentName, promptForAgentInstall, type AgentInstallSelection, type AgentName, type InstallScope } from "./agents.js";

export interface AuditOptions { json?: boolean; failOn?: AuditSeverity }

async function resolveAuditTarget(target: string): Promise<string> {
  const resolvedPath = path.resolve(target);
  if (await fs.pathExists(resolvedPath)) return resolvedPath;

  const registry = await readRegistry();
  if (registry.packages[target]) return path.join(getPackagesDirectory(), target);
  throw new Error(`'${target}' is not an installed package or existing directory`);
}

export async function auditCommand(target = process.cwd(), options: AuditOptions = {}): Promise<void> {
  const report = await auditPackage(await resolveAuditTarget(target));
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Audited ${report.summary.filesScanned} asset${report.summary.filesScanned === 1 ? "" : "s"} — highest risk: ${report.summary.highestRisk}`);
    for (const asset of report.assets) {
      const color = asset.riskLevel === "safe" ? chalk.green : asset.riskLevel === "low" ? chalk.blue : asset.riskLevel === "medium" ? chalk.yellow : chalk.red;
      console.log(`\n${color(asset.riskLevel.toUpperCase().padEnd(8))} ${asset.path} (${asset.score})`);
      for (const finding of asset.findings) {
        console.log(`  ${chalk.dim("•")} ${finding.title} [${finding.severity}]`);
        for (const item of finding.evidence) console.log(chalk.dim(`    ${item}`));
        console.log(chalk.dim(`    Fix: ${finding.recommendation}`));
      }
    }
    if (report.summary.totalFindings === 0) console.log(`${chalk.green("✔")} No risk signals found`);
  }
  if (options.failOn && severityWeight[report.summary.highestRisk] >= severityWeight[options.failOn]) process.exitCode = 1;
}

export interface AddOptions {
  targets?: string[];
  scope?: InstallScope;
  interactive?: boolean;
  projectDirectory?: string;
  skill?: string;
}

export async function addCommand(source: string, options: AddOptions = {}): Promise<void> {
  const spinner = ora(`Downloading ${source}`).start();
  try {
    const installed = await installPackage(source, undefined, {
      downloaded: () => { spinner.succeed("Downloaded"); spinner.start("Validating manifest"); },
      validated: () => { spinner.succeed("Manifest validated"); spinner.start("Installing"); }
    }, { skill: options.skill });
    spinner.succeed(`Downloaded and validated ${chalk.cyan(installed.name)} ${chalk.dim(`v${installed.version}`)}`);

    const requestedTargets = [...new Set(options.targets ?? [])];
    const invalidTargets = requestedTargets.filter((target) => !isAgentName(target));
    if (invalidTargets.length > 0) {
      throw new Error(`unknown agent '${invalidTargets[0]}'; choose ${Object.keys(AGENTS).join(", ")}`);
    }

    let selection: AgentInstallSelection | null | undefined = requestedTargets.length > 0
      ? { agents: requestedTargets as AgentName[], scope: options.scope ?? "project" as InstallScope }
      : undefined;
    if (!selection && options.interactive && process.stdin.isTTY) {
      selection = await promptForAgentInstall(installed.name);
    }

    if (selection === null) {
      console.log(chalk.yellow("Installation cancelled."));
      return;
    }

    if (!selection) {
      console.log(chalk.dim(`Saved package to ${path.join(getPackagesDirectory(), installed.name)}`));
      return;
    }

    const destinations = await installToAgents(installed, selection, options.projectDirectory);
    console.log(`\n${chalk.green("✔")} Installed ${chalk.cyan(installed.name)} for ${selection.agents.map((name) => AGENTS[name].label).join(", ")}`);
    for (const destination of destinations) console.log(chalk.dim(`  → ${destination}`));
  } catch (error) {
    if (spinner.isSpinning) spinner.fail(error instanceof Error ? error.message : String(error));
    else console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    throw error;
  }
}

export async function listCommand(): Promise<void> {
  const registry = await readRegistry();
  const packages = Object.values(registry.packages).sort((a, b) => a.name.localeCompare(b.name));
  if (packages.length === 0) {
    console.log(chalk.dim("No EPX assets installed."));
    return;
  }
  const width = Math.max(...packages.map((pkg) => pkg.name.length)) + 4;
  for (const pkg of packages) console.log(`${pkg.name.padEnd(width)}v${pkg.version}`);
}

export async function removeCommand(name: string): Promise<void> {
  const registry = await readRegistry();
  if (!registry.packages[name]) throw new Error(`${name} is not installed`);
  await fs.remove(path.join(getPackagesDirectory(), name));
  delete registry.packages[name];
  await writeRegistry(registry);
  console.log(`${chalk.green("✔")} Removed ${name}`);
}

export async function validateCommand(directory = process.cwd()): Promise<void> {
  const result = await validatePackage(path.resolve(directory));
  console.log(`${chalk.green("✔")} Package valid (${result.manifest.name} v${result.manifest.version})`);
}

export async function updateCommand(): Promise<void> {
  const registry = await readRegistry();
  const packages = Object.values(registry.packages);
  if (packages.length === 0) {
    console.log(chalk.dim("No EPX assets installed."));
    return;
  }

  for (const pkg of packages) {
    const spinner = ora(`Checking ${pkg.name}`).start();
    try {
      const ref = await getLatestRef(pkg.source);
      if (!ref) { spinner.info(`${pkg.name} has no releases or tags`); continue; }
      const tagVersion = semver.clean(ref);
      if (tagVersion && !semver.gt(tagVersion, pkg.version)) {
        spinner.succeed(`${pkg.name} is up to date (v${pkg.version})`);
        continue;
      }
      if (ref === pkg.ref) { spinner.succeed(`${pkg.name} is up to date (v${pkg.version})`); continue; }
      spinner.text = `Updating ${pkg.name}`;
      const installed = await installPackage(pkg.source, ref);
      spinner.succeed(`Updated ${pkg.name} to v${installed.version}`);
    } catch (error) {
      spinner.fail(`Could not update ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
