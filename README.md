# Gemini MCP Wrapper

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](#prerequisites)

MCP server that wraps the Google Gemini CLI for delegating token-heavy operations from Claude Code (or any MCP client) to Gemini's 2M-token context window.

> **Status**: Working in production for the maintainer's daily Claude Code workflow. Independently released here for community use. **npm publishing and CI/CD release automation are tracked in [ROADMAP.md](ROADMAP.md)** — until then, install from source.

## Why

Claude Code has a 200K-token context window; Gemini CLI has 2M. Some operations (scanning a 200-file codebase, summarising a 1000-page PDF, deep web research) blow Claude's context but fit comfortably in Gemini's. This MCP server lets Claude **delegate** those operations to Gemini, then validate the result.

**Operating principle**: Claude orchestrates, Gemini executes. Claude is responsible for validating every Gemini output before accepting it (scope, format, completeness, pattern compliance).

## Installation

### From source (current path)

```bash
git clone https://github.com/NeverGET/gemini-mcp-wrapper.git
cd gemini-mcp-wrapper
npm install
npm run build
```

Add to your MCP client config (e.g. `~/.claude.json` for Claude Code, or `claude_desktop_config.json` for Claude Desktop):

```json
{
  "mcpServers": {
    "gemini-wrapper": {
      "command": "node",
      "args": ["/absolute/path/to/gemini-mcp-wrapper/dist/index.js"]
    }
  }
}
```

### From npm (planned)

Once published (see [ROADMAP.md](ROADMAP.md)):

```json
{
  "mcpServers": {
    "gemini-wrapper": {
      "command": "npx",
      "args": ["-y", "gemini-mcp-wrapper"]
    }
  }
}
```

## Prerequisites

- **Node.js 18+**
- **Gemini CLI** installed and authenticated (`gemini` command on `$PATH`). Install via `npm i -g @google/gemini-cli` then run `gemini auth login`.
- **Optional: Redis** for session persistence (uses file-based sessions by default — Redis only needed for multi-process or shared-host deployments).

## Tools

The server exposes 8 MCP tools. Each one delegates a specific class of token-heavy operation.

### `gemini_research` — deep web research and documentation lookup

```json
{
  "query": "Best practices for implementing JWT authentication",
  "depth": "deep",
  "sources": ["auth0.com", "jwt.io"],
  "max_results": 10
}
```

**Delegate when**: deep research, multiple sources, documentation analysis spanning >5 pages.

### `gemini_file_scan` — scan large directories (>10 files)

```json
{
  "path": "src/",
  "pattern": "**/*.ts",
  "max_files": 50,
  "include_content": true,
  "recursive": true
}
```

**Delegate when**: codebase exploration crossing >10 files.

### `gemini_generate` — generate multiple files (>5)

```json
{
  "spec": "Create a REST API for user management",
  "files": [
    { "path": "src/models/user.ts", "description": "User model" },
    { "path": "src/routes/users.ts", "description": "User routes" },
    { "path": "src/controllers/userController.ts", "description": "User controller" }
  ],
  "style_guide": "Use TypeScript strict mode, functional patterns"
}
```

**Delegate when**: scaffolding >5 files at once.

### `gemini_dialogue` — multi-model brainstorming

```json
{
  "topic": "Authentication architecture",
  "context": "Building a SaaS application with multi-tenant support",
  "questions": [
    "What auth pattern is best for multi-tenant SaaS?",
    "How should we handle token refresh?"
  ],
  "perspective": "security architect"
}
```

**Delegate when**: design discussions, architecture review where a second model's perspective is valuable.

### `gemini_test` — bulk test execution and generation

```json
{
  "test_type": "unit",
  "scope": "src/services/",
  "coverage_threshold": 80,
  "generate_missing": true
}
```

**Delegate when**: large test suites, coverage analysis crossing many files.

### `gemini_document` — generate comprehensive documentation

```json
{
  "scope": "src/api/",
  "format": "markdown",
  "sections": ["Overview", "Authentication", "Endpoints", "Examples"],
  "include_examples": true
}
```

**Delegate when**: API docs, multi-section documentation >2000 lines of expected output.

### `gemini_analyze` — deep codebase analysis

```json
{
  "path": "src/",
  "depth": "deep",
  "focus": "security"
}
```

**Focus options**: `architecture`, `patterns`, `dependencies`, `security`, `performance`, `all`.

**Delegate when**: architecture review, security audit, performance analysis spanning the whole codebase.

### `gemini_continue` — resume incomplete operations

```json
{
  "session_id": "abc123-def456"
}
```

**Use when**: previous Gemini operation timed out or output was truncated.

## Session Management

Sessions are persisted so long-running operations and Gemini output truncation can be resumed.

- **File-based (default)**: `.claude/sessions/gemini-{id}.json`. No setup required.
- **Redis (optional)**: set `REDIS_URL` to use Redis instead of the filesystem. Useful for multi-process or shared-host setups.

## Validation Protocol

The MCP server hands raw Gemini output back to the client; **the client (Claude) is expected to validate before accepting**. The four checks Claude should run:

1. **Scope check** — output matches the requested scope (didn't drift).
2. **Format check** — expected structure / syntax (JSON parses, code compiles, etc.).
3. **Completeness** — all requested items present (no silent truncation).
4. **Pattern compliance** — follows the project's conventions (steering doc, style guide, etc.).

## Environment Variables

| Variable          | Description                                  | Default              |
| ----------------- | -------------------------------------------- | -------------------- |
| `SCW_SESSION_DIR` | Session storage directory                    | `.claude/sessions`   |
| `REDIS_URL`       | Redis connection URL (optional)              | unset → file backend |

## Project Structure

```
gemini-mcp-wrapper/
├── package.json
├── tsconfig.json
├── ROADMAP.md
├── LICENSE
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── types.ts          # Type definitions
│   ├── gemini-cli.ts     # Gemini CLI executor
│   ├── session.ts        # Session tracking
│   ├── validation.ts     # Output validation helpers
│   └── tools/
│       ├── research.ts
│       ├── file-scan.ts
│       ├── generate.ts
│       ├── dialogue.ts
│       ├── test.ts
│       ├── document.ts
│       ├── analyze.ts
│       └── continue.ts
└── README.md
```

## Origin

This server was extracted from the maintainer's `SuperClaudeSpecWorkflow` framework, where it provides the delegation layer for the `/scw:*` commands. The wrapper is generally useful outside that context, hence this independent release.

If you're building MCP clients that talk to Gemini, the `src/gemini-cli.ts` executor and `src/session.ts` resumption logic should be reusable as a library — feel free to copy or open an issue to request a published `lib` entrypoint.

## Contributing

Issues and PRs welcome. Please open an issue first for non-trivial changes so we can coordinate. The `npm run validate` script runs typecheck + lint + format-check + build + tests — make it pass before opening a PR.

## License

[MIT](LICENSE)
