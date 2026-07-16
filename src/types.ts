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
}

export interface Registry {
  packages: Record<string, InstalledPackage>;
}
