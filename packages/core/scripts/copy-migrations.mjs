import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'src', 'db', 'migrations');
const to = join(here, '..', 'dist', 'migrations');
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('core: copied migrations to dist/migrations');
