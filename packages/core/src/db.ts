/** Database entry point: `import { createDb, migrate } from '@helpwell/core/db'`. */

export {
  type CreateDbOptions,
  createDb,
  type Db,
  type DbHandle,
  defaultDatabaseUrl,
  findProjectRoot,
  schemaExists,
} from './db/client.js';
export {
  dropAll,
  loadMigrations,
  type MigrateResult,
  type Migration,
  migrate,
} from './db/migrate.js';
export { firstRow, rowsOf } from './db/rows.js';
export type {
  ArticleRow,
  ArticleVersionRow,
  ChangelogEntry,
  Citation,
  Contact,
  Conversation,
  EvalCaseResult,
  EvalCaseSpec,
  EvalCheck,
  EvalRun,
  Gap,
  Heading,
  Message,
  MessageSource,
  NewContact,
  RoadmapItem,
  RoadmapStatus,
  ToolCall,
} from './db/schema.js';
export * as schema from './db/schema.js';
export { splitSql } from './db/split-sql.js';
