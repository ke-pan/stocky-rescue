import { createHash } from 'node:crypto';

import { unzipSync } from 'fflate';

import {
  ARCHIVE_SCHEMA_VERSION,
  asJsonRecord,
  type JsonRecord,
  type ResourceName,
  resources,
} from './archive-types.js';
import { API_COVERAGE_GAPS } from './readiness-report.js';

const MAX_FILES = 10_000;
const MAX_EXPANDED_BYTES = 1_073_741_824;
const MAX_JSON_BYTES = 50_000_000;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const CHECKSUM_PATTERN = /^([0-9a-f]{64})  (.+)$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const knownGaps = new Set<string>(API_COVERAGE_GAPS);

export interface ArchiveReadLimits {
  maxFiles?: number;
  maxExpandedBytes?: number;
  maxJsonBytes?: number;
}

interface ZipMember {
  name: string;
  uncompressedSize: number;
}

export interface EndpointInspection {
  resource: string;
  status: 'complete' | 'incomplete';
  page_count: number | null;
  record_count: number | null;
}

export interface ArchiveInspectionSummary {
  archive_schema: typeof ARCHIVE_SCHEMA_VERSION;
  archive_status: 'complete' | 'incomplete';
  checksum_status: 'verified';
  exporter_version: string;
  endpoints: EndpointInspection[];
  incomplete_endpoints: string[];
  failure_statuses: number[];
  readiness_warning_counts: {
    open_purchase_order_candidates: number;
    partial_or_ambiguous_receipts: number;
    custom_purchase_order_numbers: number;
    locale_date_samples: number;
  };
  api_coverage_gaps: string[];
}

export interface StockyArchiveContents {
  summary: ArchiveInspectionSummary;
  manifest: JsonRecord;
  readiness: JsonRecord;
  records: Record<ResourceName, JsonRecord[]>;
}

export interface ArchiveInspectionContext {
  manifest: JsonRecord;
  readiness: JsonRecord;
  summary?: ArchiveInspectionSummary;
  checksumVerified?: true;
}

export class ArchiveInspectionError extends Error {
  override name = 'ArchiveInspectionError';

  constructor(
    message: string,
    readonly context?: ArchiveInspectionContext,
  ) {
    super(message);
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new ArchiveInspectionError('unreadable ZIP archive');
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new ArchiveInspectionError('unreadable ZIP archive');
  }
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function decodeMemberName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x800) === 0 && bytes.some((byte) => byte > 0x7f)) {
    throw new ArchiveInspectionError('archive member names must use UTF-8 or ASCII');
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new ArchiveInspectionError('archive contains an invalid member name');
  }
}

