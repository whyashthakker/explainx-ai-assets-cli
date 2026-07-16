export const ASSET_DIRECTORIES = ["skills", "rules", "commands", "prompts"] as const;

export type AssetDirectory = (typeof ASSET_DIRECTORIES)[number];

export interface InstalledPackage {
  name: string;
  version: string;
  description?: string;
  type: "skill" | "rule" | "command" | "prompt";
  targets?: string[];
  source: string;
  installedAt: string;
  ref?: string;
}

export interface Registry {
  packages: Record<string, InstalledPackage>;
}
