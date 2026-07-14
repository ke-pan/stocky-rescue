import { createHash } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';

const resourceNames = [
  'purchase_orders',
  'stock_adjustment_items',
  'stock_adjustments',
  'suppliers',
  'tax_types',
] as const;

export function archiveFixture(
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
