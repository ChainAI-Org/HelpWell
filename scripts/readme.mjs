/**
 * Rewrite the generated parts of the README and the docs from the code.
 *
 * The webhook table and the setup prompts are generated, not written by hand,
 * so they cannot drift from what the code sends and says: each sits between
 * `<!-- generated:name -->` and `<!-- /generated:name -->`, and this rewrites
 * what is between them. The blocks are defined in packages/cli/src/readme.ts,
 * and packages/cli/test/readme.test.ts fails while any file is out of date.
 *
 *   pnpm build && pnpm readme          # rewrite them
 *   pnpm readme --check                # exit 1 if any is out of date
 *
 * It reads the CLI's build, so build first.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedFiles, updateGenerated } from '../packages/cli/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const stale = [];
for (const file of generatedFiles()) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = updateGenerated(before, file);
  if (after === before) continue;
  stale.push(file);
  if (!check) writeFileSync(path, after, 'utf8');
}

if (stale.length === 0) {
  console.log('Generated blocks are up to date.');
} else if (check) {
  console.error(`Out of date: ${stale.join(', ')}. Run \`pnpm build && pnpm readme\`.`);
  process.exitCode = 1;
} else {
  console.log(`Rewrote the generated blocks in ${stale.join(', ')}.`);
}
