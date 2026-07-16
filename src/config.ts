import os from "node:os";
import path from "node:path";

export function getEpxHome(): string {
  return process.env.EPX_HOME
    ? path.resolve(process.env.EPX_HOME)
    : path.join(os.homedir(), ".epx");
}

export function getPackagesDirectory(): string {
  return path.join(getEpxHome(), "packages");
}

export function getRegistryPath(): string {
  return path.join(getEpxHome(), "registry.json");
}

export function getVaultConfigPath(): string {
  return path.join(getEpxHome(), "vaults.json");
}

export function getVaultCacheDirectory(): string {
  return path.join(getEpxHome(), "vaults");
}

export function getProfilePath(): string {
  return path.join(getEpxHome(), "profile.json");
}
