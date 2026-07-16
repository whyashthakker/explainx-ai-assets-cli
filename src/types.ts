export const ASSET_DIRECTORIES = ["skills", "rules", "commands", "prompts", "agents"] as const;

export type AssetDirectory = (typeof ASSET_DIRECTORIES)[number];

export interface InstalledPackage {
  name: string;
  version: string;
  description?: string;
  type: "skill" | "rule" | "command" | "prompt" | "agent";
  targets?: string[];
  source: string;
  installedAt: string;
  ref?: string;
  vault?: string;
  vaultProvider?: "git" | "folder" | "mcp";
  digest?: string;
  approvedDigest?: string;
  installedTargets?: string[];
  installedScope?: "project" | "global";
}

export interface Registry {
  packages: Record<string, InstalledPackage>;
}
