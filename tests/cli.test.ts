import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';
import { resourceFromRequest } from './helpers.js';

function emptyFetch(failingResource?: string): typeof fetch {
  return async (input) => {
    const resource = resourceFromRequest(input);
    if (resource === failingResource) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ [resource]: [] }));
  };
}

describe('local CLI', () => {
  it('uses a hidden key prompt and writes a complete archive', async () => {
    const apiKey = 'cli-fixture-secret';
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Array<{ path: string; data: Uint8Array }> = [];
    const readSecret = vi.fn(async () => apiKey);

    const exitCode = await runCli(['--shop', 'example.myshopify.com', '--output', 'rescue.zip'], {
      fetch: emptyFetch(),
      now: () => new Date('2026-07-14T01:02:03.000Z'),
      readSecret,
      writeFile: async (path, data) => {
        writes.push({ path, data });
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(readSecret).toHaveBeenCalledWith('Stocky API key: ');
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('rescue.zip');
    expect(JSON.stringify({ stdout, stderr })).not.toContain(apiKey);
    expect(JSON.parse(strFromU8(unzipSync(writes[0].data)['manifest.json'])).status).toBe(
      'complete',
    );
  });

  it('writes a visibly incomplete archive and returns exit code 2', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Array<{ path: string; data: Uint8Array }> = [];
    const exitCode = await runCli(['--shop', 'example.myshopify.com'], {
      fetch: emptyFetch('suppliers'),
      now: () => new Date('2026-07-14T01:02:03.000Z'),
      readSecret: async () => 'cli-fixture-secret',
      writeFile: async (path, data) => {
        writes.push({ path, data });
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(writes[0].path).toBe('stocky-rescue-example-20260714T010203Z.zip');
    expect(JSON.parse(strFromU8(unzipSync(writes[0].data)['manifest.json'])).status).toBe(
      'incomplete',
    );
    expect(stderr.join('\n')).toContain('INCOMPLETE');
  });

  it('rejects invalid shops and any attempt to pass a key on the command line', async () => {
    const invalidShopErrors: string[] = [];
    const readSecret = vi.fn(async () => 'must-not-be-read');
    expect(
      await runCli(['--shop', 'https://evil.example.com'], {
        readSecret,
        stderr: (message) => invalidShopErrors.push(message),
      }),
    ).toBe(1);
    expect(readSecret).not.toHaveBeenCalled();
    expect(invalidShopErrors.join('\n')).toContain('valid .myshopify.com domain');

    const keyArgumentErrors: string[] = [];
    expect(
      await runCli(['--api-key', 'do-not-echo-this'], {
        stderr: (message) => keyArgumentErrors.push(message),
      }),
    ).toBe(1);
    expect(keyArgumentErrors.join('\n')).toContain(
      'API keys are accepted only at the hidden prompt',
    );
    expect(keyArgumentErrors.join('\n')).not.toContain('do-not-echo-this');
  });
});
