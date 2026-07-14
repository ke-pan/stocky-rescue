import { chmod, mkdir } from 'node:fs/promises';

import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/stocky-rescue.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'inline',
  sourcemap: false,
});
await chmod('dist/stocky-rescue.mjs', 0o755);
