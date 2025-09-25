---
description: Bootstrap the Chorus Positron extension from an empty repo. Produce scaffold, tests, CI, and first value slice of Context, Evidence, Equity.
allowed-tools: Read, Edit, Grep, Glob, Bash(npm ci), Bash(npm run *), Bash(git status), Bash(git add:*), Bash(git commit:*), Bash(node --version)
---

## Tasks
1) Initialize project
   - Create .gitignore for Node and VS Code extension artifacts.
   - Create package.json with scripts: build, lint, format, test, test:coverage, vsce:package.
   - Add tsconfig strict. Add ESLint with TypeScript plugin. Add Prettier.
   - Add vitest with coverage thresholds at 80 percent for lines, functions, branches, statements.

2) Extension scaffold
   - `packages/chorus-extension` with `package.json` manifest for VS Code, activation, and commands:
     - `chorus.openPanel`, `chorus.addEvidence`, `chorus.submitFirstPass`.
   - Webview UI skeleton: Context, Evidence, Equity tabs with router and keyboard navigation.
   - Status bar item: “Chorus: First-pass active”.

3) Services and storage
   - `services/Indexer.ts`: scan git log and docs folder for markdown files. Produce ContextItem records with BM25 score.
   - `services/Search.ts`: simple BM25 keyword search.
   - `services/Evidence.ts`: PR evidence template string and validation rules.
   - `services/Ballots.ts`: local storage of QuietBallot with confidence 1-5.
   - `storage/LocalDB.ts`: sqlite or duckdb schema for context_items, evidence_items, quiet_ballots.

4) CodeLens and decorators
   - CodeLens over changed files showing “Related context (n)”.
   - Inline decorators for evidence presence.

5) Tests and coverage
   - Unit tests for services with fixtures.
   - Extension integration tests with @vscode/test-electron that open the panel and switch tabs.
   - Ensure `vitest` coverage thresholds are enforced.

6) CI
   - GitHub Actions workflow that runs install, build, lint, unit tests, integration tests, and fails if coverage < 80 percent. Publish coverage summary in PR.

## Acceptance criteria
- `npm run test:coverage` reports ≥ 80 percent across metrics.
- Panel opens and tabs switch via keyboard.
- Context suggests at least one relevant prior item for a changed symbol in fixtures.
- Evidence block string renders correct sections and validation triggers.
- Quiet ballot submit toggles reveal state in the UI.

## Notes
- Keep commits small. Use conventional messages. Respect `.claude/settings.json`.
