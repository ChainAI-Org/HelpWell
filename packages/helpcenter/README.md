# @helpwell/helpcenter

The public HelpWell help center: articles, search, changelog and roadmap, rendered on the server so every page is a URL and works without JavaScript.

```ts
import { createHelpCenter } from '@helpwell/helpcenter';
export const help = createHelpCenter({ db, basePath: '/help' });
```

Part of [HelpWell](https://github.com/ChainAI-Org/helpwell), the Autonomous Help Desk: an open-source AI agent that answers customers from a knowledge base it writes and keeps current itself. The full documentation, screenshots and getting-started guide live in the [main README](https://github.com/ChainAI-Org/helpwell#readme).

## Licence

HelpWell is made by Workado, LLC. Licensed under [AGPL-3.0-only](./LICENSE).
