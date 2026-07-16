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
    await expect(installPackage("owner/bad")).rejects.toThrow("no conventional SKILL.md was discovered");
    expect((await readRegistry()).packages).toEqual({});
  });

  it("installs a conventional skills/name/SKILL.md repository without epx.yaml", async () => {
    const zip = new AdmZip();
    zip.addFile("caveman-main/skills/caveman/SKILL.md", Buffer.from("# Caveman"));
    nock("https://github.com").get("/JuliusBrussee/caveman/archive/HEAD.zip").reply(200, zip.toBuffer());

    const installed = await installPackage("JuliusBrussee/caveman");

    expect(installed).toMatchObject({ name: "caveman", version: "0.0.0", type: "skill" });
    await expect(fs.readFile(path.join(getPackagesDirectory(), "caveman", "skills", "SKILL.md"), "utf8")).resolves.toBe("# Caveman");
  });

  it("selects a named skill from a conventional multi-skill repository", async () => {
    const zip = new AdmZip();
    zip.addFile("skills-main/skills/frontend-design/SKILL.md", Buffer.from("# Frontend"));
    zip.addFile("skills-main/skills/backend-design/SKILL.md", Buffer.from("# Backend"));
    nock("https://github.com").get("/anthropics/skills/archive/HEAD.zip").reply(200, zip.toBuffer());

    const installed = await installPackage("anthropics/skills", undefined, {}, { skill: "frontend-design" });

    expect(installed.name).toBe("frontend-design");
    await expect(fs.readFile(path.join(getPackagesDirectory(), "frontend-design", "skills", "SKILL.md"), "utf8")).resolves.toBe("# Frontend");
  });

  it("installs a named rule from a conventional Cursor rules repository", async () => {
    const zip = new AdmZip();
    zip.addFile("rules-main/.cursor/rules/typescript.mdc", Buffer.from("---\nalwaysApply: true\n---\nUse strict TypeScript."));
    zip.addFile("rules-main/.cursor/rules/react.mdc", Buffer.from("Use React hooks."));
    nock("https://github.com").get("/owner/rules/archive/HEAD.zip").reply(200, zip.toBuffer());

    const installed = await installPackage("owner/rules", undefined, {}, { rule: "typescript" });

    expect(installed).toMatchObject({ name: "typescript", type: "rule", version: "0.0.0" });
    await expect(fs.readFile(path.join(getPackagesDirectory(), "typescript", "rules", "typescript.md"), "utf8"))
      .resolves.toContain("Use strict TypeScript");
  });

  it("reports discovered rules instead of a misleading skill error", async () => {
    const zip = new AdmZip();
    zip.addFile("rules-main/rules/clean-code.mdc", Buffer.from("Keep code clean."));
    zip.addFile("rules-main/rules/fastapi.mdc", Buffer.from("Use FastAPI."));
    nock("https://github.com").get("/owner/rules/archive/HEAD.zip").reply(200, zip.toBuffer());

    await expect(installPackage("owner/rules")).rejects.toMatchObject({
      message: "multiple rules found; select one or more with --rule <name>",
      rules: ["clean-code", "fastapi"]
    });
  });

  it("installs a conventional GitHub Copilot prompt", async () => {
    const zip = new AdmZip();
    zip.addFile("prompts-main/.github/prompts/review.prompt.md", Buffer.from("---\ndescription: Review code\n---\nReview the current changes."));
    nock("https://github.com").get("/owner/prompts/archive/HEAD.zip").reply(200, zip.toBuffer());

    const installed = await installPackage("owner/prompts");

    expect(installed).toMatchObject({ name: "review", type: "prompt" });
    await expect(fs.readFile(path.join(getPackagesDirectory(), "review", "prompts", "review.md"), "utf8")).resolves.toContain("Review the current changes");
  });
});
