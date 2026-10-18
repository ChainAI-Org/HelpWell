#!/usr/bin/env node
/**
 * The `helpwell` executable.
 *
 * Everything real lives in `run.ts`; this file only exists to turn a result
 * into an exit code and to make sure nothing is left hanging.
 */

import { run } from './run.js';

const result = await run(process.argv.slice(2));
process.exitCode = result.exitCode;