function ensureSafePath(name: string): void {
  const parts = name.split('/');
  const hasControlCharacter = [...name].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (
    !name ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[a-z]:/i.test(name) ||
    hasControlCharacter ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new ArchiveInspectionError(`unsafe archive path: ${JSON.stringify(name)}`);
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const firstPossibleOffset = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= firstPossibleOffset; offset -= 1) {
    if (readUint32(bytes, offset) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = readUint16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new ArchiveInspectionError('unreadable ZIP archive');
}

function validateZipMembers(bytes: Uint8Array, limits: ArchiveReadLimits = {}): ZipMember[] {
  const maxFiles = limits.maxFiles ?? MAX_FILES;
  const maxExpandedBytes = limits.maxExpandedBytes ?? MAX_EXPANDED_BYTES;
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDirectoryDisk = readUint16(bytes, endOffset + 6);
  const entriesOnDisk = readUint16(bytes, endOffset + 8);
  const entryCount = readUint16(bytes, endOffset + 10);
  const centralDirectorySize = readUint32(bytes, endOffset + 12);
  const centralDirectoryOffset = readUint32(bytes, endOffset + 16);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ArchiveInspectionError('multi-disk ZIP archives are not supported');
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new ArchiveInspectionError('ZIP64 archives are not supported');
  }
  if (entryCount > maxFiles) {
    throw new ArchiveInspectionError(`archive exceeds the ${maxFiles}-member safety limit`);
  }
  if (centralDirectoryOffset + centralDirectorySize !== endOffset) {
    throw new ArchiveInspectionError('unreadable ZIP central directory');
  }

  const members: ZipMember[] = [];
  const names = new Set<string>();
  let expandedBytes = 0;
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(bytes, offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new ArchiveInspectionError('unreadable ZIP central directory');
    }
    const madeBy = readUint16(bytes, offset + 4);
    const flags = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const externalAttributes = readUint32(bytes, offset + 38);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ArchiveInspectionError('ZIP64 archive members are not supported');
    }
    if ((flags & 1) !== 0) {
      throw new ArchiveInspectionError('encrypted ZIP members are not supported');
    }

    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const nextOffset = nameEnd + extraLength + commentLength;
    if (nextOffset > centralDirectoryOffset + centralDirectorySize) {
      throw new ArchiveInspectionError('unreadable ZIP central directory');
    }
    const name = decodeMemberName(bytes.subarray(nameStart, nameEnd), flags);
    ensureSafePath(name);
    if (names.has(name)) throw new ArchiveInspectionError(`duplicate archive path: ${name}`);
    names.add(name);

    const fileType = (externalAttributes >>> 16) & 0o170000;
    const hostSystem = madeBy >>> 8;
    if (hostSystem === 3 && fileType === 0o120000) {
      throw new ArchiveInspectionError(`symbolic links are not allowed: ${name}`);
    }

    if (readUint32(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER) {
      throw new ArchiveInspectionError(`unreadable local ZIP header: ${name}`);
    }
    const localFlags = readUint16(bytes, localHeaderOffset + 6);
    const localNameLength = readUint16(bytes, localHeaderOffset + 26);
    const localNameStart = localHeaderOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const localName = decodeMemberName(bytes.subarray(localNameStart, localNameEnd), localFlags);
    if (localName !== name) {
      throw new ArchiveInspectionError(`ZIP member name mismatch: ${name}`);
    }

    expandedBytes += uncompressedSize;
    if (expandedBytes > maxExpandedBytes) {
      throw new ArchiveInspectionError('archive exceeds the expanded-size safety limit');
    }
    members.push({ name, uncompressedSize });
    offset = nextOffset;
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new ArchiveInspectionError('unreadable ZIP central directory');
  }
  return members;
}

function decodeUtf8(bytes: Uint8Array, name: string): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new ArchiveInspectionError(`${name} is not valid UTF-8`);
  }
}

function loadJson(
  files: Record<string, Uint8Array>,
  members: Map<string, ZipMember>,
  name: string,
  maxJsonBytes = MAX_JSON_BYTES,
): Record<string, unknown> {
  const member = members.get(name);
  const content = files[name];
  if (!member || !content) {
    throw new ArchiveInspectionError(`missing required archive member: ${name}`);
  }
  if (member.uncompressedSize > maxJsonBytes) {
    throw new ArchiveInspectionError(
      `JSON member exceeds the ${maxJsonBytes}-byte safety limit: ${name}`,
    );
  }
  try {
    const value: unknown = JSON.parse(decodeUtf8(content, name));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ArchiveInspectionError(`expected a JSON object in ${name}`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ArchiveInspectionError) throw error;
    throw new ArchiveInspectionError(`invalid JSON in ${name}`);
  }
}

