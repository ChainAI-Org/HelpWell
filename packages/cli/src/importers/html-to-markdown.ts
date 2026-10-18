/**
 * HTML to Markdown, for articles imported from another help desk. The
 * converter lives in core (`@helpwell/core/import`), where the dashboard's
 * importer uses it too; this keeps the CLI's own names for it.
 */

export {
  decodeEntities,
  htmlTitle,
  htmlToMarkdown,
  mainContent,
  parseHtml,
} from '@helpwell/core/import';
