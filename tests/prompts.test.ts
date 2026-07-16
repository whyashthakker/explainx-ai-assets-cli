import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { installPrompts } from "../src/prompts.js";
import { getPackagesDirectory } from "../src/config.js";

let home: string;
let project: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "epx-prompts-home-"));
  project = await fs.mkdtemp(path.join(os.tmpdir(), "epx-prompts-project-"));
  process.env.EPX_HOME = home;
});

afterEach(async () => {
  delete process.env.EPX_HOME;
  await fs.remove(home);
  await fs.remove(project);
});

describe("command and prompt installation", () => {
  it("converts one canonical command for multiple clients", async () => {
    await fs.outputFile(path.join(getPackagesDirectory(), "review", "commands", "review.md"), "Review the current changes carefully.");
    const pkg = { name: "review", version: "0.0.0", type: "command" as const, source: "owner/prompts", installedAt: new Date(0).toISOString() };

    await installPrompts(pkg, { agents: ["claude-code", "cursor", "github-copilot", "gemini-cli", "codex"], scope: "project" }, project);

    await expect(fs.readFile(path.join(project, ".claude/commands/review.md"), "utf8")).resolves.toContain("Review the current changes");
    await expect(fs.readFile(path.join(project, ".cursor/commands/review.md"), "utf8")).resolves.toContain("Review the current changes");
    await expect(fs.readFile(path.join(project, ".github/prompts/review.prompt.md"), "utf8")).resolves.toContain("description:");
    await expect(fs.readFile(path.join(project, ".gemini/commands/review.toml"), "utf8")).resolves.toContain("prompt = \"\"\"");
    await expect(fs.readFile(path.join(project, ".codex/prompts/review.md"), "utf8")).resolves.toContain("Review the current changes");
  });
});
