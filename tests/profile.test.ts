import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getProfilePath } from "../src/config.js";
import { readProfile, saveProfile } from "../src/profile.js";

let home: string;
beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), "epx-profile-")); process.env.EPX_HOME = home; });
afterEach(async () => { delete process.env.EPX_HOME; await fs.remove(home); });

describe("local EPX profile", () => {
  it("stores a normalized identity and stable email hash locally", async () => {
    const first = await saveProfile("Rahul Santra", "Rahul@ExplainX.AI");
    const second = await saveProfile("Rahul", "rahul@explainx.ai");
    expect(first.id).toBe(second.id); expect(await readProfile()).toMatchObject({ name: "Rahul", email: "rahul@explainx.ai", id: first.id });
    const serialized = await fs.readFile(getProfilePath(), "utf8"); expect(serialized).toContain("rahul@explainx.ai");
  });

  it("rejects invalid email addresses", async () => {
    await expect(saveProfile("Rahul", "not-an-email")).rejects.toThrow("valid profile email");
  });
});
