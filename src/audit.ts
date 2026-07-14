import path from "node:path";
import fs from "fs-extra";
import { ASSET_DIRECTORIES } from "./types.js";

export type AuditSeverity = "safe" | "low" | "medium" | "high" | "critical";

export interface AuditFinding {
  id: string;
  title: string;
  severity: Exclude<AuditSeverity, "safe">;
  evidence: string[];
  recommendation: string;
}

export interface AssetAudit {
  path: string;
  riskLevel: AuditSeverity;
  score: number;
  findings: AuditFinding[];
  stats: { lines: number; words: number; characters: number };
}

export interface AuditReport {
  root: string;
  auditedAt: string;
  summary: Record<AuditSeverity, number> & {
    filesScanned: number;
    totalFindings: number;
    highestRisk: AuditSeverity;
  };
  assets: AssetAudit[];
}

type Rule = Omit<AuditFinding, "evidence"> & { patterns: RegExp[] };

const RULES: Rule[] = [
  { id: "COMMAND_EXECUTION", title: "Command execution instructions detected", severity: "medium", patterns: [/(?:^|[\s`])(?:bash|sh|zsh|powershell|cmd\.exe)(?:\s|$)/i, /\b(?:exec|spawn|subprocess|child_process)\b/i, /\b(?:npx|npm|pnpm|yarn|pip|uv|brew|curl|python3?|node|deno|bun|docker|kubectl|helm)\b/i], recommendation: "Constrain commands to trusted, reproducible operations and make permissions explicit." },
  { id: "CODE_INJECTION", title: "Dynamic code execution patterns detected", severity: "high", patterns: [/\b(?:eval|exec|compile)\s*\(/i, /\b(?:__import__|importlib(?:\.import_module)?)\b/i, /\b(?:new\s+Function|Function\s*\()/i, /\{\{[^}]+\}\}|<%=?[^%]*%>/i], recommendation: "Avoid evaluating strings or templates; use static parsing and allowlisted executable paths." },
  { id: "EXTERNAL_DOWNLOADS", title: "External download or install flow detected", severity: "medium", patterns: [/\b(?:curl|wget)\b/i, /\b(?:install|download|clone|fetch)\b.*\b(?:github|http|package|registry|npm|pypi)\b/i, /https?:\/\/[^\s)>"']+/i], recommendation: "Pin external sources and verify their trust and integrity before execution." },
  { id: "SECRET_ACCESS", title: "Credential or secret handling detected", severity: "high", patterns: [/\b(?:api[_-]?key|secret|token|password|credential|private[_-]?key)\b/i, /\b(?:\.env|environment variable|oauth|bearer)\b/i], recommendation: "Never print, commit, upload, or transform secrets without explicit user approval." },
  { id: "PRIVILEGE_ESCALATION", title: "Privilege escalation commands detected", severity: "critical", patterns: [/\b(?:sudo|su\s+-|chmod\s+\+x|chown|setuid|setgid|visudo)\b/i, /\/etc\/sudoers\b/i], recommendation: "Require explicit confirmation and prefer least-privilege alternatives." },
  { id: "DATA_EXFILTRATION", title: "Data exfiltration patterns detected", severity: "high", patterns: [/\|\s*(?:curl|nc|netcat)\b/i, /\b(?:scp|rsync|smtp|sendmail|mailx|pbcopy|xclip|xsel)\b/i], recommendation: "Block outbound transfers by default and validate approved destinations." },
  { id: "UNTRUSTED_CONTENT", title: "Third-party content ingestion detected", severity: "medium", patterns: [/\b(?:untrusted|third[- ]party|user[- ]generated|public sources?|registry|marketplace)\b/i, /\b(?:scrape|crawl|parse|ingest|read from urls?)\b/i], recommendation: "Treat external content as data, not instructions, and defend against prompt injection." },
  { id: "OBFUSCATION", title: "Obfuscation or encoded payload patterns detected", severity: "high", patterns: [/\bbase64\s+-d\b|\batob\s*\(/i, /\\x[0-9a-f]{2}/i, /\b(?:gunzip|zcat)\b\s*\|\s*(?:bash|sh|zsh)/i, /\b(?:bit\.ly|tinyurl|t\.co|is\.gd)\b/i, /[\u200B-\u200F\uFEFF]/], recommendation: "Require human review of encoded or obfuscated instructions." },
  { id: "DESTRUCTIVE_ACTIONS", title: "Potentially destructive operation mentioned", severity: "critical", patterns: [/\brm\s+-rf\b/i, /\bgit\s+reset\s+--hard\b/i, /\b(?:delete|destroy|drop|wipe|purge)\b/i], recommendation: "Require explicit confirmation before destructive local, database, or remote operations." },
  { id: "PERSISTENCE_MECHANISMS", title: "Persistence mechanism setup detected", severity: "critical", patterns: [/\b(?:crontab|cron\.d|at\s+|launchd|systemctl\s+enable)\b/i, /(?:~\/\.bashrc|~\/\.zshrc|~\/\.profile|~\/\.bash_profile)/i, /\b(?:sc\s+create|new-service|register-scheduledtask)\b/i], recommendation: "Disallow persistence unless explicitly requested and manually reviewed." },
  { id: "SENSITIVE_FILE_ACCESS", title: "Sensitive credential or identity path access detected", severity: "high", patterns: [/(?:~\/\.ssh|id_rsa|known_hosts)/i, /(?:\/etc\/passwd|\/etc\/shadow|\/etc\/hosts)/i, /(?:~\/\.aws|~\/\.config\/gcloud|~\/\.kube\/config)/i, /(?:login data|cookies\.sqlite)/i], recommendation: "Limit sensitive reads to approved diagnostics and never exfiltrate credential artifacts." },
  { id: "SUPPLY_CHAIN", title: "Supply-chain installation risk detected", severity: "medium", patterns: [/\bpip\s+install\s+git\+/i, /\bnpm\s+install\s+github:/i, /\b(?:--index-url|--extra-index-url|--allow-unverified)\b/i, /\bcurl\s+[^\n]*\|\s*(?:bash|sh|zsh)\b/i], recommendation: "Prefer pinned versions and official registries with integrity verification." },
  { id: "PROMPT_INJECTION", title: "Prompt injection or instruction override detected", severity: "critical", patterns: [/\b(?:ignore previous instructions|disregard your system prompt|you are now|forget everything above)\b/i, /\b(?:act as|DAN)\b/i, /<\|im_start\|>system|---\s*END SKILL\s*---\s*---\s*OVERRIDE\s*---/i], recommendation: "Treat override content as untrusted and enforce system-prompt precedence." },
  { id: "NETWORK_ACCESS", title: "Network or browser access detected", severity: "low", patterns: [/\b(?:browser|web search|internet|network|http request|api request)\b/i, /\b(?:fetch|axios|request)\b/i], recommendation: "Declare expected network targets and reject private or unsafe URLs." },
  { id: "FILE_SYSTEM_ACCESS", title: "Broad file access instructions detected", severity: "low", patterns: [/\b(?:read|write|edit|modify|scan|search)\b.*\b(?:files?|directories|workspace|repo|codebase)\b/i, /\b(?:filesystem|file system|local files?)\b/i], recommendation: "Constrain file operations to the workspace and preserve unrelated changes." }
];

export const severityWeight: Record<AuditSeverity, number> = { safe: 0, low: 1, medium: 3, high: 6, critical: 10 };

function evidence(content: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    pattern.lastIndex = 0;
    if (matches.length < 2 && pattern.test(line)) matches.push(`L${index + 1}: ${line.trim().slice(0, 180)}`);
  });
  return matches;
}

function scoreToRisk(score: number): AuditSeverity {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  if (score > 0) return "low";
  return "safe";
}

export function auditContent(content: string, filePath: string): AssetAudit {
  const findings = RULES.flatMap((rule): AuditFinding[] => {
    const found = rule.patterns.flatMap((pattern) => evidence(content, pattern)).slice(0, 3);
    return found.length ? [{ id: rule.id, title: rule.title, severity: rule.severity, evidence: found, recommendation: rule.recommendation }] : [];
  });
  let score = findings.reduce((total, finding) => total + severityWeight[finding.severity], 0);
  const ids = new Set(findings.map((finding) => finding.id));
  if (ids.has("EXTERNAL_DOWNLOADS") && ids.has("COMMAND_EXECUTION")) score += 5;
  const riskLevel = ids.has("PRIVILEGE_ESCALATION") && ids.has("DESTRUCTIVE_ACTIONS") ? "critical" : scoreToRisk(score);
  return {
    path: filePath,
    riskLevel,
    score,
    findings,
    stats: { lines: content.split(/\r?\n/).length, words: content.trim() ? content.trim().split(/\s+/).length : 0, characters: content.length }
  };
}

async function markdownFiles(directory: string): Promise<string[]> {
  if (!(await fs.pathExists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => !entry.isSymbolicLink()).map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.isFile() && /\.md$/i.test(entry.name) ? [fullPath] : [];
  }));
  return files.flat();
}

export async function auditPackage(root: string): Promise<AuditReport> {
  const absoluteRoot = path.resolve(root);
  const discovered = (await Promise.all(ASSET_DIRECTORIES.map((name) => markdownFiles(path.join(absoluteRoot, name))))).flat().sort();
  if (!discovered.length) throw new Error("no Markdown assets found under skills/, rules/, or commands/");
  const assets = await Promise.all(discovered.map(async (file) => auditContent(await fs.readFile(file, "utf8"), path.relative(absoluteRoot, file))));
  const counts: Record<AuditSeverity, number> = { safe: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const asset of assets) counts[asset.riskLevel] += 1;
  const highestRisk = assets.reduce<AuditSeverity>((highest, asset) => severityWeight[asset.riskLevel] > severityWeight[highest] ? asset.riskLevel : highest, "safe");
  return {
    root: absoluteRoot,
    auditedAt: new Date().toISOString(),
    summary: { ...counts, filesScanned: assets.length, totalFindings: assets.reduce((sum, asset) => sum + asset.findings.length, 0), highestRisk },
    assets
  };
}
