import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { installAgentAssets } from "../src/agent-assets.js";
import { getPackagesDirectory } from "../src/config.js";

let home: string;
let project: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "epx-agent-home-"));
  project = await fs.mkdtemp(path.join(os.tmpdir(), "epx-agent-project-"));
  process.env.EPX_HOME = home;
});
afterEach(async () => { delete process.env.EPX_HOME; await fs.remove(home); await fs.remove(project); });

describe("custom-agent installation", () => {
  it("generates native Claude, Copilot, and Gemini agent profiles", async () => {
    await fs.outputFile(path.join(getPackagesDirectory(), "reviewer", "agents", "reviewer.md"), "---\ndescription: Reviews code safely\ntools: [Read, Bash]\n---\nReview changes for defects.");
    const pkg = { name: "reviewer", version: "0.0.0", type: "agent" as const, source: "owner/agents", installedAt: new Date(0).toISOString() };
    await installAgentAssets(pkg, { agents: ["claude-code", "github-copilot", "gemini-cli"], scope: "project" }, project);
    await expect(fs.readFile(path.join(project, ".claude/agents/reviewer.md"), "utf8")).resolves.toContain("Reviews code safely");
    await expect(fs.readFile(path.join(project, ".github/agents/reviewer.agent.md"), "utf8")).resolves.toContain("Review changes for defects");
    await expect(fs.readFile(path.join(project, ".gemini/agents/reviewer.md"), "utf8")).resolves.not.toContain("Bash");
  });
});
