import {
  asJsonRecord,
  type JsonRecord,
  type ResourceFailure,
  type ResourceName,
  STOCKY_API_ORIGIN,
  STOCKY_API_PATH,
} from './archive-types.js';

const REQUEST_TIMEOUT_MS = 60_000;

const paginationDirection: Record<ResourceName, 'greater-than' | 'less-than'> = {
  purchase_orders: 'less-than',
  suppliers: 'greater-than',
  stock_adjustments: 'greater-than',
  stock_adjustment_items: 'greater-than',
  tax_types: 'greater-than',
};

export interface FetchedResource {
  records: JsonRecord[];
  rawPages: string[];
  failure?: ResourceFailure;
}

class StockyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function cursorId(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

export async function fetchResource(
  name: ResourceName,
  shopDomain: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<FetchedResource> {
  const allRecords: JsonRecord[] = [];
  const rawPages: string[] = [];
  const seenCursors = new Set<number>();
  let cursor: number | undefined;

  while (true) {
    const pageNumber = rawPages.length + 1;
    try {
      const url = new URL(`${STOCKY_API_PATH}/${name}.json`, STOCKY_API_ORIGIN);
      url.searchParams.set('limit', '250');
      if (cursor !== undefined) url.searchParams.set('since_id', String(cursor));
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: 'application/json',
          'Store-Name': shopDomain,
          Authorization: `API KEY=${apiKey}`,
        },
      });
      if (!response.ok) {
        throw new StockyHttpError(
          `Stocky returned HTTP ${response.status} for ${name}`,
          response.status,
        );
      }

      const raw = await response.text();
      rawPages.push(raw);
      const body = JSON.parse(raw) as JsonRecord;
      const pageValue = body[name];
      if (!Array.isArray(pageValue)) throw new Error(`Stocky response did not contain ${name}`);
      const pageRecords = pageValue.filter((record): record is JsonRecord => {
        return asJsonRecord(record) === record;
      });
      if (pageRecords.length !== pageValue.length) {
        throw new Error(`Stocky returned a ${name} page with a non-object record`);
      }
      allRecords.push(...pageRecords);
      if (pageRecords.length < 250) break;

      const ids = pageRecords.map((record) => cursorId(record.id));
      if (ids.some((id) => id === undefined)) {
        throw new Error(`Stocky returned a full ${name} page with a missing or invalid id`);
      }
      const validIds = ids as number[];
      const nextCursor =
        paginationDirection[name] === 'less-than'
          ? Math.min(...validIds)
          : Math.max(...validIds);
      if (seenCursors.has(nextCursor)) {
        throw new Error(`Stocky pagination repeated cursor ${nextCursor} for ${name}`);
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const failure: ResourceFailure = {
        page: pageNumber,
        message: rawMessage.replaceAll(apiKey, '[REDACTED]'),
      };
      if (error instanceof StockyHttpError) failure.http_status = error.status;
      return { rawPages, records: allRecords, failure };
    }
  }

  return { rawPages, records: allRecords };
}
