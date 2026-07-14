# EPX (ExplainX Package Exchange)

EPX is an open-source package manager for reusable AI assets. In Phase 1, GitHub repositories are the registry: no account or backend is required.



## Usage

```bash
epx add whyashthakker/react-review
epx list
epx update
epx remove react-review
epx validate
epx audit
```

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
