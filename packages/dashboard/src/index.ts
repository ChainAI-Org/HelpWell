/**
 * @helpwell/dashboard — the admin UI.
 *
 * Mount it next to the API and give it your own admin check:
 *
 *   const dashboard = createDashboard({
 *     db,
 *     basePath: '/admin/helpwell',
 *     isAdmin: (request) => session(request)?.role === 'admin',
 *   });
 */

export {
  avatar,
  barChart,
  button,
  card,
  type DateOptions,
  empty,
  field,
  formatDate,
  formatDateTime,
  money,
  notice,
  percent,
  person,
  pill,
  rankedBars,
  relativeTime,
  searchBox,
  segment,
  select,
  stat,
  statusPill,
  textArea,
  textInput,
  toggle,
  underCard,
} from './components.js';
export { CONFIG_ONLY, type ConfigOnlyEntry } from './config-only.js';
export type { ContentMode } from './content-mode.js';
// Running imports as the host's own jobs.
export type {
  ImportJobContext,
  ImportJobEvent,
  ImportJobRequest,
  ImportJobs,
  ImportProgress,
  ImportSummary,
} from './import-jobs.js';
export {
  type DashboardAccess,
  type DashboardContext,
  type NavKey,
  type PageHeader,
  renderBare,
  renderDashboard,
} from './layout.js';
export { type RunImportJobOptions, runImportJob } from './pages/import.js';
export { SETTINGS_TABS, type SettingsTab, WEBHOOK_EVENTS } from './pages/settings.js';
export { bucketSeries, type ChartPoint, MONTHLY_ABOVE, WEEKLY_ABOVE } from './series.js';
export { createDashboard, type DashboardConfig, type DashboardHandler } from './server.js';
export { dashboardStyles } from './styles.js';
