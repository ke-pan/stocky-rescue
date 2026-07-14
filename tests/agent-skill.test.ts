import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const skillRoot = resolve(import.meta.dirname, '..');

describe('Stocky Rescue Agent Skill', () => {
  it('uses the product repository as the installable Skill package', () => {
    for (const relativePath of [
      'SKILL.md',
      'README.md',
      'LICENSE',
      'package.json',
      'pnpm-lock.yaml',
      'agents/openai.yaml',
      'evals/cases.json',
      'setup',
    ]) {
      expect(() => readFileSync(resolve(skillRoot, relativePath))).not.toThrow();
    }

    expect(existsSync(resolve(skillRoot, 'skill/stocky-rescue/scripts/inspect_archive.py'))).toBe(
      false,
    );

    const skill = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toContain('Never ask the user to paste a Stocky API key');
    expect(skill).toContain('August 31, 2026');
    expect(skill).toContain("node '<stocky-rescue-root>/dist/stocky-rescue.mjs' inspect");
    expect(skill).not.toMatch(/python/i);

    const setup = readFileSync(resolve(skillRoot, 'setup'), 'utf8');
    expect(setup).toContain('--ignore-workspace --frozen-lockfile');
    expect(setup).not.toContain('--no-frozen-lockfile');

    const readme = readFileSync(resolve(skillRoot, 'README.md'), 'utf8');
    expect(readme).toContain('.agents/skills/stocky-rescue');
    expect(readme).toContain('.claude/skills/stocky-rescue');
    expect(readme).toContain('Uninstall');
  });

  it('keeps the safety routing evals alongside the product', () => {
    const evals = JSON.parse(readFileSync(resolve(skillRoot, 'evals/cases.json'), 'utf8')) as {
      cases: Array<{ id: string }>;
    };
    expect(evals.cases.map(({ id }) => id).sort()).toEqual([
      'expired_api_access',
      'incomplete_archive',
      'malicious_archive_paths',
      'missing_credentials',
      'post_shutdown',
      'unknown_fields',
    ]);
  });
});
