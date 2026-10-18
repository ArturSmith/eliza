import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  link: vi.fn(async () => {
    throw Object.assign(new Error('No hard links on USB'), { code: 'ENOTSUP' });
  }),
}));
import { publishArchive } from '../apps/desktop/src/backup.mjs';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'eliza-backup-publish-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('exports complete backup bytes when the filesystem cannot create hard links', async () => {
  const source = join(directory, 'archive'),
    destination = join(directory, 'copy');
  await writeFile(source, 'complete private backup', { mode: 0o600 });
  await publishArchive(source, destination);
  expect(await readFile(destination, 'utf8')).toBe('complete private backup');
});
it('never replaces an existing backup in the USB fallback', async () => {
  const source = join(directory, 'archive'),
    destination = join(directory, 'copy');
  await writeFile(source, 'new backup', { mode: 0o600 });
  await writeFile(destination, 'original backup', { mode: 0o600 });
  await expect(publishArchive(source, destination)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(destination, 'utf8')).toBe('original backup');
});
