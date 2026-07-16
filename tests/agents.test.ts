import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { ADDITIONAL_AGENT_NAMES, AGENTS, UNIVERSAL_AGENT_NAMES, getAgentDestination, installToAgents } from "../src/agents.js";
import { getPackagesDirectory } from "../src/config.js";

let home: string;
let project: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "epx-agents-home-"));
  project = await fs.mkdtemp(path.join(os.tmpdir(), "epx-agents-project-"));
  process.env.EPX_HOME = home;
});

afterEach(async () => {
  delete process.env.EPX_HOME;
  await fs.remove(home);
  await fs.remove(project);
});

describe("agent installation", () => {
  it("maps project destinations for supported agents", () => {
    expect(getAgentDestination("codex", "project", "demo", project)).toBe(path.join(project, ".agents/skills/demo"));
    expect(getAgentDestination("claude-code", "project", "demo", project)).toBe(path.join(project, ".claude/skills/demo"));
    expect(getAgentDestination("cursor", "project", "demo", project)).toBe(path.join(project, ".agents/skills/demo"));
  });

  it("includes the full upstream-style agent registry", () => {
    expect(Object.keys(AGENTS).length).toBeGreaterThanOrEqual(70);
    expect(UNIVERSAL_AGENT_NAMES).toContain("codex");
    expect(UNIVERSAL_AGENT_NAMES).toContain("cursor");
    expect(ADDITIONAL_AGENT_NAMES).toContain("claude-code");
  });

  it("copies a cached skill into the selected agent directories", async () => {
    await fs.outputFile(path.join(getPackagesDirectory(), "demo", "skills", "SKILL.md"), "# Demo");
    const destinations = await installToAgents({
      name: "demo",
      version: "1.0.0",
      type: "skill",
      source: "owner/demo",
      installedAt: new Date(0).toISOString()
    }, { agents: ["codex", "claude-code"], scope: "project" }, project);

    expect(destinations).toHaveLength(2);
    await expect(fs.readFile(path.join(project, ".agents/skills/demo/SKILL.md"), "utf8")).resolves.toBe("# Demo");
    await expect(fs.readFile(path.join(project, ".claude/skills/demo/SKILL.md"), "utf8")).resolves.toBe("# Demo");
  });
});
