import fs from "fs-extra";
import { getEpxHome, getRegistryPath } from "./config.js";
import type { InstalledPackage, Registry } from "./types.js";

const EMPTY_REGISTRY: Registry = { packages: {} };

export async function readRegistry(): Promise<Registry> {
  const registryPath = getRegistryPath();
  if (!(await fs.pathExists(registryPath))) return { ...EMPTY_REGISTRY, packages: {} };
  try {
    const registry = await fs.readJson(registryPath) as Registry;
    return registry?.packages ? registry : { ...EMPTY_REGISTRY, packages: {} };
  } catch {
    throw new Error(`installation registry is corrupt: ${registryPath}`);
  }
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await fs.ensureDir(getEpxHome());
  await fs.writeJson(getRegistryPath(), registry, { spaces: 2 });
}

export async function registerPackage(pkg: InstalledPackage): Promise<void> {
  const registry = await readRegistry();
  registry.packages[pkg.name] = pkg;
  await writeRegistry(registry);
}
