export function resourceFromRequest(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname.split('/').at(-1)?.replace('.json', '') ?? '';
}
