# Threat model

## Scope and assets

Stocky Rescue is a local, read-only exporter. The protected assets are:

- the Stocky API key;
- supplier, purchasing, cost, tax, adjustment, and product identifier data returned by Stocky;
- the integrity and completeness status of the generated archive; and
- the merchant's current Shopify inventory, which this tool must never modify.

The shop domain is stored in the archive for provenance. It is not treated as a secret, but it
can still identify a merchant.

## Trust boundaries

1. The merchant downloads source or a release artifact onto a device they control.
2. The merchant enters the shop domain and key in the local terminal.
3. The process sends HTTPS `GET` requests only to the fixed origin
   `https://stocky.shopifyapps.com` and fixed `/api/v2/*.json` resource paths.
4. Stocky responses cross into the local process and then into a ZIP on the merchant's disk.
5. The merchant decides whether and how to store or share the ZIP.

There is no ShelfTally server, analytics service, crash reporter, updater, Shopify Admin API, or
automatic upload boundary.

## Threats and controls

### Credential disclosure

Threats include shell history, process arguments, terminal echo, URLs, files, logs, telemetry,
upstream error text, and an unexpected API response that echoes a credential.

Controls:

- no command-line or environment option accepts the key;
- a TTY-only raw input prompt displays no characters;
- the key is used only to construct the Stocky `Authorization` header in memory;
- requests use a fixed HTTPS origin and path allowlist; the key never enters the URL;
- no debug/request logging, telemetry, or crash reporting exists;
- caught errors redact an exact key before display or manifest storage; and
- every candidate archive file is scanned for the exact and JSON-escaped key before the ZIP is
  created. A match aborts archive creation.

JavaScript strings cannot be reliably zeroed in memory. A compromised local process, device,
Node runtime, or operating system can still read process memory or keystrokes. Run the exporter
only on a trusted, patched device.

### Exfiltration to an unexpected host

The source defines one origin: `https://stocky.shopifyapps.com`. Resource paths are fixed in
code, and all calls use `GET`. The store domain is a request header, not a user-controlled host.
Redirects are rejected, so the authorization header cannot be forwarded to a redirect target.
Each request also has a 60-second timeout. A redirect or timeout produces an incomplete archive
with a failure entry instead of retrying against another host.

### Deceptively successful partial export

Network interruption, authentication failure, rate limiting, invalid JSON, or a changed response
shape can leave gaps. Every successful raw page is retained. Every failure records resource,
page, HTTP status when available, and a redacted message. Any failure sets both the resource and
archive to `incomplete`; the CLI prints `INCOMPLETE` and exits with code `2` after writing the
recoverable archive.

The exporter cannot prove that Stocky's API returned all historical records. Pagination uses the
official documented `since_id` direction per endpoint and detects repeated cursors and invalid
IDs on full pages.

### Lossy normalization or malicious spreadsheet cells

Unknown fields are retained in raw response JSON even when normalized CSV does not include them.
CSV cells that begin with spreadsheet formula characters are prefixed with an apostrophe. Use raw
JSON as the lossless source and CSV as a review convenience.

### Archive tampering or artifact substitution

`checksums.sha256` covers every archive file except itself. The GitHub Release publishes a
separate SHA-256 file for the downloadable ZIP. Users should verify the outer checksum before
running the bundle and preserve the original archive after export.

Checksums detect accidental or malicious changes after generation; they are not signatures and
do not establish the identity of the publisher. GitHub account or release-workflow compromise is
a residual supply-chain risk.

### Accidental Shopify mutation

The program contains no Shopify Admin API client or inventory write operation. Its only network
resources are the five documented Stocky list endpoints, called with `GET`. Future import or
mutation code does not belong in this repository without a new threat model and an explicit
review-before-write interface.

## Sensitive archive handling

The ZIP can contain supplier contact details, purchase costs, tax settings, product identifiers,
and operational history. Store it as sensitive business data. Prefer encrypted backups, limit
access, and agree on retention/deletion before sharing it with an accountant, agency, migration
provider, or ShelfTally. Never email the API key with the archive.

## Out of scope and residual gaps

- A compromised merchant device, terminal, Node runtime, DNS resolver, certificate authority, or
  GitHub account.
- Complete recovery of Stocky data that the official API does not expose.
- Correct interpretation of undocumented or locale-specific fields without a real-store sample.
- Automatic migration into ShelfTally or Shopify.
- Long-term archival policy, encryption key management, and legal retention requirements.
