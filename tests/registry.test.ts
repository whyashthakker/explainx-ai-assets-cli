import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getRegistryPath } from "../src/config.js";
import { readRegistry, registerPackage } from "../src/registry.js";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "epx-registry-"));
  process.env.EPX_HOME = home;
});

afterEach(async () => {
  delete process.env.EPX_HOME;
  await fs.remove(home);
});

describe("registry", () => {
  it("returns an empty registry before first install", async () => {
    await expect(readRegistry()).resolves.toEqual({ packages: {} });
  });

  it("persists and replaces package metadata by name", async () => {
    const base = { name: "demo", type: "skill" as const, source: "owner/demo", installedAt: new Date(0).toISOString() };
    await registerPackage({ ...base, version: "1.0.0" });
    await registerPackage({ ...base, version: "2.0.0" });
    expect((await readRegistry()).packages.demo.version).toBe("2.0.0");
  });

  it("reports a corrupt registry", async () => {
    await fs.outputFile(getRegistryPath(), "not json");
    await expect(readRegistry()).rejects.toThrow("registry is corrupt");
  });
});
