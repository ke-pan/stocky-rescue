import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createStockyArchive } from '../src/index.js';
import { resourceFromRequest } from './helpers.js';

describe('partial upstream failure', () => {
  it('writes an incomplete archive with every successful page and a redacted failure', async () => {
    const apiKey = 'interrupted-fixture-secret';
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const resource = resourceFromRequest(input);
      if (resource === 'purchase_orders' && !url.searchParams.has('since_id')) {
        return new Response(
          JSON.stringify({
            purchase_orders: Array.from({ length: 250 }, (_, index) => ({
              id: 500 - index,
              number: String(500 - index),
              sequential_id: 500 - index,
              purchase_items: [],
            })),
          }),
        );
      }
      if (resource === 'purchase_orders') {
        throw new Error(`socket interrupted while using ${apiKey}`);
      }
      return new Response(JSON.stringify({ [resource]: [] }));
    };

    const result = await createStockyArchive({
      shopDomain: 'example.myshopify.com',
      apiKey,
      fetch: fetchMock,
      now: () => new Date('2026-07-14T01:02:03.000Z'),
    });

    expect(result.manifest.status).toBe('incomplete');
    expect(result.manifest.resources.purchase_orders).toMatchObject({
      status: 'incomplete',
      page_count: 1,
      record_count: 250,
      failures: [{ page: 2, message: 'socket interrupted while using [REDACTED]' }],
    });
    expect(result.manifest.failures).toContainEqual({
      resource: 'purchase_orders',
      page: 2,
      message: 'socket interrupted while using [REDACTED]',
    });
    expect(result.manifest.resources.suppliers.status).toBe('complete');

    const files = unzipSync(result.archive);
    expect(files['raw/purchase_orders/page-0001.json']).toBeDefined();
    expect(files['raw/purchase_orders/page-0002.json']).toBeUndefined();
    expect(strFromU8(files['manifest.json'])).not.toContain(apiKey);
    for (const bytes of Object.values(files)) expect(strFromU8(bytes)).not.toContain(apiKey);
  });
});
