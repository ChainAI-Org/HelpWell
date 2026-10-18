import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssVariables, skeletonCss } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
mkdirSync(dist, { recursive: true });

const header = '/* Generated from @helpwell/tokens. Do not edit by hand. */\n\n';
writeFileSync(join(dist, 'helpwell.css'), `${header}${cssVariables()}\n`);
writeFileSync(join(dist, 'skeleton.css'), `${header}${skeletonCss()}`);
console.log('tokens: wrote dist/helpwell.css and dist/skeleton.css');
