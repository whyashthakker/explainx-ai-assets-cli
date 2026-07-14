import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import AdmZip from "adm-zip";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installPackage } from "../src/install.js";
import { getPackagesDirectory } from "../src/config.js";
import { readRegistry } from "../src/registry.js";

let home: string;

function packageArchive(version = "1.0.0"): Buffer {
  const zip = new AdmZip();
  zip.addFile("demo-main/epx.yaml", Buffer.from(`name: demo\nversion: ${version}\ntype: skill\ndescription: Demo asset\n`));
  zip.addFile("demo-main/skills/demo.md", Buffer.from("# Demo skill"));
  zip.addFile("demo-main/rules/demo.md", Buffer.from("# Demo rule"));
  return zip.toBuffer();
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "epx-install-home-"));
  process.env.EPX_HOME = home;
});

afterEach(async () => {
  nock.cleanAll();
  delete process.env.EPX_HOME;
  await fs.remove(home);
});

describe("installPackage", () => {
  it("downloads, validates, copies assets, invokes hooks, and registers metadata", async () => {
    nock("https://github.com").get("/owner/demo/archive/HEAD.zip").reply(200, packageArchive());
    const downloaded = jest.fn();
    const validated = jest.fn();
    const installed = await installPackage("owner/demo", undefined, { downloaded, validated });

    expect(installed).toMatchObject({ name: "demo", version: "1.0.0", source: "owner/demo" });
    expect(downloaded).toHaveBeenCalledTimes(1);
    expect(validated).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(path.join(getPackagesDirectory(), "demo", "skills", "demo.md"), "utf8")).resolves.toBe("# Demo skill");
    await expect(fs.pathExists(path.join(getPackagesDirectory(), "demo", "rules", "demo.md"))).resolves.toBe(true);
    expect((await readRegistry()).packages.demo).toMatchObject({ version: "1.0.0" });
  });

  it("records the installed tag", async () => {
    nock("https://github.com").get("/owner/demo/archive/refs/tags/v2.0.0.zip").reply(200, packageArchive("2.0.0"));
    await expect(installPackage("owner/demo", "v2.0.0")).resolves.toMatchObject({ ref: "v2.0.0", version: "2.0.0" });
  });

  it("does not register an invalid downloaded package", async () => {
    const zip = new AdmZip();
    zip.addFile("bad-main/readme.md", Buffer.from("invalid"));
    nock("https://github.com").get("/owner/bad/archive/HEAD.zip").reply(200, zip.toBuffer());
    await expect(installPackage("owner/bad")).rejects.toThrow("epx.yaml was not found");
    expect((await readRegistry()).packages).toEqual({});
  });
});
