---
description: When coverage is below threshold, generate and run tests until it is ≥ 80 percent. Produce a brief gap report and commit only tests unless fixes are required.
allowed-tools: Read, Edit, Grep, Glob, Bash(npm run test:coverage), Bash(git add:*), Bash(git commit:*), Bash(git status)
---

Process:
1) Run tests with coverage and capture summary.
2) Identify hot spots using uncovered files and lines.
3) Add unit tests first. Favor table-driven tests and edge cases.
4) For extension activation and panel routing, add integration tests with @vscode/test-electron.
5) Re-run coverage. If still short, broaden tests. Only change production code if you identify a real bug. Leave a short note in the commit body.
