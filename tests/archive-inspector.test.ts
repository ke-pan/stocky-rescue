import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { inspectStockyArchive, readStockyArchive } from '../src/archive-inspector.js';
import { archiveFixture } from './archive-fixture.js';

describe('Stocky Rescue archive inspector', () => {
  it('verifies complete archives and emits only a redacted structural summary', () => {
    const summary = inspectStockyArchive(archiveFixture('complete'));

    expect(summary).toMatchObject({
      archive_schema: 'stocky-rescue-archive/v1',
      archive_status: 'complete',
      checksum_status: 'verified',
      exporter_version: '0.1.0',
    });
    const output = JSON.stringify(summary);
    expect(output).not.toContain('merchant-name-must-be-redacted');
    expect(output).not.toContain('PO-SECRET');
    expect(output).not.toContain('PRIVATE-1001');
    expect(output).not.toContain('Private Supplier');
    expect(output).not.toContain('private-resource-name');
    expect(output).not.toContain('Private merchant gap detail');
  });

  it('keeps valid partial archives visible without exposing failure messages', () => {
    const summary = inspectStockyArchive(archiveFixture('incomplete'));

    expect(summary.archive_status).toBe('incomplete');
    expect(summary.incomplete_endpoints).toEqual(['suppliers']);
    expect(summary.failure_statuses).toEqual([401]);
    expect(JSON.stringify(summary)).not.toContain('merchant secret detail');
  });

  it('rejects a complete manifest that omits required endpoint metadata', () => {
    expect(() => inspectStockyArchive(archiveFixture('complete', {}, ['tax_types']))).toThrow(
      /missing required endpoint metadata: tax_types/,
    );
  });

  it('rejects malicious archive paths without extracting them', () => {
    expect(() =>
      inspectStockyArchive(archiveFixture('complete', { '../outside.txt': 'unsafe' })),
    ).toThrow(/unsafe archive path/);
  });

  it('rejects archive content that no longer matches its checksum', () => {
    const files = unzipSync(archiveFixture('complete'));
    files['manifest.json'] = strToU8('{}');

    expect(() => inspectStockyArchive(zipSync(files))).toThrow(/checksum mismatch: manifest\.json/);
  });

  it('lets Worker callers enforce a lower expanded-size limit before unzipping', () => {
    expect(() =>
      readStockyArchive(archiveFixture('complete'), { maxExpandedBytes: 1 }),
    ).toThrow(/expanded-size safety limit/);
  });
});
