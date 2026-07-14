import { createHash } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';

import {
  ARCHIVE_SCHEMA_VERSION,
  type ArchiveManifest,
  type CreateStockyArchiveOptions,
  type JsonRecord,
  type ResourceManifest,
  type ResourceName,
  resources,
  STOCKY_API_ORIGIN,
  STOCKY_API_PATH,
  type StockyArchiveResult,
} from './archive-types.js';
import { normalizedFiles } from './normalized-files.js';
import { createReadinessReport, supplementalChecklist } from './readiness-report.js';
import { fetchResource } from './stocky-api.js';
import { EXPORTER_VERSION } from './version.js';

export type {
  ArchiveManifest,
  CreateStockyArchiveOptions,
  StockyArchiveResult,
} from './archive-types.js';

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertNoCredentialMaterial(textFiles: Record<string, string>, apiKey: string): void {
  const credentialNeedles = new Set([apiKey, JSON.stringify(apiKey).slice(1, -1)]);
  const credentialFound = [...credentialNeedles].some(
    (needle) =>
      needle.length > 0 &&
      Object.values(textFiles).some((content) => content.includes(needle)),
  );
  if (credentialFound) {
    throw new Error(
      'Refusing to create an archive because credential material was detected in its contents',
    );
  }
}

function createArchiveFiles(
  textFiles: Record<string, string>,
  manifestDetails: Omit<ArchiveManifest, 'files'>,
): { archive: Uint8Array; manifest: ArchiveManifest } {
  const payloadFiles = Object.entries(textFiles).map(([path, content]) => {
    const bytes = strToU8(content);
    return { path, bytes, sha256: sha256(bytes) };
  });
  const manifest: ArchiveManifest = {
    ...manifestDetails,
    files: payloadFiles.map(({ path, bytes, sha256: digest }) => ({
      path,
      bytes: bytes.length,
      sha256: digest,
    })),
  };
  const manifestBytes = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  const archiveFiles: Record<string, Uint8Array> = Object.fromEntries(
    payloadFiles.map(({ path, bytes }) => [path, bytes]),
  );
  archiveFiles['manifest.json'] = manifestBytes;
  archiveFiles['checksums.sha256'] = strToU8(
    [
      ...payloadFiles,
      { path: 'manifest.json', bytes: manifestBytes, sha256: sha256(manifestBytes) },
    ]
      .map(({ path, sha256: digest }) => `${digest}  ${path}`)
      .join('\n') + '\n',
  );

  return { archive: zipSync(archiveFiles, { level: 6 }), manifest };
}

export async function createStockyArchive(
  options: CreateStockyArchiveOptions,
): Promise<StockyArchiveResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const exportedAt = (options.now ?? (() => new Date()))().toISOString();
  const data = {} as Record<ResourceName, JsonRecord[]>;
  const manifestResources = {} as Record<ResourceName, ResourceManifest>;
  const failures: ArchiveManifest['failures'] = [];
  const textFiles: Record<string, string> = {};

  for (const name of resources) {
    const fetched = await fetchResource(name, options.shopDomain, options.apiKey, fetchImpl);
    data[name] = fetched.records;
    fetched.rawPages.forEach((raw, index) => {
      textFiles[`raw/${name}/page-${String(index + 1).padStart(4, '0')}.json`] = raw;
    });
    manifestResources[name] = {
      endpoint: `${STOCKY_API_PATH}/${name}.json`,
      status: fetched.failure ? 'incomplete' : 'complete',
      page_count: fetched.rawPages.length,
      record_count: fetched.records.length,
      failures: fetched.failure ? [fetched.failure] : [],
    };
    if (fetched.failure) failures.push({ resource: name, ...fetched.failure });
  }

  Object.assign(textFiles, normalizedFiles(data));
  const readiness = createReadinessReport(data, exportedAt);
  textFiles['reports/migration-readiness.json'] = `${JSON.stringify(readiness, null, 2)}\n`;
  textFiles['reports/migration-readiness.md'] =
    `# Migration readiness (beta)\n\n` +
    `Generated: ${exportedAt}\n\n` +
    `Open PO candidates: ${(readiness.open_purchase_orders as unknown[]).length}\n\n` +
    `Review the JSON report for machine-readable findings and API coverage gaps.\n`;
  textFiles['supplemental-manual-export-checklist.md'] = supplementalChecklist();

  assertNoCredentialMaterial(textFiles, options.apiKey);
  return createArchiveFiles(textFiles, {
    schema_version: ARCHIVE_SCHEMA_VERSION,
    exporter: { name: 'Stocky Rescue', version: EXPORTER_VERSION },
    status: failures.length === 0 ? 'complete' : 'incomplete',
    exported_at: exportedAt,
    shop_domain: options.shopDomain,
    source: { origin: STOCKY_API_ORIGIN, api_version: 'v2' },
    resources: manifestResources,
    failures,
  });
}
