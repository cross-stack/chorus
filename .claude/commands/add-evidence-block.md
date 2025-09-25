---
description: Create the Chorus Evidence PR template and a helper to paste test output into Evidence.
allowed-tools: Read, Edit
---

Create `.github/PULL_REQUEST_TEMPLATE.md` with a collapsible "Chorus Evidence" block:
- Tests - link to unit or integration output
- Benchmarks - link or N/A if policy allows
- Spec or ADR references
- Risk and rollback notes

Add command handler `chorus.addEvidence` that formats pasted test JSON into markdown and appends to the PR Evidence section. Validate required fields per `.chorus.json` if present.
