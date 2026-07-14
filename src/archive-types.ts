export const STOCKY_API_ORIGIN = 'https://stocky.shopifyapps.com';
export const STOCKY_API_PATH = '/api/v2';
export const ARCHIVE_SCHEMA_VERSION = 'stocky-rescue-archive/v1';

export const resources = [
  'purchase_orders',
  'suppliers',
  'stock_adjustments',
  'stock_adjustment_items',
  'tax_types',
] as const;

export type ResourceName = (typeof resources)[number];
export type JsonRecord = Record<string, unknown>;
export type ResourceFailure = { page: number; message: string; http_status?: number };
export type ArchiveFailure = ResourceFailure & { resource: ResourceName };

export interface ResourceManifest {
  endpoint: string;
  status: 'complete' | 'incomplete';
  page_count: number;
  record_count: number;
  failures: ResourceFailure[];
}

export interface ArchiveManifest {
  schema_version: typeof ARCHIVE_SCHEMA_VERSION;
  exporter: { name: 'Stocky Rescue'; version: string };
  status: 'complete' | 'incomplete';
  exported_at: string;
  shop_domain: string;
  source: { origin: typeof STOCKY_API_ORIGIN; api_version: 'v2' };
  resources: Record<ResourceName, ResourceManifest>;
  failures: ArchiveFailure[];
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface CreateStockyArchiveOptions {
  shopDomain: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

export interface StockyArchiveResult {
  archive: Uint8Array;
  manifest: ArchiveManifest;
}

export function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
