---
name: stocky-rescue
description: Safely route Stocky merchants and partners through a no-key UI checklist, the local Stocky Rescue exporter, local archive verification, or post-shutdown forensic recovery. Use when someone needs to preserve, inspect, or assess Stocky data without sharing an API key or raw merchant archive in chat.
---

# Stocky Rescue

Use the Stocky Rescue product for local data handling. Keep this Skill focused on choosing and
orchestrating the safe workflow.

Resolve the directory containing this `SKILL.md` as `<stocky-rescue-root>`. The bundled product CLI
is `<stocky-rescue-root>/dist/stocky-rescue.mjs`.

## Hold the trust boundary

- Never ask the user to paste a Stocky API key, password, raw archive, raw export, or merchant
  record into chat, email, a form, an issue, or a prompt.
- Never accept a credential on the user's behalf. The merchant enters a key only into the CLI's
  hidden prompt in their own interactive terminal.
- If a key was already pasted, do not repeat or use it. Tell the user to rotate or revoke it
  immediately, then continue with a replacement key only through the hidden local prompt.
- Keep raw archives local. Accept a local path, run the bundled inspector, and use only its redacted
  summary. Do not extract or parse the ZIP through ad hoc agent code.
- Never present an export as a complete migration or claim an importer exists.
- Do not download dependencies, build source, or run the exporter without explicit approval.

## Route the rescue

Ask only for non-sensitive facts that are not already known:

1. Does Stocky still open in Shopify Admin?
2. Is there already a local Stocky Rescue ZIP or a set of manual CSV/PDF exports? Do not ask the
   user to attach them.
3. Does the user prefer the no-key checklist, the local tool, or merchant-controlled help?

Choose one route:

- **No key or lowest-trust preference:** use the canonical no-key Guide and save still-visible UI
  exports. Offer this first.
- **Before August 31, 2026, with working API access:** explain the local exporter's boundary, then
  offer to run it.
- **Existing Stocky Rescue ZIP:** run the bundled local inspector and report its redacted summary.
- **Expired access, no usable key, or after August 31, 2026:** stop suggesting live API recovery and
  use the forensic route.

Canonical Guide: <https://shelftally.com/blog/stocky-data-rescue-guide/>

Forensic route: <https://shelftally.com/stocky-rescue/forensic-recovery/>

Pinned exporter release and repository:
<https://github.com/ke-pan/stocky-rescue/releases/tag/v0.2.0>

Printable cheat sheets (no-key checklist, coverage matrix, exporter safety card, archive
verification card, action plan): <https://shelftally.com/stocky-rescue/resources/>

## Prepare the bundled CLI

Check the installed product without invoking a network request:

```bash
node '<stocky-rescue-root>/dist/stocky-rescue.mjs' --version
```

If the file is missing in a source checkout, read the build instructions in `README.md`. Explain the
dependency install and build before asking for approval. On macOS or Linux, use
`<stocky-rescue-root>/setup`; on Windows, use the documented PowerShell commands. A verified release
installation already contains `dist/stocky-rescue.mjs` and does not need setup.

Read `README.md` and `THREAT_MODEL.md` when the user needs the exact source, network, archive, or
release boundary. Do not maintain a second copy of those product facts in the Skill.

## Export locally

After approval, tell the merchant to run the product's export command in their own visible,
interactive terminal. Do not start the credential prompt inside an agent-managed subprocess:

```bash
node '<stocky-rescue-root>/dist/stocky-rescue.mjs' export
```

The merchant must type the shop domain and key locally. Never put the key in an argument,
environment variable, command, filename, log, or message. Preserve the original ZIP unchanged.

## Inspect locally

Run the product's inspector against an absolute local path. Prefer an argument-array runner. If a
shell is unavoidable, shell-quote every path as one argument and never concatenate user-controlled
text into the command:

```bash
node '<stocky-rescue-root>/dist/stocky-rescue.mjs' inspect \
  '/absolute/path/to/stocky-rescue.zip' --json
```

Write a new redacted report when requested:

```bash
node '<stocky-rescue-root>/dist/stocky-rescue.mjs' inspect \
  '/absolute/path/to/stocky-rescue.zip' \
  --json --output '/absolute/path/to/stocky-rescue-summary.json'
```

Interpret exit codes exactly:

- `0`: follow the complete-archive route.
- `2`: preserve the partial archive, report `INCOMPLETE`, and fill documented gaps manually.
- `1`: stop; do not extract the archive or bypass the validation failure.

Do not downgrade exit code `2` to complete. On exit code `1`, do not extract the archive or bypass
the validation failure.

## Produce the readiness answer

Report only fields emitted by the inspector and the next safe route. Never add raw values from the
ZIP, infer facts from filenames, or expose unknown manifest fields.
