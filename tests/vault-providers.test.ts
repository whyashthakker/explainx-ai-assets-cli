import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { McpVaultProvider } from "../src/vault-providers.js";
import { GitVaultProvider } from "../src/vault-providers.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

let temporary: string;
beforeEach(async () => { temporary = await fs.mkdtemp(path.join(os.tmpdir(), "epx-vault-provider-")); process.env.EPX_HOME = path.join(temporary, "home"); });
afterEach(async () => { delete process.env.EPX_HOME; nock.cleanAll(); await fs.remove(temporary); });

describe("MCP vault provider", () => {
  it("downloads and uploads base64 snapshots through the EPX MCP contract", async () => {
    const connection = { name: "remote", provider: "mcp" as const, location: "https://vault.example/mcp", connectedAt: new Date().toISOString() };
    nock("https://vault.example").post("/mcp", (body) => body.method === "tools/call" && body.params.name === "vault_get_snapshot")
      .reply(200, { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ files: { "epx-vault.yaml": Buffer.from("schemaVersion: 1\n").toString("base64") } }) }] } });
    const provider = new McpVaultProvider(); const root = await provider.prepare(connection);
    await expect(fs.readFile(path.join(root, "epx-vault.yaml"), "utf8")).resolves.toBe("schemaVersion: 1\n");

    nock("https://vault.example").post("/mcp", (body) => body.method === "tools/call" && body.params.name === "vault_put_snapshot" && body.params.arguments.expectedRevision === 3).reply(200, { jsonrpc: "2.0", id: 2, result: { structuredContent: { ok: true } } });
    await provider.publish(connection, root, 3); expect(nock.isDone()).toBe(true);
  });

  it("rejects unsafe paths returned by a remote server", async () => {
    const connection = { name: "bad", provider: "mcp" as const, location: "https://vault.example/mcp", connectedAt: new Date().toISOString() };
    nock("https://vault.example").post("/mcp").reply(200, { jsonrpc: "2.0", result: { content: [{ type: "text", text: JSON.stringify({ files: { "../secret": "eA==" } }) }] } });
    await expect(new McpVaultProvider().prepare(connection)).rejects.toThrow("unsafe path");
  });
});

describe("Git vault provider", () => {
  it("clones, commits, and pushes without force-updating history", async () => {
    const bare = path.join(temporary, "remote.git"); const seed = path.join(temporary, "seed");
    await exec("git", ["init", "--bare", bare]); await fs.ensureDir(seed); await exec("git", ["init"], { cwd: seed });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: seed }); await exec("git", ["config", "user.name", "EPX Test"], { cwd: seed });
    await fs.outputFile(path.join(seed, "epx-vault.yaml"), "schemaVersion: 1\nname: test\npolicy:\n  reviewers: []\n  approvalsRequired: 1\n  blockSeverities: [high, critical]\n  preventSelfApproval: true\n");
    await fs.outputJson(path.join(seed, "epx-vault.lock"), { schemaVersion: 1, revision: 0, assets: {} }, { spaces: 2 });
    await exec("git", ["add", "."], { cwd: seed }); await exec("git", ["commit", "-m", "init"], { cwd: seed }); await exec("git", ["remote", "add", "origin", bare], { cwd: seed }); await exec("git", ["push", "-u", "origin", "HEAD"], { cwd: seed });
    const connection = { name: "git-team", provider: "git" as const, location: bare, connectedAt: new Date().toISOString() }; const provider = new GitVaultProvider();
    const checkout = await provider.prepare(connection); await exec("git", ["config", "user.email", "test@example.com"], { cwd: checkout }); await exec("git", ["config", "user.name", "EPX Test"], { cwd: checkout });
    const snapshot = path.join(temporary, "snapshot"); await fs.copy(checkout, snapshot, { filter: (file) => path.basename(file) !== ".git" });
    const lock = await fs.readJson(path.join(snapshot, "epx-vault.lock")); lock.revision = 1; await fs.writeJson(path.join(snapshot, "epx-vault.lock"), lock, { spaces: 2 });
    await provider.publish(connection, snapshot, 0);
    expect((await exec("git", ["--git-dir", bare, "log", "-1", "--pretty=%s"])).stdout.trim()).toBe("chore(vault): publish EPX assets");
  });
});
