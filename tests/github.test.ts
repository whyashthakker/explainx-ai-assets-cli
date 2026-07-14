import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import AdmZip from "adm-zip";
import nock from "nock";
import { afterEach, describe, expect, it } from "@jest/globals";
import { downloadRepository, getLatestRef, parseRepository } from "../src/github.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  nock.cleanAll();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe("GitHub client", () => {
  it.each([
    ["owner/repo", { owner: "owner", repo: "repo" }],
    [" owner/repo.git ", { owner: "owner", repo: "repo" }]
  ])("parses %s", (source, expected) => expect(parseRepository(source)).toEqual(expected));

  it.each(["repo", "owner/repo/extra", "https://github.com/owner/repo", "owner/"])(
    "rejects invalid repository value %s",
    (source) => expect(() => parseRepository(source)).toThrow("owner/repo format")
  );

  it("downloads and extracts the default branch archive", async () => {
    const zip = new AdmZip();
    zip.addFile("repo-main/epx.yaml", Buffer.from("name: demo"));
    zip.addFile("repo-main/skills/demo.md", Buffer.from("# Demo"));
    nock("https://github.com").get("/owner/repo/archive/HEAD.zip").reply(200, zip.toBuffer());
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "epx-download-"));
    temporaryDirectories.push(destination);

    await downloadRepository("owner/repo", destination);
    await expect(fs.readFile(path.join(destination, "repo-main", "skills", "demo.md"), "utf8")).resolves.toBe("# Demo");
  });

  it("downloads a requested tag and URL-encodes it", async () => {
    const zip = new AdmZip();
    zip.addFile("repo-v1/epx.yaml", Buffer.from("name: demo"));
    nock("https://github.com").get("/owner/repo/archive/refs/tags/release%2F1.0.zip").reply(200, zip.toBuffer());
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "epx-tag-"));
    temporaryDirectories.push(destination);
    await expect(downloadRepository("owner/repo", destination, "release/1.0")).resolves.toBeUndefined();
  });

  it("uses the latest release when available", async () => {
    nock("https://api.github.com").get("/repos/owner/repo/releases/latest").reply(200, { tag_name: "v2.0.0" });
    await expect(getLatestRef("owner/repo")).resolves.toBe("v2.0.0");
  });

  it("falls back to tags after a missing release", async () => {
    nock("https://api.github.com").get("/repos/owner/repo/releases/latest").reply(404);
    nock("https://api.github.com").get("/repos/owner/repo/tags").query({ per_page: 1 }).reply(200, [{ name: "v1.5.0" }]);
    await expect(getLatestRef("owner/repo")).resolves.toBe("v1.5.0");
  });

  it("returns undefined when there are no releases or tags", async () => {
    nock("https://api.github.com").get("/repos/owner/repo/releases/latest").reply(404);
    nock("https://api.github.com").get("/repos/owner/repo/tags").query(true).reply(200, []);
    await expect(getLatestRef("owner/repo")).resolves.toBeUndefined();
  });
});
