import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "@jest/globals";
import { validatePackage } from "../src/manifest.js";

const temporaryDirectories: string[] = [];

async function temporaryPackage(manifest: string, directory = "skills"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epx-test-"));
  temporaryDirectories.push(root);
  await fs.outputFile(path.join(root, "epx.yaml"), manifest);
  await fs.outputFile(path.join(root, directory, "asset.md"), "# Asset");
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe("validatePackage", () => {
  it("accepts a valid package", async () => {
    const root = await temporaryPackage("name: review\nversion: 1.0.0\ntype: skill\ntargets:\n  - codex\n");
    const result = await validatePackage(root);
    expect(result.manifest.name).toBe("review");
    expect(result.assetDirectories).toEqual(["skills"]);
  });

  it("rejects missing required fields", async () => {
    const root = await temporaryPackage("name: review\ntype: skill\n");
    await expect(validatePackage(root)).rejects.toThrow("invalid manifest");
  });

  it("requires the directory matching the asset type", async () => {
    const root = await temporaryPackage("name: review\nversion: 1.0.0\ntype: rule\n", "skills");
    await expect(validatePackage(root)).rejects.toThrow("requires a non-empty rules/ directory");
  });

  it("rejects malformed YAML", async () => {
    const root = await temporaryPackage("name: [broken\n");
    await expect(validatePackage(root)).rejects.toThrow("invalid YAML");
  });

  it("rejects invalid names, versions, and unknown fields", async () => {
    const root = await temporaryPackage("name: Bad Name\nversion: latest\ntype: skill\nextra: true\n");
    await expect(validatePackage(root)).rejects.toThrow("invalid manifest");
  });

  it("rejects a package without non-empty asset directories", async () => {
    const root = await temporaryPackage("name: review\nversion: 1.0.0\ntype: skill\n");
    await fs.remove(path.join(root, "skills", "asset.md"));
    await expect(validatePackage(root)).rejects.toThrow("at least one non-empty");
  });

  it("finds a manifest inside one extracted archive root", async () => {
    const outer = await fs.mkdtemp(path.join(os.tmpdir(), "epx-archive-"));
    temporaryDirectories.push(outer);
    const root = path.join(outer, "repo-main");
    await fs.outputFile(path.join(root, "epx.yaml"), "name: nested\nversion: 1.2.3\ntype: command\n");
    await fs.outputFile(path.join(root, "commands", "run.md"), "run");
    await expect(validatePackage(outer)).resolves.toMatchObject({ manifest: { name: "nested" } });
  });

  it("rejects missing and ambiguous manifests", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "epx-empty-"));
    temporaryDirectories.push(empty);
    await expect(validatePackage(empty)).rejects.toThrow("was not found");
    await fs.outputFile(path.join(empty, "one", "epx.yaml"), "name: one");
    await fs.outputFile(path.join(empty, "two", "epx.yaml"), "name: two");
    await expect(validatePackage(empty)).rejects.toThrow("multiple epx.yaml");
  });
});
