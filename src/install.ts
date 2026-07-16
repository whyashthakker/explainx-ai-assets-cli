import path from "node:path";
import fs from "fs-extra";
import { getPackagesDirectory } from "./config.js";
import { downloadRepository } from "./github.js";
import { findManifest, validatePackage } from "./manifest.js";
import { registerPackage } from "./registry.js";
import type { InstalledPackage } from "./types.js";
import type { Manifest, ValidationResult } from "./manifest.js";
import YAML from "yaml";

export interface InstallHooks {
  downloaded?: () => void;
  validated?: () => void;
}

export interface InstallOptions {
  skill?: string;
}

interface ConventionalSkill {
  directory: string;
  manifest: Manifest;
}

async function findConventionalSkill(root: string, source: string, requestedSkill?: string): Promise<ConventionalSkill> {
  const candidates: Array<{ name: string; directory: string }> = [];
  const roots = [root];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) roots.push(path.join(root, entry.name));
  }

  for (const contentRoot of roots) {
    const rootSkill = path.join(contentRoot, "SKILL.md");
    if (await fs.pathExists(rootSkill)) {
      candidates.push({ name: source.split("/").at(-1) ?? "skill", directory: contentRoot });
    }

    const skillsDirectory = path.join(contentRoot, "skills");
    if (await fs.pathExists(skillsDirectory) && (await fs.stat(skillsDirectory)).isDirectory()) {
      for (const entry of await fs.readdir(skillsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(skillsDirectory, entry.name);
        if (await fs.pathExists(path.join(directory, "SKILL.md"))) candidates.push({ name: entry.name, directory });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error("epx.yaml was not found and no conventional SKILL.md was discovered");
  }

  const repositoryName = source.split("/").at(-1)?.toLowerCase();
  const desiredName = requestedSkill?.toLowerCase() ?? repositoryName;
  let selected = candidates.find((candidate) => candidate.name.toLowerCase() === desiredName);
  if (!selected && candidates.length === 1 && !requestedSkill) selected = candidates[0];
  if (!selected) {
    throw new Error(`multiple skills found (${candidates.map((candidate) => candidate.name).join(", ")}); choose one with --skill <name>`);
  }

  const name = selected.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "");
  return {
    directory: selected.directory,
    manifest: {
      name,
      version: "0.0.0",
      type: "skill",
      description: `Skill installed from ${source}`
    }
  };
}

export async function installPackage(
  source: string,
  ref?: string,
  hooks: InstallHooks = {},
  options: InstallOptions = {}
): Promise<InstalledPackage> {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "epx-"));
  try {
    await downloadRepository(source, temporary, ref);
    hooks.downloaded?.();
    let validation: ValidationResult;
    let manifestPath: string | undefined;
    let conventionalSkillDirectory: string | undefined;
    try {
      validation = await validatePackage(temporary);
      manifestPath = await findManifest(temporary);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("epx.yaml was not found")) throw error;
      const conventional = await findConventionalSkill(temporary, source, options.skill);
      validation = { manifest: conventional.manifest, assetDirectories: ["skills"] };
      conventionalSkillDirectory = conventional.directory;
    }
    hooks.validated?.();
    const packageRoot = manifestPath ? path.dirname(manifestPath) : temporary;
    const destination = path.join(getPackagesDirectory(), validation.manifest.name);
    const staging = `${destination}.tmp-${process.pid}`;

    await fs.remove(staging);
    await fs.ensureDir(staging);
    if (manifestPath) await fs.copy(manifestPath, path.join(staging, "epx.yaml"));
    else await fs.writeFile(path.join(staging, "epx.yaml"), YAML.stringify(validation.manifest));
    for (const directory of validation.assetDirectories) {
      const sourceDirectory = directory === "skills" && conventionalSkillDirectory
        ? conventionalSkillDirectory
        : path.join(packageRoot, directory);
      await fs.copy(sourceDirectory, path.join(staging, directory));
    }
    await fs.ensureDir(getPackagesDirectory());
    await fs.remove(destination);
    await fs.move(staging, destination);

    const installed: InstalledPackage = {
      ...validation.manifest,
      source,
      installedAt: new Date().toISOString(),
      ...(ref ? { ref } : {})
    };
    await registerPackage(installed);
    return installed;
  } finally {
    await fs.remove(temporary);
  }
}
