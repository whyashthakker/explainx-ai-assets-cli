# EPX (ExplainX Package Exchange)

EPX is an open-source package manager for reusable AI assets. In Phase 1, GitHub repositories are the registry: no account or backend is required.



## Usage

Every EPX command starts with the ExplainX ASCII banner. The banner is written to stderr so structured stdout, including `epx audit --json`, remains pipe-safe.

```bash
epx add whyashthakker/react-review
epx add whyashthakker/react-review --codex
epx add whyashthakker/react-review --target codex claude-code
epx add anthropics/skills --skill frontend-design --codex
epx add anthropics/skills --skill frontend-design --all-agents
epx add owner/ai-rules --rule typescript
epx add owner/ai-rules --rule typescript --codex --claude-code --cursor
epx add owner/ai-rules --rule typescript --all-agents
epx prompt add microsoft/vscode find-duplicates
epx cmd add iannuttall/claude-sessions session-help --codex --claude-code --cursor
epx list
epx update
epx remove react-review
epx validate
epx audit
epx audit react-review
epx mcp add https://mcp.upstox.com/mcp
epx agent add github/awesome-copilot
epx instruction add owner/repo
epx template add owner/repo
epx context add owner/repo
epx mcp add https://mcp.upstox.com/mcp --codex --claude-code --cursor
```

Running `epx add <owner/repo>` in a terminal opens an interactive agent and scope picker. Universal agents always share `.agents/skills`. Type to search additional agents, use the arrow keys to move, Space to select, Ctrl+A to select all, Enter to confirm, and Escape to cancel cleanly. Pass `--codex`, `--claude-code`, `--cursor`, `--target <agent...>`, or `--all-agents` to skip the agent picker. Add `--global` for a user-wide installation; otherwise assets are installed in the current project.

Universal agents—including Codex and Cursor—use `.agents/skills/<name>`. Additional agents use their native directories, such as `.claude/skills/<name>` for Claude Code. The agent registry follows the destinations supported by the Vercel Labs Skills CLI.

Repositories without `epx.yaml` are also supported when they use the conventional `SKILL.md` layout, either at the repository root or under `skills/<name>/SKILL.md`. If several skills are present and none matches the repository name, select one with `--skill <name>`.

### Universal rules

Install one rule from a GitHub repository and use it across multiple AI coding agents:

```bash
epx add owner/repo --rule typescript
```

The interactive picker currently supports native rule installation for Codex, Claude Code, Cursor, GitHub Copilot, Gemini CLI, Cline, Roo Code, and Windsurf. Use arrows to move, Space to select, Ctrl+A to select every compatible agent, and Enter to install. Skip the picker with agent flags or `--all-agents`:

At least one target agent must be selected. Confirming with no selected agents cancels the target installation while retaining the audited canonical package in `~/.epx/packages`.

```bash
epx add owner/repo --rule typescript --codex --cursor
epx add owner/repo --rule typescript --all-agents
```

EPX discovers conventional rules from `rules/`, `.cursor/rules/`, `.claude/rules/`, `.github/instructions/`, `.windsurf/rules/`, `.roo/rules/`, and `.clinerules/`, as well as `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. If a repository contains exactly one rule, `epx add owner/repo` detects it automatically. When several rules exist, EPX opens a searchable rule picker. Use arrows to move, Space to select multiple rules, Ctrl+A to select all, Enter to confirm, or Escape to cancel. Pass `--rule <name>` to install one known rule without opening the rule picker.

EPX keeps the downloaded canonical rule under `~/.epx/packages/<name>/rules` and generates the native target format. For example, Cursor receives `.cursor/rules/<name>.mdc`, Claude Code receives `.claude/rules/<name>.md`, Copilot receives `.github/instructions/<name>.instructions.md`, and Codex receives an idempotent EPX-managed section in `AGENTS.md`. Existing content outside an EPX-managed section is preserved.

Installed packages and the local registry live in `~/.epx`. Set `EPX_HOME` to use another location.

### Commands and prompts

Install reusable commands or prompts from GitHub:

```bash
epx cmd add owner/repo create-pr
epx prompt add owner/repo code-review
```

Use the separate `epx cmd add` and `epx prompt add` namespaces so repositories containing several kinds of AI assets are never misclassified. When a repository contains multiple commands or prompts and no name is supplied, EPX opens the searchable multi-select picker. Selected assets can be installed for Codex, Claude Code, Cursor, GitHub Copilot, and Gemini CLI. EPX detects `commands/`, `prompts/`, `.claude/commands/`, `.cursor/commands/`, `.gemini/commands/`, `.github/prompts/`, and `.codex/prompts/`. It writes Markdown for Codex, Claude Code, and Cursor, `.prompt.md` for Copilot, and valid command TOML for Gemini CLI.

### Custom agents and subagents

Discover and install custom agents from GitHub:

```bash
epx agent add github/awesome-copilot
epx agent add github/awesome-copilot prompt-builder --copilot
epx agent add owner/repo security-reviewer --all-agents
```

EPX detects agents recursively under `agents/`, `.github/agents/`, `.claude/agents/`, and `.gemini/agents/`. Omitting the name opens the searchable multi-select picker. The first release targets Claude Code, GitHub Copilot, and Gemini CLI. EPX preserves the agent instructions and description but deliberately removes source-specific tool and model declarations during conversion so installing an agent cannot silently broaden permissions on another client.

### Instructions, templates, and context packs

Install persistent instructions without colliding with skill or prompt detection:

```bash
epx instruction add owner/repo
epx instruction add owner/repo security --all-agents
```

Instruction discovery supports `instructions/`, `rules/`, `.github/instructions/`, `.cursor/rules/`, `.claude/rules/`, root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md`. It uses the same native conversion and managed-file behavior as universal rules.

