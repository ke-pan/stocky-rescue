import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createStockyArchive } from '../src/index.js';
import { resourceFromRequest } from './helpers.js';

describe('migration-readiness report', () => {
  it('identifies migration-readiness risks', async () => {
    const payloads: Record<string, unknown[]> = {
      purchase_orders: [
        {
          id: 1,
          number: 'CUSTOM-9',
          sequential_id: 1,
          archived: false,
          currency: 'USD',
          purchase_items: [
            {
              id: 10,
              inventory_item_id: 100,
              sku: '',
              status: 'not delivered',
              received_at: null,
              updated_at: '14/07/2026 09:00',
            },
            {
              id: 11,
              inventory_item_id: 101,
              sku: 'DUP-SKU',
              status: 'received',
              received_at: '2026-07-14',
              updated_at: '14/07/2026 09:10',
            },
          ],
        },
        {
          id: 2,
          number: '2',
          sequential_id: 2,
          archived: false,
          currency: 'EUR',
          purchase_items: [
            {
              id: 12,
              inventory_item_id: 102,
              sku: 'DUP-SKU',
              status: 'unexpected upstream status',
              received_at: null,
            },
          ],
        },
        {
          id: 3,
          number: '3',
          sequential_id: 3,
          archived: true,
          currency: 'USD',
          purchase_items: [],
        },
        {
          id: 4,
          number: '4',
          sequential_id: 4,
          archived: false,
          currency: 'USD',
          purchase_items: [{ id: 13, sku: 'PARTIAL-SKU', status: 'partially delivered' }],
        },
        {
          id: 5,
          number: '5',
          sequential_id: 5,
          archived: false,
          currency: 'USD',
          purchase_items: [{ id: 14, sku: 'AMBIGUOUS-SKU', status: 'incomplete' }],
        },
      ],
      suppliers: [{ id: 8, name: 'Hidden Supplier', is_hidden: true }],
      stock_adjustments: [],
      stock_adjustment_items: [
        { id: 20, variant: { shopify_id: 200, sku: '', barcode: '' } },
        { id: 21, variant: { shopify_id: 201, sku: 'A', barcode: 'DUP-BARCODE' } },
        { id: 22, variant: { shopify_id: 202, sku: 'B', barcode: 'DUP-BARCODE' } },
      ],
      tax_types: [],
    };
    const fetchMock: typeof fetch = async (input) => {
      const resource = resourceFromRequest(input);
      return new Response(JSON.stringify({ [resource]: payloads[resource] }));
    };

    const result = await createStockyArchive({
      shopDomain: 'example.myshopify.com',
      apiKey: 'fixture-only-secret',
      fetch: fetchMock,
      now: () => new Date('2026-07-14T01:02:03.000Z'),
    });
    const files = unzipSync(result.archive);
    const report = JSON.parse(strFromU8(files['reports/migration-readiness.json']));

    expect(report.open_purchase_orders.map((po: { number: string }) => po.number)).toEqual([
      'CUSTOM-9',
      '2',
      '4',
      '5',
    ]);
    expect(report.custom_purchase_order_numbers).toEqual([
      { id: 1, number: 'CUSTOM-9', sequential_id: 1 },
    ]);
    expect(report.partial_or_ambiguous_receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purchase_order_id: 1, kind: 'partial' }),
        expect.objectContaining({ purchase_order_id: 2, kind: 'ambiguous' }),
        expect.objectContaining({ purchase_order_id: 4, kind: 'partial' }),
        expect.objectContaining({ purchase_order_id: 5, kind: 'ambiguous' }),
      ]),
    );
    expect(report.currencies).toEqual(['EUR', 'USD']);
    expect(report.locale_date_samples).toContainEqual(
      expect.objectContaining({ purchase_order_id: 1, value: '14/07/2026 09:00' }),
    );
    expect(report.identifiers.missing_sku_count).toBe(2);
    expect(report.identifiers.missing_barcode_count).toBe(1);
    expect(report.identifiers.duplicate_skus).toContainEqual(
      expect.objectContaining({ value: 'DUP-SKU' }),
    );
    expect(report.identifiers.duplicate_barcodes).toEqual([
      expect.objectContaining({ value: 'DUP-BARCODE' }),
    ]);
    expect(report.hidden_suppliers).toEqual([{ id: 8, name: 'Hidden Supplier' }]);
    expect(report.api_coverage_gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Stocktake'),
        expect.stringContaining('Average unit cost'),
        expect.stringContaining('supplier-product'),
      ]),
    );
  });
});
