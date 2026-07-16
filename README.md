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
epx list
epx update
epx remove react-review
epx validate
epx audit
```

Running `epx add <owner/repo>` in a terminal opens an interactive agent and scope picker. Universal agents always share `.agents/skills`. Type to search additional agents, use the arrow keys to move, Space to select, Ctrl+A to select all, Enter to confirm, and Escape to cancel cleanly. Pass `--codex`, `--claude-code`, `--cursor`, `--target <agent...>`, or `--all-agents` to skip the agent picker. Add `--global` for a user-wide installation; otherwise assets are installed in the current project.

Universal agents—including Codex and Cursor—use `.agents/skills/<name>`. Additional agents use their native directories, such as `.claude/skills/<name>` for Claude Code. The agent registry follows the destinations supported by the Vercel Labs Skills CLI.

Repositories without `epx.yaml` are also supported when they use the conventional `SKILL.md` layout, either at the repository root or under `skills/<name>/SKILL.md`. If several skills are present and none matches the repository name, select one with `--skill <name>`.

Installed packages and the local registry live in `~/.epx`. Set `EPX_HOME` to use another location.

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

## License

MIT
