# Stocky Rescue

Stocky Rescue creates a portable local archive of everything the official Stocky API exposes.
It does not require a ShelfTally account or app installation, and it never writes Shopify
inventory.

## Start with the no-key guide

If you are not ready to use a Stocky API key, begin with the
[Stocky Data Rescue guide](https://shelftally.com/blog/stocky-data-rescue-guide/). It explains
the verified manual exports, known coverage gaps, and local backup checklist before you decide
whether this exporter is appropriate for your store.

Stocky and all Stocky APIs stop working on August 31, 2026. Shopify currently promises at least
90 days of read-only UI access after that date, but the APIs stop on August 31. Export early and
keep the original archive unchanged.

Sources: [Shopify's Stocky migration guidance][shopify-migration] and the
[official Stocky API v2 index][stocky-api].

> **Beta:** The archive contract and adversarial fixtures are tested, but the exporter still
> needs validation by consenting merchants on representative Stocky stores. It does not claim a
> complete migration.

## Safety properties

- Your shop domain and key are entered locally.
- The key is accepted only through a hidden terminal prompt. There is no `--api-key` option.
- The key is sent only in the `Authorization` header of fixed HTTPS `GET` requests to
  `https://stocky.shopifyapps.com/api/v2/`.
- The key never enters a URL, file, archive, log, telemetry event, or crash report. The exporter
  refuses to create an archive if an upstream payload unexpectedly echoes credential material.
- There is no telemetry, upload, Shopify Admin API client, or write request in the program.
- A partial API failure still produces an archive, but marks it **INCOMPLETE** in the CLI,
  `manifest.json`, and per-resource failure records.

Read the full [threat model](./THREAT_MODEL.md) before using the exporter with production data.
Never paste a Stocky key into AI chat, email, a support ticket, or a shell command.

## Agent Skill and local CLI

This repository is both the product and the portable [Stocky Rescue Agent Skill](./SKILL.md) for
Codex and Claude Code. The bundled Node.js CLI owns export, archive verification, and redacted
summary behavior. `SKILL.md` only routes and orchestrates those product commands, so there is no
second inspector implementation to drift.

The canonical distribution is the standalone
[ke-pan/stocky-rescue](https://github.com/ke-pan/stocky-rescue) repository. Its source is maintained
under `tools/stocky-rescue` in the Stokka monorepo and published to the standalone repository, where
the root release and test workflows run.

A verified release ZIP already contains `SKILL.md` and `dist/stocky-rescue.mjs`; extract the whole
ZIP into the chosen Skill directory. To install from reviewed source instead, clone the tagged
repository into the Skill directory and run `setup`, which installs the declared dependencies and
builds the same bundled CLI:

```bash
# Codex user scope
mkdir -p ~/.agents/skills
git clone --branch v0.2.0 --depth 1 https://github.com/ke-pan/stocky-rescue.git \
  ~/.agents/skills/stocky-rescue
~/.agents/skills/stocky-rescue/setup

# Claude Code user scope
mkdir -p ~/.claude/skills
git clone --branch v0.2.0 --depth 1 https://github.com/ke-pan/stocky-rescue.git \
  ~/.claude/skills/stocky-rescue
~/.claude/skills/stocky-rescue/setup
```

For project scope, use `.agents/skills/stocky-rescue` or `.claude/skills/stocky-rescue` as the clone
target. Review `SKILL.md`, `THREAT_MODEL.md`, and `setup` before installing.

### Uninstall

Delete only the installed `stocky-rescue` directory. Removing the Skill does not delete merchant
archives stored elsewhere.

## Download and verify a release

Download both the versioned ZIP and its `.sha256` file from the pinned GitHub Release. Install
Node.js 24 LTS (or another supported version 22 or newer) from
[nodejs.org](https://nodejs.org/), then verify the download before extracting it.

### macOS

```bash
shasum -a 256 -c stocky-rescue-v0.2.0.zip.sha256
mkdir stocky-rescue-v0.2.0
unzip stocky-rescue-v0.2.0.zip -d stocky-rescue-v0.2.0
cd stocky-rescue-v0.2.0
node dist/stocky-rescue.mjs export
```

### Windows PowerShell

```powershell
$expected = (Get-Content .\stocky-rescue-v0.2.0.zip.sha256).Split(' ')[0]
$actual = (Get-FileHash .\stocky-rescue-v0.2.0.zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw 'Checksum mismatch. Do not run this file.' }
Expand-Archive .\stocky-rescue-v0.2.0.zip -DestinationPath .\stocky-rescue-v0.2.0
Set-Location .\stocky-rescue-v0.2.0
node .\dist\stocky-rescue.mjs export
```

The exporter asks for:

1. the store domain, such as `example.myshopify.com`; and
2. the Stocky API key in a hidden prompt.

The API key is a Stocky-issued credential, not your Shopify password. Shopify's
[previous migration instructions][quickbooks-migration] show
**Apps → Stocky → account icon → Preferences → API access → Current key**. Confirm the screen
on your own store because the path can change. If you cannot access a key, use the manual UI
export checklist instead; never send a password or key to support.

The default output is a timestamped ZIP in the current folder. A complete run exits with code
`0`. An incomplete but usable archive exits with code `2`. A validation or local write failure
exits with code `1`. Existing output files are not overwritten.

Node.js 20 is end-of-life and should not be used for a tool that handles production credentials.

Inspect an existing Stocky Rescue ZIP with the same local program. It validates the ZIP structure,
checksums, required endpoint metadata, and readiness report without extracting files or printing raw
records:

```bash
node dist/stocky-rescue.mjs inspect '/absolute/path/to/stocky-rescue.zip' --json
```

Inspection returns `0` for a verified complete archive, `2` for a verified `INCOMPLETE` archive,
and `1` for an unsafe, invalid, or unreadable archive.

## Archive v1

Each ZIP contains:

- untouched response JSON for every successful endpoint page;
- normalized CSV for suppliers, purchase orders and items, stock adjustments and items, and tax
  types;
- `manifest.json` with schema version, export time, store, endpoint status, page and record
  counts, files, and every partial failure;
- `checksums.sha256` covering every other archive file, including `manifest.json`;
- JSON and Markdown migration-readiness reports; and
- a supplemental checklist for Stocktake CSV, SKU/Variant Average Cost CSV/PDF, PO CSV/PDF, and
  unsupported Stocky settings.

`checksums.sha256` cannot include its own checksum. Every other file is covered.

The readiness report flags open PO candidates, custom PO numbers, partial or ambiguous receipt
states, currencies, locale-formatted dates, missing and duplicate SKU/barcode candidates, hidden
suppliers, and known API gaps. These are review cues, not automatic migration decisions.

## Known gaps

The official API exposes suppliers, purchase orders, stock adjustments, stock adjustment items,
and tax types. It does not expose Stocktake count sheets, Average Unit Cost, forecast settings,
transfers, saved reports, custom fields, users, or every supplier-product mapping and setting.
Use the included manual checklist before Stocky shuts down.

## Build from source

macOS and Linux can run `./setup`. The equivalent explicit commands are:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
node dist/stocky-rescue.mjs --help
```

On Windows PowerShell, install Node.js 22 or newer and pnpm, then run the same `pnpm install`,
`pnpm test`, `pnpm check`, and `pnpm build` commands. A release ZIP needs no dependency install.

Create the release ZIP and checksum with `pnpm release:artifact`. The source and release are
licensed under the MIT License. Check current runtime support on the
[official Node.js releases page](https://nodejs.org/en/about/previous-releases).

## Test fixtures

The test suite documents the archive contract with representative, synthetic API responses.
Fixtures cover both pagination directions, empty record IDs, string PO numbers, unknown fields,
missing identifiers, credential echo, and a network interruption after a successful page. No
fixture contains merchant data or a production credential.

[shopify-migration]: https://help.shopify.com/en/manual/products/inventory/transitioning-from-stocky
[stocky-api]: https://stocky.shopifyapps.com/api/docs/v2.html
[quickbooks-migration]: https://help.shopify.com/en/manual/sell-in-person/quickbooks/migration
