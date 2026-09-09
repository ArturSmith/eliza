import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
export const expectedMigrations = readdirSync(directory)
  .filter((n) => n.endsWith('.sql'))
  .map((name) => ({
    name,
    checksum: createHash('sha256')
      .update(readFileSync(directory + '/' + name))
      .digest('hex'),
  }));
