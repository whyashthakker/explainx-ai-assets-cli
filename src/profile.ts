import crypto from "node:crypto";
import fs from "fs-extra";
import { input } from "@inquirer/prompts";
import { getEpxHome, getProfilePath } from "./config.js";

export interface EpxProfile { id: string; name: string; email: string; createdAt: string }

function identityHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function readProfile(): Promise<EpxProfile | undefined> {
  if (!(await fs.pathExists(getProfilePath()))) return undefined;
  const value = await fs.readJson(getProfilePath()) as Partial<EpxProfile>;
  if (!value.id || !value.name || !value.email) throw new Error(`EPX profile is corrupt: ${getProfilePath()}`);
  return value as EpxProfile;
}

export async function saveProfile(name: string, email: string): Promise<EpxProfile> {
  const cleanName = name.trim(); const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) throw new Error("profile name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("a valid profile email is required");
  const existing = await readProfile().catch(() => undefined);
  const profile: EpxProfile = { id: identityHash(cleanEmail), name: cleanName, email: cleanEmail, createdAt: existing?.createdAt ?? new Date().toISOString() };
  await fs.ensureDir(getEpxHome()); await fs.writeJson(getProfilePath(), profile, { spaces: 2, mode: 0o600 });
  return profile;
}

export async function ensureProfile(): Promise<EpxProfile> {
  const existing = await readProfile(); if (existing) return existing;
  if (!process.stdin.isTTY) throw new Error("EPX profile is not configured; run 'epx profile set' first");
  console.log("\nSet up your EPX identity once. It will be stored only on this device.\n");
  const name = await input({ message: "Your name", validate: (value) => value.trim() ? true : "Name is required" });
  const email = await input({ message: "Your email", validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? true : "Enter a valid email" });
  return saveProfile(name, email);
}
