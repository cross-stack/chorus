# Chorus - Positron extension prototype

**Vision**: Chorus helps developer teams turn code reviews and technical debates into learning-centered, equitable, and evidence-first decision spaces. Hidden context is surfaced. Conformity pressure is reduced. Evidence and task-fit decision rules become central.

**Phase 1 objectives**:
- Context: index local repo signals and surface likely relevant PRs, incidents, docs, owners.
- Evidence: inject a PR evidence block and provide an evidence list UI with required fields and local validation.
- Equity: blinded first-pass reviews and quiet ballots stored locally with reveal controls.

**Immediate value slice**:
- Working VS Code/Positron extension with panel tabs: Context, Evidence, Equity.
- Context CodeLens: "Related context (n)" that opens filtered panel.
- Evidence block template and paste-from-tests command.
- Quiet ballot form with local storage plus status bar indicator.

## Repo architecture - Phase 1

- `packages/chorus-extension` - VS Code extension (TypeScript, webview UI).
  - `panel/` - ContextTab, EvidenceTab, EquityTab.
  - `services/` - Indexer, Search, Evidence, Ballots, Blinding, Providers, Settings.
  - `codelens/` - RelatedContextLens.
  - `storage/` - Local sqlite or duckdb store.
  - `telemetry/` - privacy-first, opt-in.

## Coding standards and constraints

- Language: TypeScript strict. Node LTS. Keep functions small and testable.
- UI: lightweight webview (Svelte or React), keyboard-first, ARIA roles, avoid color-only signals.
- Privacy: local-first storage, redact PII in exports, deny read of `.env` and secrets by config.
- Telemetry: opt-in only, counts not content.

## Evidence-first review rules

- Generate a **Chorus Evidence** section in PR descriptions with Tests, Benchmarks (or N/A), Spec or ADR links, and Risk notes. Provide local validation and quick-fixes.
- Quiet ballots are stored locally with decision, confidence 1-5, and short rationale. Reveal author metadata only after first-pass submit.

## Test and quality bar

- Maintain unit test coverage ≥ 80 percent for lines, functions, branches, statements. Add integration tests for extension activation and panel routing.
- CI must fail the build if coverage drops. Include a coverage summary in PRs.

## Claude Code operating principles

- Always run a loop: **analyze → plan → implement → test → review → commit**.
- Make small, verifiable commits. Keep messages conventional: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`.
- Prefer local tools. Ask before any network call not whitelisted in `.claude/settings.json`.
- When building nontrivial modules, switch to deep thinking mode: enumerate alternatives, trade-offs, and edge cases before editing code.

## Task priorities for Phase 1

1. Bootstrap extension scaffold with linting, formatting, Vitest, @vscode/test-electron, and GitHub Actions with coverage gates.
2. Panel skeleton with three tabs and router.
3. Context indexer: git log scan and `docs/` markdown scan + simple BM25 ranking to drive CodeLens and Context tab.
4. Evidence block generation and paste-from-tests command.
5. Quiet ballots model and minimal UI with status bar indicator.
6. A11y and copy tone. Telemetry toggle and redaction helpers.

## Acceptance checks to run per change

- Unit tests and extension integration tests pass locally.
- Coverage remains ≥ 80 percent. If not, write or broaden tests before proceeding.
- For Context: at least one relevant prior PR or doc is suggested for a changed symbol using test fixtures. For Evidence: required fields validation triggers correctly. For Equity: blinding masks author metadata until ballot submission.