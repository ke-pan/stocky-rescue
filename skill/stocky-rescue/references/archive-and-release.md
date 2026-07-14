# Archive and release reference

Read this file before proposing the exporter or interpreting an archive.

## Pinned exporter

- Release: `v0.1.0`
- Release page: <https://github.com/ke-pan/stocky-rescue/releases/tag/v0.1.0>
- ZIP: <https://github.com/ke-pan/stocky-rescue/releases/download/v0.1.0/stocky-rescue-v0.1.0.zip>
- Checksum file: <https://github.com/ke-pan/stocky-rescue/releases/download/v0.1.0/stocky-rescue-v0.1.0.zip.sha256>
- ZIP SHA-256: `92b6771fe36510d11f47f7ff239d5e5ae53247ba83f82c9af634a1193addcf1c`

Never rely only on the checksum filename or GitHub page text. Verify the downloaded ZIP bytes.

### macOS

```bash
shasum -a 256 -c stocky-rescue-v0.1.0.zip.sha256
```

### Windows PowerShell

```powershell
$expected = (Get-Content .\stocky-rescue-v0.1.0.zip.sha256).Split(' ')[0]
$actual = (Get-FileHash .\stocky-rescue-v0.1.0.zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw 'Checksum mismatch. Do not run this file.' }
```

After verification, the merchant extracts the ZIP and runs `node stocky-rescue.mjs` in an
interactive terminal. The agent must pause while the merchant enters the Stocky key in the hidden
prompt; the credential must not enter chat or an agent-controlled command.

## Archive v1 contract

Required trust files:

- `manifest.json` — schema, exporter, archive status, endpoint status/counts, and failures;
- `checksums.sha256` — SHA-256 for every other archive member;
- `reports/migration-readiness.json` — beta review cues and documented API gaps.

The inspector rejects missing coverage, hash mismatches, duplicate paths, absolute paths,
backslashes, `..` traversal, symlinks, too many members, and excessive expanded size. It reads
members in memory and never extracts them.

`INCOMPLETE` is a valid, portable partial archive, not a complete export. Preserve it and pair it
with the no-key UI checklist. Exit code `1` means the archive cannot be trusted until the specific
validation failure is resolved.

## Official facts last checked July 14, 2026

- Stocky and every Stocky API are scheduled to stop working on August 31, 2026.
- Shopify currently says Stocky data stays read-only and exportable for at least 90 days after the
  shutdown; that does not extend API access.
- Stocky does not preserve complete historical inventory data. Export only records actually visible
  and downloadable; do not promise full stocktake history.

Primary sources:

- <https://help.shopify.com/en/manual/products/inventory/transitioning-from-stocky>
- <https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/stocky/inventory-management/stocktakes>
- <https://stocky.shopifyapps.com/api/docs/v2.html>
