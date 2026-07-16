import path from "node:path";
import fs from "fs-extra";
import { confirm } from "@inquirer/prompts";
import { downloadRepository } from "./github.js";
import { searchableAgentCheckbox } from "./agent-prompt.js";

async function repositoryRoot(source: string): Promise<{ temporary: string; root: string }> {
  const temporary = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "epx-simple-"));
  await downloadRepository(source, temporary);
  const entries = await fs.readdir(temporary, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  return { temporary, root: directories.length === 1 ? path.join(temporary, directories[0].name) : temporary };
}

async function choose(items: string[], noun: string): Promise<string[] | null> {
  if (items.length === 1) return items;
  return searchableAgentCheckbox({ message: `Which ${noun}s do you want to install?`, universal: [], choices: items.map((name) => ({ name, value: name, path: noun })), noun: `${noun}s`, pageSize: 12 });
}

async function conflictingFiles(source: string, destination: string): Promise<string[]> {
  const conflicts: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const relative = path.relative(source, full);
        if (await fs.pathExists(path.join(destination, relative))) conflicts.push(relative);
      }
    }
  }
  await walk(source);
  return conflicts;
}

export async function installTemplates(source: string, requested?: string, project = process.cwd()): Promise<string[]> {
  const { temporary, root } = await repositoryRoot(source);
  try {
    const directory = path.join(root, "templates");
    if (!(await fs.pathExists(directory))) throw new Error("templates/ directory was not found");
    const names = (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (!names.length) throw new Error("no templates were discovered");
    const selected = requested ? [requested] : await choose(names, "template");
    if (!selected?.length) return [];
    for (const name of selected) {
      const template = path.join(directory, name);
      if (!(await fs.pathExists(template))) throw new Error(`template '${name}' was not found`);
      const conflicts = await conflictingFiles(template, project);
      if (conflicts.length) throw new Error(`template '${name}' would overwrite existing files: ${conflicts.slice(0, 5).join(", ")}`);
    }
    if (!(await confirm({ message: `Copy ${selected.join(", ")} into ${project}?`, default: true }))) return [];
    for (const name of selected) await fs.copy(path.join(directory, name), project, { overwrite: false, errorOnExist: true });
    return selected;
  } finally { await fs.remove(temporary); }
}

const CONTEXT_CLIENTS = {
  codex: "AGENTS.md",
  "claude-code": "CLAUDE.md",
  "gemini-cli": "GEMINI.md"
} as const;

export async function installContextPacks(source: string, requested?: string, project = process.cwd()): Promise<string[]> {
  const { temporary, root } = await repositoryRoot(source);
  try {
    const parent = ["contexts", "context", "knowledge"].map((name) => path.join(root, name)).find((directory) => fs.existsSync(directory));
    if (!parent) throw new Error("contexts/, context/, or knowledge/ directory was not found");
    const entries = await fs.readdir(parent, { withFileTypes: true });
    const directoryNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const names = directoryNames.length ? directoryNames : [source.split("/").at(-1) ?? "context"];
    const selected = requested ? [requested] : await choose(names, "context pack");
    if (!selected?.length) return [];
    const clients = await searchableAgentCheckbox({ message: "Which agents should load these context packs?", universal: [], choices: Object.entries(CONTEXT_CLIENTS).map(([value, file]) => ({ name: value, value, path: file })), noun: "context clients" });
    if (!clients?.length) return [];
    for (const name of selected) {
      const sourceDirectory = directoryNames.length ? path.join(parent, name) : parent;
      if (!(await fs.pathExists(sourceDirectory))) throw new Error(`context pack '${name}' was not found`);
      const destination = path.join(project, ".agents/context", name);
      await fs.remove(destination);
      await fs.copy(sourceDirectory, destination);
      for (const client of clients) {
        const file = path.join(project, CONTEXT_CLIENTS[client as keyof typeof CONTEXT_CLIENTS]);
        const start = `<!-- epx:context:${name}:start -->`;
        const end = `<!-- epx:context:${name}:end -->`;
        const block = `${start}\nWhen relevant, read the knowledge pack at .agents/context/${name}/ before acting.\n${end}`;
        const existing = await fs.pathExists(file) ? await fs.readFile(file, "utf8") : "";
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matcher = new RegExp(`<!-- epx:context:${escaped}:start -->[\\s\\S]*?<!-- epx:context:${escaped}:end -->`, "g");
        await fs.outputFile(file, matcher.test(existing) ? existing.replace(matcher, block) : `${existing.trimEnd()}${existing ? "\n\n" : ""}${block}\n`);
      }
    }
    return selected;
  } finally { await fs.remove(temporary); }
}
