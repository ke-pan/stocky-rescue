---
name: stocky-rescue
description: Safely route Stocky merchants and partners through a no-key UI checklist, the pinned local Stocky Rescue exporter, local archive verification, or post-shutdown forensic recovery. Use when someone needs to preserve, inspect, or assess Stocky data without sharing an API key or raw merchant archive in chat.
---

# Stocky Rescue

Preserve the strongest available Stocky evidence while keeping credentials and raw business data
under merchant control. Never present an export as a complete migration or claim an importer exists.

## Hold the trust boundary

- Never ask the user to paste a Stocky API key, password, raw archive, raw export, or merchant record
  into chat, a form, email, an issue, or a prompt.
- Do not type, accept, display, log, store, transform, or transmit a credential on the user's behalf.
  The merchant enters a key only into the exporter's hidden prompt in their own interactive terminal.
- Do not download or execute anything without explicit approval. Explain the source, version,
  checksum, network requests, output, and limitations before asking.
- Keep inspection local. Use `scripts/inspect_archive.py`; it reads a ZIP without extracting it and
  emits a structural summary that omits shop domains, record values, IDs, names, and failure text.
- Never send archive contents, source record counts, credentials, or filenames to analytics.

## Route the rescue

Ask only these non-sensitive questions when the answer is not already known:

1. Does Stocky still open in Shopify Admin?
2. Do you already have a Stocky Rescue ZIP or manual CSV/PDF exports? Do not ask for the files.
3. Do you prefer a no-key checklist, a local tool you can inspect, or merchant-controlled help?

Then choose one route:

- **No key or lowest-trust preference:** open the canonical no-key Guide and save still-visible UI
  exports. This route is always available and should be offered first.
- **Before August 31, 2026, with working API access:** offer the pinned local exporter only after
  explaining the trust boundary. Read `references/archive-and-release.md` before giving commands.
- **Existing Stocky Rescue ZIP:** inspect it locally, verify every listed checksum, surface
  `INCOMPLETE` endpoints, and produce the redacted readiness summary.
- **Expired access, no usable key, or after August 31, 2026:** stop suggesting live API recovery.
  Route to the forensic guide and build a provenance-first evidence pack from remaining sources.

Canonical Guide: <https://shelftally.com/blog/stocky-data-rescue-guide/>

Forensic route: <https://shelftally.com/stocky-rescue/forensic-recovery/>

## Explain the local exporter before running it

State all of the following:

- The key authorizes fixed HTTPS `GET` requests to the official Stocky API v2 endpoints for
  `suppliers`, `purchase_orders`, `stock_adjustments`, `stock_adjustment_items`, and `tax_types`.
- The exporter cannot write Shopify inventory, read Shopify customers or orders, or retrieve
  Stocktake count sheets, Average Cost, forecasts, transfers, saved reports, or every Stocky setting.
- The key stays out of arguments, URLs, files, logs, telemetry, crash reports, and the output archive.
- A successful run may still be `INCOMPLETE`; the manifest is the source of truth.
- The archive is portable evidence. It is not proof that ShelfTally or another tool can import it.

Use only exporter release `v0.1.0` for this Skill version. Its published ZIP SHA-256 is:

`92b6771fe36510d11f47f7ff239d5e5ae53247ba83f82c9af634a1193addcf1c`

Never substitute `main`, a newer release, a shortened checksum, or a third-party mirror without a
fresh, explicit trust decision from the user.

## Inspect an existing archive

Run locally from this Skill directory:

```bash
python3 scripts/inspect_archive.py --json /absolute/path/to/stocky-rescue.zip
```

To write a portable redacted report without shell redirection:

```bash
python3 scripts/inspect_archive.py --json --output stocky-rescue-summary.json /absolute/path/to/stocky-rescue.zip
```

Interpret exit codes exactly:

- `0` — checksums verified and every manifest endpoint is complete.
- `2` — checksums verified, but the archive or at least one endpoint is `INCOMPLETE`.
- `1` — unsafe path, checksum/contract failure, unreadable ZIP, or another invalid archive condition.

Do not downgrade `2` to success. Preserve the original ZIP unchanged, report the named incomplete
endpoints, and recommend the manual checklist for API gaps. Unknown JSON fields are ignored by the
summary but remain protected by checksum verification in the original archive.

## Produce the readiness answer

Report only:

- checksum and archive status;
- exporter and archive schema versions;
- endpoint status and local record counts when the merchant wants them;
- counts of readiness warnings, never the underlying IDs, names, PO numbers, SKUs, or barcodes;
- documented API coverage gaps; and
- the next safe route.

Do not ask the merchant to paste the generated report into a public channel if they consider local
record counts sensitive. Do not infer missing facts from filenames or unknown fields.
