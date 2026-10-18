# @helpwell/core

The HelpWell engine: the Postgres schema and migrations, hybrid search, the support agent, and the HTTP API as a single `(Request) => Response` handler.

```ts
import { createHelpWellHandler } from '@helpwell/core';
import { createDb, migrate } from '@helpwell/core/db';

const { db } = await createDb({});
await migrate(db);
export const api = createHelpWellHandler({ db, basePath: '/api/helpwell' });
```

Human support plugs in through a support extension: pass one as `support`, or set `HELPWELL_SUPPORT_URL`, `HELPWELL_SUPPORT_PRODUCT` and `HELPWELL_SUPPORT_TOKEN` to connect a remote one over HTTPS. Either way it fails open, so the AI keeps answering whatever the extension does. See [docs/support-extension.md](https://github.com/ChainAI-Org/helpwell/blob/main/docs/support-extension.md).

Part of [HelpWell](https://github.com/ChainAI-Org/helpwell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/helpwell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
