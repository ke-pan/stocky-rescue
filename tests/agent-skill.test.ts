import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const skillRoot = resolve(packageRoot, 'skill/stocky-rescue');
const inspector = resolve(skillRoot, 'scripts/inspect_archive.py');
const resourceNames = [
  'purchase_orders',
  'stock_adjustment_items',
  'stock_adjustments',
  'suppliers',
  'tax_types',
] as const;

function archiveFixture(
  status: 'complete' | 'incomplete',
  extraFiles: Record<string, string> = {},
  omittedResources: readonly string[] = [],
) {
  const resources = Object.fromEntries(
    resourceNames
      .filter((name) => !omittedResources.includes(name))
      .map((name) => [
        name,
        {
          endpoint: `/api/v2/${name}.json`,
          status: name === 'suppliers' ? status : 'complete',
          page_count: 1,
          record_count: name === 'suppliers' ? 7 : 0,
          failures:
            name === 'suppliers' && status === 'incomplete'
              ? [{ page: 2, message: 'merchant secret detail' }]
              : [],
        },
      ]),
  );
  resources['private-resource-name'] = {
    endpoint: '/private',
    status: 'complete',
    page_count: 1,
    record_count: 99,
    failures: [],
  };
  const manifest = {
    schema_version: 'stocky-rescue-archive/v1',
    exporter: { name: 'Stocky Rescue', version: '0.1.0' },
    status,
    exported_at: '2026-07-14T01:02:03.000Z',
    shop_domain: 'merchant-name-must-be-redacted.myshopify.com',
    source: { origin: 'https://stocky.shopifyapps.com', api_version: 'v2' },
    resources,
    failures:
      status === 'incomplete'
        ? [{ resource: 'suppliers', page: 2, message: 'merchant secret detail', http_status: 401 }]
        : [],
    files: [],
    unknown_future_field: { merchant_name: 'must never reach the summary' },
  };
  const readiness = {
    report_version: 'stocky-migration-readiness/v1',
    confidence: 'beta',
    open_purchase_orders: [{ id: 'PO-SECRET', number: 'PRIVATE-1001' }],
    partial_or_ambiguous_receipts: [],
    api_coverage_gaps: ['Average unit cost', 'Private merchant gap detail'],
    unknown_future_field: { supplier_name: 'Private Supplier' },
  };
  const coveredFiles: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'reports/migration-readiness.json': strToU8(JSON.stringify(readiness)),
    ...Object.fromEntries(
      Object.entries(extraFiles).map(([path, value]) => [path, strToU8(value)]),
    ),
  };
  const checksums = Object.entries(coveredFiles)
    .map(([path, content]) => `${createHash('sha256').update(content).digest('hex')}  ${path}`)
    .join('\n');
  return zipSync({ ...coveredFiles, 'checksums.sha256': strToU8(`${checksums}\n`) });
}

function inspectArchive(archive: Uint8Array) {
  const directory = mkdtempSync(join(tmpdir(), 'stocky-rescue-skill-'));
  const archivePath = join(directory, 'fixture.zip');
  writeFileSync(archivePath, archive);
  return spawnSync('python3', [inspector, '--json', archivePath], {
    encoding: 'utf8',
  });
}

describe('portable Stocky Rescue Agent Skill', () => {
  it('ships a complete installable package with pinned trust and safety evals', () => {
    for (const relativePath of [
      'SKILL.md',
      'README.md',
      'LICENSE',
      'VERSION',
      'agents/openai.yaml',
      'evals/cases.json',
      'references/archive-and-release.md',
      'scripts/inspect_archive.py',
    ]) {
      expect(() => readFileSync(resolve(skillRoot, relativePath))).not.toThrow();
    }

    const skill = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toContain('Never ask the user to paste a Stocky API key');
    expect(skill).toContain('August 31, 2026');
    expect(skill).toContain('92b6771fe36510d11f47f7ff239d5e5ae53247ba83f82c9af634a1193addcf1c');
    expect(skill).toContain('Do not download or execute anything without explicit approval');

    const readme = readFileSync(resolve(skillRoot, 'README.md'), 'utf8');
    expect(readme).toContain('.agents/skills/stocky-rescue');
    expect(readme).toContain('.claude/skills/stocky-rescue');
    expect(readme).toContain('Uninstall');

    const evals = JSON.parse(readFileSync(resolve(skillRoot, 'evals/cases.json'), 'utf8')) as {
      cases: Array<{ id: string }>;
    };
    expect(evals.cases.map(({ id }) => id).sort()).toEqual([
      'expired_api_access',
      'incomplete_archive',
      'malicious_archive_paths',
      'missing_credentials',
      'post_shutdown',
      'unknown_fields',
    ]);
  });

  it('verifies complete archives and emits only a redacted structural summary', () => {
    const result = inspectArchive(archiveFixture('complete'));

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      archive_schema: 'stocky-rescue-archive/v1',
      archive_status: 'complete',
      checksum_status: 'verified',
      exporter_version: '0.1.0',
    });
    expect(result.stdout).not.toContain('merchant-name-must-be-redacted');
    expect(result.stdout).not.toContain('PO-SECRET');
    expect(result.stdout).not.toContain('PRIVATE-1001');
    expect(result.stdout).not.toContain('Private Supplier');
    expect(result.stdout).not.toContain('private-resource-name');
    expect(result.stdout).not.toContain('Private merchant gap detail');
  });

  it('keeps valid partial archives visible as INCOMPLETE without exposing failure messages', () => {
    const result = inspectArchive(archiveFixture('incomplete'));

    expect(result.status).toBe(2);
    const summary = JSON.parse(result.stdout);
    expect(summary.archive_status).toBe('incomplete');
    expect(summary.incomplete_endpoints).toEqual(['suppliers']);
    expect(summary.failure_statuses).toEqual([401]);
    expect(result.stdout).not.toContain('merchant secret detail');
  });

  it('rejects a complete manifest that omits required endpoint metadata', () => {
    const result = inspectArchive(archiveFixture('complete', {}, ['tax_types']));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required endpoint metadata');
    expect(result.stderr).toContain('tax_types');
  });

  it('rejects malicious archive paths without extracting them', () => {
    const result = inspectArchive(archiveFixture('complete', { '../outside.txt': 'unsafe' }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsafe archive path');
  });
});
