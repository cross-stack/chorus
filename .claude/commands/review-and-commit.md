---
description: Lint, format, test, summarize diffs, then produce a conventional commit.
allowed-tools: Read, Edit, Bash(npm run lint), Bash(npm run format), Bash(npm run test:coverage), Bash(git add:*), Bash(git commit:*), Bash(git status), Bash(git diff:*)
---

Steps:
- Run lint and format. Fix violations in place.
- Run tests with coverage. Ensure ≥ 80 percent. If not, run /ensure-coverage.
- Summarize changes by file. Include rationale for risky edits.
- Create commit message with a single type and concise scope. Example: `feat(context): add BM25 search with path and recency features`.
