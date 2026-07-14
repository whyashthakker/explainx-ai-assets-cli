import path from "node:path";
import fs from "fs-extra";
import YAML from "yaml";
import { z } from "zod";
import { ASSET_DIRECTORIES } from "./types.js";

export const manifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/, "must use lowercase letters, numbers, dots, underscores, or hyphens"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "must be a semantic version"),
  type: z.enum(["skill", "rule", "command"]),
  description: z.string().min(1).optional(),
  targets: z.array(z.string().min(1)).min(1).optional()
}).strict();

export type Manifest = z.infer<typeof manifestSchema>;

export interface ValidationResult {
  manifest: Manifest;
  assetDirectories: string[];
}

export async function findManifest(startDirectory: string): Promise<string> {
  const direct = path.join(startDirectory, "epx.yaml");
  if (await fs.pathExists(direct)) return direct;

  const entries = await fs.readdir(startDirectory, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const candidate = path.join(startDirectory, entry.name, "epx.yaml");
    if (await fs.pathExists(candidate)) candidates.push(candidate);
  }

  if (candidates.length === 0) throw new Error("epx.yaml was not found at the repository root");
  if (candidates.length > 1) throw new Error("multiple epx.yaml files were found");
  return candidates[0];
}

export async function validatePackage(directory: string): Promise<ValidationResult> {
  const manifestPath = await findManifest(directory);
  let parsed: unknown;
  try {
    parsed = YAML.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`).join("; ");
    throw new Error(`invalid manifest: ${details}`);
  }

  const root = path.dirname(manifestPath);
  const assetDirectories: string[] = [];
  for (const name of ASSET_DIRECTORIES) {
    const assetPath = path.join(root, name);
    if (!(await fs.pathExists(assetPath))) continue;
    if (!(await fs.stat(assetPath)).isDirectory()) throw new Error(`${name} must be a directory`);
    const files = await fs.readdir(assetPath);
    if (files.length > 0) assetDirectories.push(name);
  }

  if (assetDirectories.length === 0) {
    throw new Error("package must contain at least one non-empty skills, rules, or commands directory");
  }

  const expected = `${result.data.type}s`;
  if (!assetDirectories.includes(expected)) {
    throw new Error(`type '${result.data.type}' requires a non-empty ${expected}/ directory`);
  }

  return { manifest: result.data, assetDirectories };
}
