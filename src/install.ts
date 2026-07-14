import path from "node:path";
import fs from "fs-extra";
import { getPackagesDirectory } from "./config.js";
import { downloadRepository } from "./github.js";
import { findManifest, validatePackage } from "./manifest.js";
import { registerPackage } from "./registry.js";
import type { InstalledPackage } from "./types.js";

export interface InstallHooks {
  downloaded?: () => void;
  validated?: () => void;
}

export async function installPackage(source: string, ref?: string, hooks: InstallHooks = {}): Promise<InstalledPackage> {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "epx-"));
  try {
    await downloadRepository(source, temporary, ref);
    hooks.downloaded?.();
    const validation = await validatePackage(temporary);
    hooks.validated?.();
    const manifestPath = await findManifest(temporary);
    const packageRoot = path.dirname(manifestPath);
    const destination = path.join(getPackagesDirectory(), validation.manifest.name);
    const staging = `${destination}.tmp-${process.pid}`;

    await fs.remove(staging);
    await fs.ensureDir(staging);
    await fs.copy(manifestPath, path.join(staging, "epx.yaml"));
    for (const directory of validation.assetDirectories) {
      await fs.copy(path.join(packageRoot, directory), path.join(staging, directory));
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