function verifyChecksums(files: Record<string, Uint8Array>, members: ZipMember[]): void {
  const checksumBytes = files['checksums.sha256'];
  if (!checksumBytes) {
    throw new ArchiveInspectionError('missing required archive member: checksums.sha256');
  }
  const rawLines = decodeUtf8(checksumBytes, 'checksums.sha256').split(/\r?\n/);
  if (rawLines.at(-1) === '') rawLines.pop();

  const expected = new Map<string, string>();
  for (const line of rawLines) {
    const match = CHECKSUM_PATTERN.exec(line);
    if (!match) {
      throw new ArchiveInspectionError('checksums.sha256 contains a malformed line');
    }
    const [, digest, name] = match;
    ensureSafePath(name);
    if (name === 'checksums.sha256') {
      throw new ArchiveInspectionError('checksums.sha256 must not list itself');
    }
    if (expected.has(name)) {
      throw new ArchiveInspectionError(`duplicate checksum entry: ${name}`);
    }
    expected.set(name, digest);
  }

  const archiveMembers = new Set(
    members.map(({ name }) => name).filter((name) => name !== 'checksums.sha256'),
  );
  const missing = [...archiveMembers].filter((name) => !expected.has(name)).sort();
  const extra = [...expected.keys()].filter((name) => !archiveMembers.has(name)).sort();
  if (missing.length || extra.length) {
    throw new ArchiveInspectionError(
      `checksum coverage mismatch (missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)})`,
    );
  }

  for (const [name, digest] of expected) {
    const content = files[name];
    if (!content || createHash('sha256').update(content).digest('hex') !== digest) {
      throw new ArchiveInspectionError(`checksum mismatch: ${name}`);
    }
  }
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function createRedactedSummary(
  manifest: Record<string, unknown>,
  readiness: Record<string, unknown>,
): ArchiveInspectionSummary {
  if (manifest.schema_version !== ARCHIVE_SCHEMA_VERSION) {
    throw new ArchiveInspectionError('unsupported or missing archive schema');
  }
  if (manifest.status !== 'complete' && manifest.status !== 'incomplete') {
    throw new ArchiveInspectionError('manifest status must be complete or incomplete');
  }

  const resourceMetadata = asJsonRecord(manifest.resources);
  const missingResources = resources.filter((name) => !(name in resourceMetadata)).sort();
  if (missingResources.length) {
    throw new ArchiveInspectionError(
      `missing required endpoint metadata: ${missingResources.join(', ')}`,
    );
  }

  const endpoints: EndpointInspection[] = [];
  const incompleteEndpoints: string[] = [];
  for (const name of [...resources].sort()) {
    const resource = asJsonRecord(resourceMetadata[name]);
    if (resource.status !== 'complete' && resource.status !== 'incomplete') {
      throw new ArchiveInspectionError('known endpoint status must be complete or incomplete');
    }
    if (resource.status === 'incomplete') incompleteEndpoints.push(name);
    endpoints.push({
      resource: name,
      status: resource.status,
      page_count: safeInteger(resource.page_count),
      record_count: safeInteger(resource.record_count),
    });
  }
  if (incompleteEndpoints.length && manifest.status !== 'incomplete') {
    throw new ArchiveInspectionError('endpoint status is incomplete but archive status is complete');
  }

  const failureStatuses = Array.isArray(manifest.failures)
    ? [
        ...new Set(
          manifest.failures
            .map((failure) => safeInteger(asJsonRecord(failure).http_status))
            .filter((status): status is number => status !== null),
        ),
      ].sort((left, right) => left - right)
    : [];
  const gaps = Array.isArray(readiness.api_coverage_gaps)
    ? readiness.api_coverage_gaps
        .filter((gap): gap is string => typeof gap === 'string' && knownGaps.has(gap))
        .sort()
    : [];
  const exporter = asJsonRecord(manifest.exporter);

  return {
    archive_schema: ARCHIVE_SCHEMA_VERSION,
    archive_status: manifest.status,
    checksum_status: 'verified',
    exporter_version: typeof exporter.version === 'string' ? exporter.version : 'unknown',
    endpoints,
    incomplete_endpoints: incompleteEndpoints,
    failure_statuses: failureStatuses,
    readiness_warning_counts: {
      open_purchase_order_candidates: listLength(readiness.open_purchase_orders),
      partial_or_ambiguous_receipts: listLength(readiness.partial_or_ambiguous_receipts),
      custom_purchase_order_numbers: listLength(readiness.custom_purchase_order_numbers),
      locale_date_samples: listLength(readiness.locale_date_samples),
    },
    api_coverage_gaps: gaps,
  };
}

function loadResourceRecords(
  files: Record<string, Uint8Array>,
  members: Map<string, ZipMember>,
  manifest: JsonRecord,
  maxJsonBytes: number,
): Record<ResourceName, JsonRecord[]> {
  const resourceMetadata = asJsonRecord(manifest.resources);
  const records = {} as Record<ResourceName, JsonRecord[]>;

  for (const name of resources) {
    const metadata = asJsonRecord(resourceMetadata[name]);
    const pageCount = safeInteger(metadata.page_count);
    if (pageCount === null || pageCount < 0) {
      throw new ArchiveInspectionError(`invalid page count for ${name}`);
    }

    const resourceRecords: JsonRecord[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const path = `raw/${name}/page-${String(page).padStart(4, '0')}.json`;
      const body = loadJson(files, members, path, maxJsonBytes);
      const pageRecords = body[name];
      if (!Array.isArray(pageRecords)) {
        throw new ArchiveInspectionError(`${path} does not contain ${name}`);
      }
      for (const value of pageRecords) {
        const record = asJsonRecord(value);
        if (record !== value) {
          throw new ArchiveInspectionError(`${path} contains a non-object record`);
        }
        resourceRecords.push(record);
      }
    }
    records[name] = resourceRecords;
  }

  return records;
}

export function readStockyArchive(
  archive: Uint8Array,
  limits: ArchiveReadLimits = {},
): StockyArchiveContents {
  const members = validateZipMembers(archive, limits);
  const maxJsonBytes = limits.maxJsonBytes ?? MAX_JSON_BYTES;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new ArchiveInspectionError('unreadable ZIP archive');
  }
  if (
    Object.keys(files).length !== members.length ||
    members.some(({ name }) => !Object.hasOwn(files, name))
  ) {
    throw new ArchiveInspectionError('ZIP member table mismatch');
  }

  const memberMap = new Map(members.map((member) => [member.name, member]));
  const manifest = loadJson(files, memberMap, 'manifest.json', maxJsonBytes);
  const readiness = loadJson(
    files,
    memberMap,
    'reports/migration-readiness.json',
    maxJsonBytes,
  );
  try {
    verifyChecksums(files, members);
  } catch (error) {
    if (error instanceof ArchiveInspectionError) {
      throw new ArchiveInspectionError(error.message, { manifest, readiness });
    }
    throw error;
  }
  let summary: ArchiveInspectionSummary;
  try {
    summary = createRedactedSummary(manifest, readiness);
  } catch (error) {
    if (error instanceof ArchiveInspectionError) {
      throw new ArchiveInspectionError(error.message, {
        manifest,
        readiness,
        checksumVerified: true,
      });
    }
    throw error;
  }
  let records: Record<ResourceName, JsonRecord[]>;
  try {
    records = loadResourceRecords(files, memberMap, manifest, maxJsonBytes);
  } catch (error) {
    if (error instanceof ArchiveInspectionError) {
      throw new ArchiveInspectionError(error.message, {
        manifest,
        readiness,
        summary,
        checksumVerified: true,
      });
    }
    throw error;
  }
  return { summary, manifest, readiness, records };
}

