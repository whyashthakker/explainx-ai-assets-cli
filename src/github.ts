import path from "node:path";
import axios from "axios";
import AdmZip from "adm-zip";
import fs from "fs-extra";

const github = axios.create({
  baseURL: "https://api.github.com",
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": "epx-cli"
  },
  timeout: 30_000
});

export function parseRepository(source: string): { owner: string; repo: string } {
  const match = source.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error("repository must use the owner/repo format");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

export async function downloadRepository(source: string, destination: string, ref?: string): Promise<void> {
  const { owner, repo } = parseRepository(source);
  const url = ref
    ? `https://github.com/${owner}/${repo}/archive/refs/tags/${encodeURIComponent(ref)}.zip`
    : `https://github.com/${owner}/${repo}/archive/HEAD.zip`;
  const response = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 60_000 });
  const zip = new AdmZip(Buffer.from(response.data));
  await fs.ensureDir(destination);

  for (const entry of zip.getEntries()) {
    const normalized = path.normalize(entry.entryName).replace(/^(\.\.(\/|\\|$))+/, "");
    const output = path.resolve(destination, normalized);
    if (!output.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error("archive contains an unsafe path");
    if (entry.isDirectory) await fs.ensureDir(output);
    else {
      await fs.ensureDir(path.dirname(output));
      await fs.writeFile(output, entry.getData());
    }
  }
}

export async function getLatestRef(source: string): Promise<string | undefined> {
  const { owner, repo } = parseRepository(source);
  try {
    const release = await github.get<{ tag_name: string }>(`/repos/${owner}/${repo}/releases/latest`);
    return release.data.tag_name;
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
  }

  const tags = await github.get<Array<{ name: string }>>(`/repos/${owner}/${repo}/tags`, { params: { per_page: 1 } });
  return tags.data[0]?.name;
}