Template repositories use `templates/<name>/`. EPX copies the selected template into the current directory and refuses the entire installation if any destination file already exists:

```bash
epx template add owner/repo
epx template add owner/repo nextjs
```

Context repositories use `contexts/<name>/`, `context/<name>/`, or `knowledge/<name>/`. EPX stores packs under `.agents/context/<name>/` and adds idempotent managed references to the selected `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` files:

```bash
epx context add owner/repo
epx context add owner/repo architecture
```

### MCP servers

Install a remote Streamable HTTP or SSE MCP URL and select the clients that should receive it:

```bash
epx mcp add https://mcp.upstox.com/mcp
```

Use the searchable picker or skip it with flags:

```bash
epx mcp add https://mcp.upstox.com/mcp --codex --claude-code --cursor
epx mcp add https://mcp.upstox.com/mcp --all-agents
epx mcp add https://example.com/mcp --name example
```

EPX installs MCP servers globally and merges them without deleting existing settings. User-level installations target `~/.codex/config.toml`, `~/.claude.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`, and VS Code's platform-specific user `mcp.json` for Codex, Claude Code, Cursor, Gemini CLI, and GitHub Copilot respectively. Restart the selected client after installation so it reloads its MCP configuration. Remote OAuth is completed by the selected client when it first connects; EPX does not collect or store OAuth tokens.

## Package format

An EPX repository has an `epx.yaml` file at its root and one or more supported asset directories:

```text
react-review/
├── epx.yaml
├── skills/
│   └── review.md
├── rules/
│   └── react-rules.md
└── commands/
    └── review.md
```

```yaml
name: react-review
version: 1.0.0
description: React code review assistant
type: skill
targets:
  - claude
  - cursor
  - codex
```

`name`, `version`, and `type` are required. `type` must be `skill`, `rule`, or `command`, and its matching plural directory must be present and non-empty. Extra supported directories may be included in the same package.

Updates use the repository's latest GitHub release, falling back to its newest tag. The release/tag must contain an `epx.yaml` whose version is newer than the installed version.

## Security audit

Audit every Markdown file under `skills/`, `rules/`, and `commands/` using the same heuristic risk categories as the explainx.ai skill scanner:

```bash
epx audit
epx audit react-review
epx audit ./my-package --json
epx audit --fail-on critical
```

The audit checks for command and dynamic code execution, downloads, secret access, privilege escalation, exfiltration, obfuscation, destructive actions, persistence, sensitive paths, supply-chain risks, prompt injection, network access, and broad filesystem access. It is static heuristic analysis, so findings require human review. By default the command exits with status 1 when the highest risk is `high` or `critical`, making it suitable for CI.

## Development

```bash
npm install
npm run build
npm test
```

The Jest suite uses mocked GitHub responses and isolated temporary EPX homes, so it does not modify `~/.epx` or require live repositories. Run coverage with `npm run test:coverage` and watch mode with `npm run test:watch`.

Publish a verified public release with npm's passkey-compatible client:

```bash
npm run release
```

The release script runs type checking, tests, the production build, and a package dry run before publishing. Authentication remains in npm's user-level configuration and is never stored in this repository.

## License

MIT
