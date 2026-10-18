/**
 * The bundle the loader fetches.
 *
 * Self-booting: `boot` drains whatever the loader queued, mounts the widget,
 * replaces the queue-shim with a real dispatcher so later calls to
 * `helpwell(...)` run immediately, and swallows anything that goes wrong.
 */

import { boot } from './index.js';

void boot(window.helpwell);
