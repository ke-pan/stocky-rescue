import {
  asJsonRecord,
  type JsonRecord,
  type ResourceName,
} from './archive-types.js';

type ReceiptKind = 'received' | 'pending' | 'partial' | 'unknown';

export const API_COVERAGE_GAPS = [
  'Stocktake count sheets and complete stocktake history',
  'Average unit cost',
  'Forecast and replenishment settings',
  'Stocky supplier-product mappings, pack sizes, and every supplier setting',
  'Saved reports, custom fields, and Stocky users',
] as const;

function receiptKind(item: JsonRecord): ReceiptKind {
  const status = String(item.status ?? '').trim().toLowerCase();
  if (['received', 'delivered', 'complete', 'completed'].includes(status)) return 'received';
  if (
    ['', 'not delivered', 'not received', 'undelivered', 'unreceived', 'pending', 'ordered'].includes(
      status,
    )
  ) {
    return 'pending';
  }
  if (['partial', 'partially delivered', 'partially received'].includes(status)) return 'partial';
  return 'unknown';
}

function duplicateIdentifierValues(
  entries: Array<{ entity_id: unknown; value: string }>,
  source: string,
): JsonRecord[] {
  const byValue = new Map<string, { value: string; entityIds: Set<unknown> }>();
  for (const entry of entries) {
    if (!entry.value) continue;
    const key = entry.value.toLocaleLowerCase();
    const existing = byValue.get(key) ?? { value: entry.value, entityIds: new Set() };
    existing.entityIds.add(entry.entity_id);
    byValue.set(key, existing);
  }
  return [...byValue.values()]
    .filter(({ entityIds }) => entityIds.size > 1)
    .map(({ value, entityIds }) => ({ value, source, entity_ids: [...entityIds] }));
}

export function createReadinessReport(
  data: Record<ResourceName, JsonRecord[]>,
  exportedAt: string,
): JsonRecord {
  const purchaseItems = data.purchase_orders.flatMap((purchaseOrder) => {
    const items = purchaseOrder.purchase_items;
    return Array.isArray(items)
      ? items.map((item) => ({ purchaseOrder, item: asJsonRecord(item) }))
      : [];
  });
  const openPurchaseOrders = data.purchase_orders
    .filter((purchaseOrder) => {
      if (purchaseOrder.archived === true) return false;
      const items = Array.isArray(purchaseOrder.purchase_items)
        ? purchaseOrder.purchase_items.map(asJsonRecord)
        : [];
      return items.length === 0 || items.some((item) => receiptKind(item) !== 'received');
    })
    .map((purchaseOrder) => ({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      confidence: 'inferred',
      reason: 'Not archived and at least one line is not clearly received',
    }));
  const receiptFindings = data.purchase_orders.flatMap((purchaseOrder) => {
    const items = Array.isArray(purchaseOrder.purchase_items)
      ? purchaseOrder.purchase_items.map(asJsonRecord)
      : [];
    const kinds = new Set(items.map(receiptKind));
    if (kinds.has('unknown')) {
      return [
        {
          purchase_order_id: purchaseOrder.id,
          purchase_order_number: purchaseOrder.number,
          kind: 'ambiguous',
          reason: 'At least one line uses an unrecognized receipt status',
        },
      ];
    }
    if (kinds.has('partial') || (kinds.has('received') && kinds.has('pending'))) {
      return [
        {
          purchase_order_id: purchaseOrder.id,
          purchase_order_number: purchaseOrder.number,
          kind: 'partial',
          reason: 'The PO mixes clearly received and pending lines',
        },
      ];
    }
    return [];
  });
  const localeDateSamples = purchaseItems.flatMap(({ purchaseOrder, item }) =>
    ['updated_at', 'received_at'].flatMap((field) => {
      const value = item[field];
      if (typeof value !== 'string' || /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return [];
      return [{ purchase_order_id: purchaseOrder.id, item_id: item.id, field, value }];
    }),
  );
  const poSkuEntries = purchaseItems.map(({ item }) => ({
    entity_id: item.inventory_item_id ?? item.id,
    value: typeof item.sku === 'string' ? item.sku.trim() : '',
  }));
  const adjustmentIdentifierEntries = data.stock_adjustment_items.map((item) => {
    const variant = asJsonRecord(item.variant);
    return {
      entity_id: variant.shopify_id ?? variant.id ?? item.id,
      sku: typeof variant.sku === 'string' ? variant.sku.trim() : '',
      barcode: typeof variant.barcode === 'string' ? variant.barcode.trim() : '',
    };
  });
  return {
    report_version: 'stocky-migration-readiness/v1',
    generated_at: exportedAt,
    confidence: 'beta',
    open_purchase_orders: openPurchaseOrders,
    custom_purchase_order_numbers: data.purchase_orders
      .filter((po) => String(po.number) !== String(po.sequential_id))
      .map((po) => ({ id: po.id, number: po.number, sequential_id: po.sequential_id })),
    partial_or_ambiguous_receipts: receiptFindings,
    currencies: [...new Set(data.purchase_orders.map((po) => po.currency).filter(Boolean))].sort(),
    locale_date_samples: localeDateSamples.slice(0, 20),
    identifiers: {
      missing_sku_count:
        poSkuEntries.filter((entry) => !entry.value).length +
        adjustmentIdentifierEntries.filter((entry) => !entry.sku).length,
      missing_barcode_count: adjustmentIdentifierEntries.filter((entry) => !entry.barcode).length,
      duplicate_skus: [
        ...duplicateIdentifierValues(poSkuEntries, 'purchase_order_items'),
        ...duplicateIdentifierValues(
          adjustmentIdentifierEntries.map(({ entity_id, sku }) => ({
            entity_id,
            value: sku,
          })),
          'stock_adjustment_items',
        ),
      ],
      duplicate_barcodes: duplicateIdentifierValues(
        adjustmentIdentifierEntries.map(({ entity_id, barcode }) => ({
          entity_id,
          value: barcode,
        })),
        'stock_adjustment_items',
      ),
      note: 'The PO API does not expose barcodes; barcode checks use adjustment items only.',
    },
    hidden_suppliers: data.suppliers
      .filter((supplier) => supplier.is_hidden === true)
      .map((supplier) => ({ id: supplier.id, name: supplier.name })),
    api_coverage_gaps: API_COVERAGE_GAPS,
  };
}

export function supplementalChecklist(): string {
  return `# Supplemental manual exports\n\n` +
    `The Stocky API cannot provide a complete backup. Export these locally as well:\n\n` +
    `- [ ] Every still-visible Stocktake CSV\n` +
    `- [ ] SKU/Variant CSV and PDF with Average Cost\n` +
    `- [ ] CSV and PDF for every important purchase order\n` +
    `- [ ] Useful report PDFs and any unsupported Stocky configuration\n` +
    `- [ ] Export timestamps, filters, displayed counts, and two local backup copies\n\n` +
    `Never paste a Stocky API key into AI chat, email, a filename, or this archive.\n`;
}
