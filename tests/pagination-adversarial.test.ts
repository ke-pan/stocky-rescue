import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createStockyArchive } from '../src/index.js';
import { resourceFromRequest } from './helpers.js';

const increasingResources = [
  'suppliers',
  'stock_adjustments',
  'stock_adjustment_items',
  'tax_types',
] as const;

function purchaseOrder(id: number) {
  return {
    id,
    number: id === 500 ? 'PO-1000A' : String(id),
    sequential_id: id,
    archived: false,
    currency: id % 2 ? 'CAD' : 'USD',
    future_field: id === 500 ? { retained: true } : undefined,
    purchase_items: [
      {
        id: id * 10,
        inventory_item_id: id,
        sku: id === 500 ? '' : `SKU-${id}`,
        status: 'not delivered',
        unexpected_item_field: id === 500 ? 'retained' : undefined,
      },
    ],
  };
}

function increasingRecord(resource: (typeof increasingResources)[number], id: number) {
  if (resource === 'stock_adjustment_items') {
    return {
      id,
      stock_adjustment_id: id,
      variant: { id, shopify_id: id, sku: '', barcode: '', future_variant_field: 'retained' },
    };
  }
  return { id, future_field: id === 1 ? 'retained' : undefined };
}

const emptyIdFetch: typeof fetch = async (input) => {
  const resource = resourceFromRequest(input);
  const records =
    resource === 'suppliers'
      ? Array.from({ length: 250 }, (_, index) => ({ id: index === 0 ? '' : index }))
      : [];
  return new Response(JSON.stringify({ [resource]: records }));
};

describe('Stocky pagination and adversarial payloads', () => {
  it('follows each endpoint direction and retains adversarial fields', async () => {
    const requests: Record<string, URL[]> = {};
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const resource = resourceFromRequest(input);
      requests[resource] ??= [];
      requests[resource].push(url);
      const sinceId = Number(url.searchParams.get('since_id') ?? 0);

      if (resource === 'purchase_orders') {
        const records =
          sinceId === 0
            ? Array.from({ length: 250 }, (_, index) => purchaseOrder(500 - index))
            : sinceId === 251
              ? Array.from({ length: 250 }, (_, index) => purchaseOrder(250 - index))
              : [];
        return new Response(JSON.stringify({ purchase_orders: records }));
      }

      const typedResource = resource as (typeof increasingResources)[number];
      const records =
        sinceId === 0
          ? Array.from({ length: 250 }, (_, index) => increasingRecord(typedResource, index + 1))
          : Array.from({ length: 50 }, (_, index) => increasingRecord(typedResource, index + 251));
      return new Response(JSON.stringify({ [resource]: records }));
    };

    const result = await createStockyArchive({
      shopDomain: 'example.myshopify.com',
      apiKey: 'fixture-only-secret',
      fetch: fetchMock,
      now: () => new Date('2026-07-14T01:02:03.000Z'),
    });

    expect(result.manifest.resources.purchase_orders).toMatchObject({
      page_count: 3,
      record_count: 500,
    });
    for (const resource of increasingResources) {
      expect(result.manifest.resources[resource]).toMatchObject({
        page_count: 2,
        record_count: 300,
      });
      expect(requests[resource][1].searchParams.get('since_id')).toBe('250');
    }
    expect(requests.purchase_orders.map((url) => url.searchParams.get('since_id'))).toEqual([
      null,
      '251',
      '1',
    ]);
    for (const resourceRequests of Object.values(requests)) {
      expect(resourceRequests.every((url) => !url.searchParams.has('offset'))).toBe(true);
    }

    const files = unzipSync(result.archive);
    expect(strFromU8(files['raw/purchase_orders/page-0001.json'])).toContain(
      '"future_field":{"retained":true}',
    );
    expect(strFromU8(files['raw/stock_adjustment_items/page-0001.json'])).toContain(
      '"future_variant_field":"retained"',
    );
    expect(strFromU8(files['normalized/purchase_orders.csv'])).toContain('PO-1000A');
    expect(strFromU8(files['normalized/purchase_order_items.csv'])).toContain('500,PO-1000A');
  });

  it('retains a full page with an empty record id as incomplete', async () => {
    const result = await createStockyArchive({
      shopDomain: 'example.myshopify.com',
      apiKey: 'fixture-only-secret',
      fetch: emptyIdFetch,
    });

    expect(result.manifest.resources.suppliers).toMatchObject({
      status: 'incomplete',
      page_count: 1,
      record_count: 250,
      failures: [{ page: 1, message: expect.stringContaining('missing or invalid id') }],
    });
    expect(unzipSync(result.archive)['raw/suppliers/page-0001.json']).toBeDefined();
  });
});
