import fs from "fs-extra";
import { z } from "zod";
import { getEpxHome, getVaultConfigPath } from "./config.js";
import type { VaultConnection, VaultConnections, VaultProviderKind } from "./vault-types.js";

const connectionSchema = z.object({
  name: z.string(), provider: z.enum(["git", "folder", "mcp"]), location: z.string(),
  connectedAt: z.string(), revision: z.string().optional()
});
const configSchema = z.object({ vaults: z.record(connectionSchema) });

export async function readVaultConnections(): Promise<VaultConnections> {
  if (!(await fs.pathExists(getVaultConfigPath()))) return { vaults: {} };
  const parsed = configSchema.safeParse(await fs.readJson(getVaultConfigPath()));
  if (!parsed.success) throw new Error(`vault configuration is corrupt: ${getVaultConfigPath()}`);
  return parsed.data as VaultConnections;
}

export async function connectVault(name: string, provider: VaultProviderKind, location: string): Promise<VaultConnection> {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error("vault name may contain only letters, numbers, dots, underscores, and hyphens");
  const config = await readVaultConnections();
  const connection = { name, provider, location, connectedAt: new Date().toISOString() };
  config.vaults[name] = connection;
  await fs.ensureDir(getEpxHome());
  await fs.writeJson(getVaultConfigPath(), config, { spaces: 2, mode: 0o600 });
  return connection;
}

export async function getVaultConnection(name: string): Promise<VaultConnection> {
  const connection = (await readVaultConnections()).vaults[name];
  if (!connection) throw new Error(`vault '${name}' is not connected`);
  return connection;
}