export function inspectStockyArchive(archive: Uint8Array): ArchiveInspectionSummary {
  const members = validateZipMembers(archive);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new ArchiveInspectionError('unreadable ZIP archive');
  }
  if (
    Object.keys(files).length !== members.length ||
    members.some(({ name }) => !Object.hasOwn(files, name))
  ) {
    throw new ArchiveInspectionError('ZIP member table mismatch');
  }

  verifyChecksums(files, members);
  const memberMap = new Map(members.map((member) => [member.name, member]));
  const manifest = loadJson(files, memberMap, 'manifest.json');
  const readiness = loadJson(files, memberMap, 'reports/migration-readiness.json');
  return createRedactedSummary(manifest, readiness);
}

export function renderInspectionText(summary: ArchiveInspectionSummary): string {
  const lines = [
    'Stocky Rescue archive inspection',
    `Checksums: ${summary.checksum_status}`,
    `Archive: ${summary.archive_status.toUpperCase()}`,
    `Schema: ${summary.archive_schema}`,
    `Exporter: ${summary.exporter_version}`,
    ...summary.endpoints.map(
      (endpoint) =>
        `- ${endpoint.resource}: ${endpoint.status} ` +
        `(${endpoint.record_count ?? 'unknown'} records, ${endpoint.page_count ?? 'unknown'} pages)`,
    ),
  ];
  if (summary.incomplete_endpoints.length) {
    lines.push(`Incomplete endpoints: ${summary.incomplete_endpoints.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
