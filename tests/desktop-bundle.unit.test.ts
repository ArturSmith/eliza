import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRuntimeLinks } from '../apps/desktop/scripts/build-postgres.mjs';
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'eliza-bundle-links-'));
  mkdirSync(join(directory, 'runtime'));
  writeFileSync(join(directory, 'runtime', 'library'), 'bundled');
  writeFileSync(join(directory, 'outside'), 'build machine only');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it('accepts relocatable links within the runtime, including macOS temporary-directory aliases', () => {
  symlinkSync('library', join(directory, 'runtime', 'link'));
  expect(() => verifyRuntimeLinks(join(directory, 'runtime'))).not.toThrow();
});
it('rejects a relative dependency that escapes into a build-machine directory', () => {
  symlinkSync('../outside', join(directory, 'runtime', 'link'));
  expect(() => verifyRuntimeLinks(join(directory, 'runtime'))).toThrow('escapes');
});
it('rejects absolute links even when their targets currently exist inside the runtime', () => {
  symlinkSync(join(directory, 'runtime', 'library'), join(directory, 'runtime', 'link'));
  expect(() => verifyRuntimeLinks(join(directory, 'runtime'))).toThrow('escapes');
});
