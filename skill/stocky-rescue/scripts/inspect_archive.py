#!/usr/bin/env python3
'''Verify a Stocky Rescue ZIP and emit a redacted structural summary.'''

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


MAX_FILES = 10_000
MAX_EXPANDED_BYTES = 1_073_741_824
MAX_JSON_BYTES = 50_000_000
CHECKSUM_PATTERN = re.compile(r'^([0-9a-f]{64})  (.+)$')
KNOWN_RESOURCES = frozenset(
  {
    'purchase_orders',
    'stock_adjustment_items',
    'stock_adjustments',
    'suppliers',
    'tax_types',
  }
)
KNOWN_GAPS = frozenset(
  {
    'Average unit cost',
    'Forecast and replenishment settings',
    'Saved reports, custom fields, and Stocky users',
    'Stocktake count sheets and complete stocktake history',
    'Stocky supplier-product mappings, pack sizes, and every supplier setting',
  }
)


class ArchiveError(Exception):
  '''Raised when an archive cannot be trusted.'''


def ensure_safe_path(name: str) -> None:
  path = PurePosixPath(name)
  if (
    not name
    or '\\' in name
    or name.startswith('/')
    or path.is_absolute()
    or any(part in {'', '.', '..'} for part in path.parts)
  ):
    raise ArchiveError(f'unsafe archive path: {name!r}')


def load_json(archive: zipfile.ZipFile, name: str) -> dict[str, Any]:
  try:
    info = archive.getinfo(name)
  except KeyError as error:
    raise ArchiveError(f'missing required archive member: {name}') from error
  if info.file_size > MAX_JSON_BYTES:
    raise ArchiveError(
      f'JSON member exceeds the {MAX_JSON_BYTES}-byte safety limit: {name}'
    )
  try:
    value = json.loads(archive.read(info))
  except (json.JSONDecodeError, UnicodeDecodeError) as error:
    raise ArchiveError(f'invalid JSON in {name}') from error
  if not isinstance(value, dict):
    raise ArchiveError(f'expected a JSON object in {name}')
  return value


def validate_members(archive: zipfile.ZipFile) -> list[str]:
  infos = archive.infolist()
  if len(infos) > MAX_FILES:
    raise ArchiveError(f'archive exceeds the {MAX_FILES}-member safety limit')
  if sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES:
    raise ArchiveError('archive exceeds the expanded-size safety limit')

  names: list[str] = []
  seen: set[str] = set()
  for info in infos:
    ensure_safe_path(info.filename)
    if info.filename in seen:
      raise ArchiveError(f'duplicate archive path: {info.filename}')
    seen.add(info.filename)
    names.append(info.filename)
    file_type = (info.external_attr >> 16) & 0o170000
    if file_type == stat.S_IFLNK:
      raise ArchiveError(f'symbolic links are not allowed: {info.filename}')
  return names


def verify_checksums(archive: zipfile.ZipFile, names: list[str]) -> None:
  if 'checksums.sha256' not in names:
    raise ArchiveError('missing required archive member: checksums.sha256')
  try:
    lines = archive.read('checksums.sha256').decode('utf-8').splitlines()
  except UnicodeDecodeError as error:
    raise ArchiveError('checksums.sha256 is not valid UTF-8') from error

  expected: dict[str, str] = {}
  for line in lines:
    match = CHECKSUM_PATTERN.fullmatch(line)
    if not match:
      raise ArchiveError('checksums.sha256 contains a malformed line')
    digest, name = match.groups()
    ensure_safe_path(name)
    if name == 'checksums.sha256':
      raise ArchiveError('checksums.sha256 must not list itself')
    if name in expected:
      raise ArchiveError(f'duplicate checksum entry: {name}')
    expected[name] = digest

  archive_members = set(names) - {'checksums.sha256'}
  if set(expected) != archive_members:
    missing = sorted(archive_members - set(expected))
    extra = sorted(set(expected) - archive_members)
    raise ArchiveError(
      f'checksum coverage mismatch (missing={missing}, extra={extra})'
    )

  for name, digest in expected.items():
    actual = hashlib.sha256(archive.read(name)).hexdigest()
    if actual != digest:
      raise ArchiveError(f'checksum mismatch: {name}')


def integer(value: Any) -> int | None:
  return value if isinstance(value, int) and not isinstance(value, bool) else None


def list_length(value: Any) -> int:
  return len(value) if isinstance(value, list) else 0


