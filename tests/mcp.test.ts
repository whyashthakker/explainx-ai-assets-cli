import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { addMcpUrl } from "../src/mcp.js";

let project: string;

beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), "epx-mcp-project-"));
});

afterEach(async () => {
  await fs.remove(project);
});

describe("MCP URL installation", () => {
  it("installs one URL into each selected client's native project config", async () => {
    await addMcpUrl("https://mcp.upstox.com/mcp", {
      targets: ["codex", "claude-code", "cursor", "gemini-cli", "github-copilot"],
      scope: "project",
      projectDirectory: project
    });

    await expect(fs.readFile(path.join(project, ".codex/config.toml"), "utf8")).resolves.toContain("[mcp_servers.upstox]");
    await expect(fs.readJson(path.join(project, ".mcp.json"))).resolves.toMatchObject({ mcpServers: { "Upstox MCP": { type: "http", url: "https://mcp.upstox.com/mcp" } } });
    await expect(fs.readJson(path.join(project, ".cursor/mcp.json"))).resolves.toMatchObject({ mcpServers: { "Upstox MCP": { url: "https://mcp.upstox.com/mcp" } } });
    await expect(fs.readJson(path.join(project, ".gemini/settings.json"))).resolves.toMatchObject({ mcpServers: { "Upstox MCP": { httpUrl: "https://mcp.upstox.com/mcp" } } });
    await expect(fs.readJson(path.join(project, ".vscode/mcp.json"))).resolves.toMatchObject({ inputs: [], servers: { "Upstox MCP": { type: "http", url: "https://mcp.upstox.com/mcp" } } });
  });

  it("preserves unrelated existing configuration", async () => {
    await fs.outputJson(path.join(project, ".cursor/mcp.json"), { theme: "dark", mcpServers: { existing: { url: "https://example.com/mcp" } } });
    await addMcpUrl("https://mcp.upstox.com/mcp", { targets: ["cursor"], scope: "project", projectDirectory: project });
    const config = await fs.readJson(path.join(project, ".cursor/mcp.json"));
    expect(config.theme).toBe("dark");
    expect(config.mcpServers.existing.url).toBe("https://example.com/mcp");
    expect(config.mcpServers["Upstox MCP"].url).toBe("https://mcp.upstox.com/mcp");
  });

  it("rejects non-HTTP sources", async () => {
    await expect(addMcpUrl("file:///tmp/server", { targets: ["cursor"], scope: "project", projectDirectory: project })).rejects.toThrow("must use http or https");
  });
});
