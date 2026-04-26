# Roadmap

Items the maintainer plans to address. PRs welcome — open an issue first to coordinate.

## Release infrastructure (deferred)

- [ ] **Publish to npm** as `gemini-mcp-wrapper` (unscoped). Needs: `npm login`, `npm publish --access public`. Once 1.0.x is on the registry, the README's `npx -y gemini-mcp-wrapper` install path becomes valid for end users.
- [ ] **GitHub Actions release workflow** (`.github/workflows/release.yml`) — on push to a `v*` tag: `npm ci` → `npm run validate` → `npm publish` with `NPM_TOKEN` repo secret + `provenance: true` for supply-chain attestation.
- [ ] **GitHub Actions CI workflow** (`.github/workflows/ci.yml`) — on every PR: `npm ci` → `npm run validate` (typecheck + lint + format:check + build + test) on Node 18, 20, 22.
- [ ] **Dependabot config** (`.github/dependabot.yml`) — weekly bumps for npm + GitHub Actions.

## Code/documentation polish

- [ ] Add an `examples/` directory with worked examples of each tool's input/output.
- [ ] Document the Redis session backend in more detail (Redis schema, key TTLs, failover behaviour).
- [ ] Add a CHANGELOG.md and adopt [Keep a Changelog](https://keepachangelog.com/) format.
- [ ] Document the validation protocol failure modes (what happens when Gemini's output fails each of the four checks).

## Compatibility

- [ ] Verify with non-Claude MCP clients (Cursor, Cline, Continue) and document any client-specific config quirks.
- [ ] Test on Windows (currently exercised on macOS / Linux only).

## Stretch

- [ ] Optional structured output schema validation (JSON-Schema per tool) so Claude's "format check" can be automated rather than vibes-based.
- [ ] Telemetry hooks (opt-in, off by default) so the maintainer can see which tools are used in the wild.
