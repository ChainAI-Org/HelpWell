/**
 * @helpwell/helpcenter — the public documentation site.
 *
 * Mount it next to the API:
 *
 *   const help = createHelpCenter({ db, basePath: '/help' });
 *   export const GET = help;
 */

// Re-exported so a host app building a custom page has one import to reach
// for rather than needing to know about @helpwell/ui.
export {
  escapeHtml,
  type Heading,
  html,
  icon,
  join,
  markdownBlockStyles,
  RawHtml,
  type Renderable,
  type RenderedMarkdown,
  raw,
  renderMarkdown,
  safeHref,
  slugify,
  slugPath,
  VIDEO_EMBED_ORIGINS,
} from '@helpwell/ui';
export {
  agentAvatar,
  type HeroStyle,
  type NavKey,
  type PageMeta,
  publicBase,
  renderPage,
  type SiteContext,
  siteLink,
  type ThemeChoice,
} from './layout.js';

export {
  type ArticleView,
  articlePage,
  articleStructuredData,
  formatDate,
  type RelatedArticle,
} from './pages/article.js';
export {
  type ChangelogEntryView,
  changelogEntryPage,
  changelogPage,
  changelogRss,
  escapeXml,
  type RoadmapCardView,
  type RoadmapView,
  roadmapPage,
} from './pages/changelog.js';
export {
  type ArticleCard,
  type CollectionCard,
  collectionPage,
  homePage,
  searchPage,
} from './pages/home.js';
export { DEFAULT_REDIRECTS_FILE, type RedirectRule, type RedirectsOption } from './redirects.js';
export {
  createHelpCenter,
  DEFAULT_CONTENT_SECURITY_POLICY,
  domainBase,
  type HelpCenterConfig,
  type HelpCenterHandler,
} from './server.js';
export { type HelpCenterStyleOptions, helpCenterStyles } from './styles.js';
