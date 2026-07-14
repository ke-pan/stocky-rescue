import {
  asJsonRecord,
  type JsonRecord,
  type ResourceName,
} from './archive-types.js';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: JsonRecord[], columns: string[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

export function normalizedFiles(
  data: Record<ResourceName, JsonRecord[]>,
): Record<string, string> {
  const purchaseOrderItems = data.purchase_orders.flatMap((purchaseOrder) => {
    const items = purchaseOrder.purchase_items;
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      purchase_order_id: purchaseOrder.id,
      purchase_order_number: purchaseOrder.number,
      ...asJsonRecord(item),
    }));
  });
  const stockAdjustments = data.stock_adjustments.map((adjustment) => {
    const location = asJsonRecord(adjustment.location);
    const reason = asJsonRecord(adjustment.stock_adjustment_reason);
    return {
      ...adjustment,
      location_id: location.id,
      shopify_location_id: location.shopify_id,
      reason_id: reason.id,
      reason: reason.reason,
    };
  });
  const stockAdjustmentItems = data.stock_adjustment_items.map((item) => {
    const variant = asJsonRecord(item.variant);
    return {
      ...item,
      variant_id: variant.id,
      shopify_variant_id: variant.shopify_id,
      variant_title: variant.title,
      sku: variant.sku,
      barcode: variant.barcode,
    };
  });

  return {
    'normalized/purchase_orders.csv': csv(data.purchase_orders, [
      'id',
      'number',
      'sequential_id',
      'invoice_number',
      'created_at',
      'updated_at',
      'generated_at',
      'ordered_at',
      'expected_on',
      'ship_on',
      'payment_due_on',
      'archived',
      'supplier_name',
      'supplier_id',
      'currency',
      'shopify_receive_location_id',
      'paid',
      'adjustments',
      'adjustments_local',
      'shipping',
      'shipping_local',
      'shipping_tax_type',
      'invoice_date',
    ]),
    'normalized/purchase_order_items.csv': csv(purchaseOrderItems, [
      'purchase_order_id',
      'purchase_order_number',
      'id',
      'inventory_item_id',
      'sku',
      'product_title',
      'variant_title',
      'quantity',
      'status',
      'received_at',
      'retail_price',
      'cost_price',
      'supplier_cost_price',
      'tax_type_id',
    ]),
    'normalized/suppliers.csv': csv(data.suppliers, [
      'id',
      'name',
      'company_name',
      'account_number',
      'contact_name',
      'contact_email',
      'address1',
      'address2',
      'city',
      'province_code',
      'country_name',
      'zip',
      'phone',
      'phone_toll_free',
      'fax',
      'is_hidden',
      'created_at',
      'updated_at',
    ]),
    'normalized/stock_adjustments.csv': csv(stockAdjustments, [
      'id',
      'sequential_id',
      'adjusted_at',
      'created_at',
      'updated_at',
      'archived',
      'location_id',
      'shopify_location_id',
      'reason_id',
      'reason',
    ]),
    'normalized/stock_adjustment_items.csv': csv(stockAdjustmentItems, [
      'id',
      'quantity',
      'updated_at',
      'status',
      'previous_quantity',
      'new_quantity',
      'stock_adjustment_id',
      'adjusted_at',
      'variant_id',
      'shopify_variant_id',
      'variant_title',
      'sku',
      'barcode',
    ]),
    'normalized/tax_types.csv': csv(data.tax_types, [
      'id',
      'name',
      'code',
      'tax_rate',
      'purpose',
      'accounting_tax_type',
      'created_at',
      'updated_at',
    ]),
  };
}