def redacted_summary(
  manifest: dict[str, Any],
  readiness: dict[str, Any],
) -> dict[str, Any]:
  if manifest.get('schema_version') != 'stocky-rescue-archive/v1':
    raise ArchiveError('unsupported or missing archive schema')
  status_value = manifest.get('status')
  if status_value not in {'complete', 'incomplete'}:
    raise ArchiveError('manifest status must be complete or incomplete')

  exporter = manifest.get('exporter')
  exporter_version = exporter.get('version') if isinstance(exporter, dict) else None
  resources = manifest.get('resources')
  if not isinstance(resources, dict):
    raise ArchiveError('manifest resources must be an object')
  missing_resources = sorted(KNOWN_RESOURCES - resources.keys())
  if missing_resources:
    missing = ', '.join(missing_resources)
    raise ArchiveError(f'missing required endpoint metadata: {missing}')

  endpoints: list[dict[str, Any]] = []
  incomplete: list[str] = []
  for name in sorted(KNOWN_RESOURCES & resources.keys()):
    resource = resources[name]
    if not isinstance(resource, dict):
      raise ArchiveError('known manifest resource must be an object')
    resource_status = resource.get('status')
    if resource_status not in {'complete', 'incomplete'}:
      raise ArchiveError('known endpoint status must be complete or incomplete')
    if resource_status == 'incomplete':
      incomplete.append(name)
    endpoints.append(
      {
        'resource': name,
        'status': resource_status,
        'page_count': integer(resource.get('page_count')),
        'record_count': integer(resource.get('record_count')),
      }
    )

  failures = manifest.get('failures')
  failure_statuses = (
    sorted(
      {
        status_code
        for failure in failures
        if isinstance(failure, dict)
        if (status_code := integer(failure.get('http_status'))) is not None
      }
    )
    if isinstance(failures, list)
    else []
  )
  gaps = readiness.get('api_coverage_gaps')
  safe_gaps = (
    sorted(KNOWN_GAPS & set(gap for gap in gaps if isinstance(gap, str)))
    if isinstance(gaps, list)
    else []
  )
  summary = {
    'archive_schema': manifest['schema_version'],
    'archive_status': status_value,
    'checksum_status': 'verified',
    'exporter_version': (
      exporter_version if isinstance(exporter_version, str) else 'unknown'
    ),
    'endpoints': endpoints,
    'incomplete_endpoints': incomplete,
    'failure_statuses': failure_statuses,
    'readiness_warning_counts': {
      'open_purchase_order_candidates': list_length(
        readiness.get('open_purchase_orders')
      ),
      'partial_or_ambiguous_receipts': list_length(
        readiness.get('partial_or_ambiguous_receipts')
      ),
      'custom_purchase_order_numbers': list_length(
        readiness.get('custom_purchase_order_numbers')
      ),
      'locale_date_samples': list_length(readiness.get('locale_date_samples')),
    },
    'api_coverage_gaps': safe_gaps,
  }
  if incomplete and status_value != 'incomplete':
    raise ArchiveError('endpoint status is incomplete but archive status is complete')
  return summary


def inspect(path: Path) -> dict[str, Any]:
  try:
    with zipfile.ZipFile(path) as archive:
      names = validate_members(archive)
      verify_checksums(archive, names)
      manifest = load_json(archive, 'manifest.json')
      readiness = load_json(archive, 'reports/migration-readiness.json')
      return redacted_summary(manifest, readiness)
  except (OSError, zipfile.BadZipFile) as error:
    raise ArchiveError('unreadable ZIP archive') from error


def render_text(summary: dict[str, Any]) -> str:
  lines = [
    'Stocky Rescue archive inspection',
    'Checksums: {}'.format(summary['checksum_status']),
    'Archive: {}'.format(str(summary['archive_status']).upper()),
    'Schema: {}'.format(summary['archive_schema']),
    'Exporter: {}'.format(summary['exporter_version']),
  ]
  for endpoint in summary['endpoints']:
    lines.append(
      '- {resource}: {status} ({record_count} records, {page_count} pages)'.format(
        **endpoint
      )
    )
  if summary['incomplete_endpoints']:
    lines.append(
      'Incomplete endpoints: ' + ', '.join(summary['incomplete_endpoints'])
    )
  return '\n'.join(lines) + '\n'


def main() -> int:
  parser = argparse.ArgumentParser(
    description=(
      'Verify a Stocky Rescue archive without extracting it or exposing raw records.'
    )
  )
  parser.add_argument('archive', type=Path, help='path to a Stocky Rescue ZIP')
  parser.add_argument('--json', action='store_true', help='emit a JSON structural summary')
  parser.add_argument('--output', type=Path, help='write the summary to a new local file')
  args = parser.parse_args()

  try:
    summary = inspect(args.archive)
    rendered = (
      json.dumps(summary, indent=2, sort_keys=True) + '\n'
      if args.json
      else render_text(summary)
    )
    if args.output:
      with args.output.open('x', encoding='utf-8') as destination:
        destination.write(rendered)
    else:
      sys.stdout.write(rendered)
    return 2 if summary['archive_status'] == 'incomplete' else 0
  except (ArchiveError, OSError) as error:
    sys.stderr.write(f'Archive inspection failed: {error}\n')
    return 1


if __name__ == '__main__':
  raise SystemExit(main())
