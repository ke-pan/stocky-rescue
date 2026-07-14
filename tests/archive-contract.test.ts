import { createHash } from 'node:crypto';

import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createStockyArchive } from '../src/index.js';
import { resourceFromRequest } from './helpers.js';

const responses: Record<string, unknown> = {
  purchase_orders: {
    purchase_orders: [
      {
        id: 2,
        number: '1000A',
        sequential_id: 1000,
        archived: false,
        currency: 'CAD',
        supplier_name: 'Acme',
        supplier_id: '1',
        purchase_items: [
          {
            id: 4,
            inventory_item_id: 37791323160598,
            sku: 'MUG-WHT',
            quantity: 10,
            status: 'not delivered',
            received_at: null,
          },
        ],
      },
    ],
  },
  suppliers: {
    suppliers: [
      {
        id: 1,
        name: 'Acme',
        contact_email: 'orders@example.com',
        is_hidden: false,
      },
    ],
  },
  stock_adjustments: {
    stock_adjustments: [
      {
        id: 1,
        sequential_id: 1000,
        archived: false,
        adjusted_at: '2026-07-01T01:02:03.000Z',
        location: { id: 1, shopify_id: 34915680278 },
        stock_adjustment_reason: { id: 1, reason: 'Damaged Products' },
      },
    ],
  },
  stock_adjustment_items: {
    stock_adjustment_items: [
      {
        id: 1,
        quantity: -1,
        status: 'adjusted',
        stock_adjustment_id: 1,
        variant: {
          id: 278,
          shopify_id: 35671873093654,
          title: 'White',
          sku: 'MUG-WHT',
          barcode: '01000009',
        },
      },
    ],
  },
  tax_types: {
    tax_types: [
      {
        id: 1,
        name: 'Goods and services tax',
        code: 'GST',
        tax_rate: '10.0',
        purpose: 'purchase',
      },
    ],
  },
};

describe('archive v1 contract', () => {
  it('preserves every documented resource in a portable, checksummed archive', async () => {
    const apiKey = 'fixture-secret-that-must-not-leak';
    const requests: Array<{ method: string; url: URL; authorization: string | null }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const resource = resourceFromRequest(input);
      const headers = new Headers(init?.headers);
      requests.push({
        method: init?.method ?? 'GET',
        url,
        authorization: headers.get('authorization'),
      });
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);

      return new Response(JSON.stringify(responses[resource]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await createStockyArchive({
      shopDomain: 'example.myshopify.com',
      apiKey,
      fetch: fetchMock,
      now: () => new Date('2026-07-14T01:02:03.000Z'),
    });

    expect(result.manifest.status).toBe('complete');
    expect(result.manifest.schema_version).toBe('stocky-rescue-archive/v1');
    expect(result.manifest.resources).toMatchObject({
      purchase_orders: { page_count: 1, record_count: 1, status: 'complete' },
      suppliers: { page_count: 1, record_count: 1, status: 'complete' },
      stock_adjustments: { page_count: 1, record_count: 1, status: 'complete' },
      stock_adjustment_items: { page_count: 1, record_count: 1, status: 'complete' },
      tax_types: { page_count: 1, record_count: 1, status: 'complete' },
    });

    const files = unzipSync(result.archive);
    const paths = Object.keys(files).sort();
    expect(paths).toEqual(
      expect.arrayContaining([
        'checksums.sha256',
        'manifest.json',
        'normalized/purchase_order_items.csv',
        'normalized/purchase_orders.csv',
        'normalized/stock_adjustment_items.csv',
        'normalized/stock_adjustments.csv',
        'normalized/suppliers.csv',
        'normalized/tax_types.csv',
        'raw/purchase_orders/page-0001.json',
        'raw/stock_adjustment_items/page-0001.json',
        'raw/stock_adjustments/page-0001.json',
        'raw/suppliers/page-0001.json',
        'raw/tax_types/page-0001.json',
        'reports/migration-readiness.json',
        'reports/migration-readiness.md',
        'supplemental-manual-export-checklist.md',
      ]),
    );

    const checksums = strFromU8(files['checksums.sha256']).trim().split('\n');
    for (const line of checksums) {
      const [expected, path] = line.split('  ');
      expect(createHash('sha256').update(files[path]).digest('hex')).toBe(expected);
    }
    expect(checksums.some((line) => line.endsWith('  manifest.json'))).toBe(true);

    for (const content of Object.values(files)) {
      expect(strFromU8(content)).not.toContain(apiKey);
    }
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.method).toBe('GET');
      expect(request.url.origin).toBe('https://stocky.shopifyapps.com');
      expect(request.url.pathname).toMatch(/^\/api\/v2\/[a-z_]+\.json$/);
      expect(request.url.toString()).not.toContain(apiKey);
      expect(request.authorization).toBe(`API KEY=${apiKey}`);
    }
  });
});
