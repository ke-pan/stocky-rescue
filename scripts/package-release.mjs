import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

import { zipSync } from 'fflate';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const expectedTag = `v${packageJson.version}`;
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== expectedTag) {
  throw new Error(
    `Release tag ${process.env.GITHUB_REF_NAME} does not match package version ${expectedTag}`,
  );
}
const filename = `stocky-rescue-v${packageJson.version}.zip`;
const files = Object.fromEntries(
  await Promise.all(
    [
      ['dist/stocky-rescue.mjs', 'dist/stocky-rescue.mjs'],
      ['SKILL.md', 'SKILL.md'],
      ['agents/openai.yaml', 'agents/openai.yaml'],
      ['evals/cases.json', 'evals/cases.json'],
      ['README.md', 'README.md'],
      ['CHANGELOG.md', 'CHANGELOG.md'],
      ['THREAT_MODEL.md', 'THREAT_MODEL.md'],
      ['SECURITY.md', 'SECURITY.md'],
      ['LICENSE', 'LICENSE'],
    ].map(async ([archivePath, sourcePath]) => [
      archivePath,
      new Uint8Array(await readFile(sourcePath)),
    ]),
  ),
);
const archive = zipSync(files, { level: 9 });
const checksum = createHash('sha256').update(archive).digest('hex');

await mkdir('release', { recursive: true });
await writeFile(`release/${filename}`, archive);
await writeFile(`release/${filename}.sha256`, `${checksum}  ${filename}\n`);

process.stdout.write(`Created release/${filename}\n`);
process.stdout.write(`SHA-256 ${checksum}\n`);
