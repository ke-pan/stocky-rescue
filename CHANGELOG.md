# Changelog

## 0.2.0 - 2026-07-14

### Features

- Inspect Stocky Rescue archives through the same bundled Node.js CLI that creates them.
- Verify ZIP paths, member limits, checksums, archive metadata, and readiness summaries locally.
- Emit a redacted structural summary without exposing merchant records or extracting the archive.

### Agent Skill

- Make the product repository and release artifact the installable Skill package.
- Keep `SKILL.md` focused on workflow orchestration and remove the separate Python inspector.
- Add a source setup command while keeping verified release installs dependency-free at runtime.

## 0.1.0 - 2026-07-14

### Features

- Export all five documented Stocky API v2 resources with endpoint-specific pagination.
- Preserve untouched response pages alongside normalized CSV files and a versioned manifest.
- Generate checksums, partial-failure records, and a beta migration-readiness report.
- Accept the Stocky API key only through a hidden local prompt and reject redirects.

### Documentation

- Document the threat model, known API gaps, manual export checklist, and release verification.
