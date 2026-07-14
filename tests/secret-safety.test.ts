import { describe, expect, it } from 'vitest';

import { createStockyArchive } from '../src/index.js';
import { resourceFromRequest } from './helpers.js';

describe('credential safety', () => {
  it('refuses to create an archive if an upstream payload echoes the API key', async () => {
    const apiKey = 'malicious-echo-fixture-secret';
    const fetchMock: typeof fetch = async (input) => {
      const resource = resourceFromRequest(input);
      const records = resource === 'suppliers' ? [{ id: 1, unexpected: apiKey }] : [];
      return new Response(JSON.stringify({ [resource]: records }));
    };

    await expect(
      createStockyArchive({
        shopDomain: 'example.myshopify.com',
        apiKey,
        fetch: fetchMock,
      }),
    ).rejects.toThrow('Refusing to create an archive because credential material was detected');
  });
});
