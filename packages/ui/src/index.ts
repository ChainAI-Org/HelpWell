/**
 * @helpwell/ui — the server-rendered building blocks.
 *
 * Shared by the help centre and the dashboard so the two cannot drift apart on
 * escaping rules, Markdown handling, paths or icon style.
 */

export {
  type FontFaceOptions,
  fontFaceCss,
  WEB_FONT_FILES,
  type WebFontFamily,
  type WebFontFile,
  webFontFamily,
  webFontFiles,
} from './fonts.js';
export { escapeHtml, html, join, RawHtml, type Renderable, raw, safeHref } from './html.js';
export { hasIcon, type IconName, icon, iconOr } from './icons.js';
export { IMAGE_EDITOR_STYLES, imageEditorClientScript, openImageEditor } from './image-editor.js';
export {
  decodeEntities,
  type Heading,
  type MarkdownOptions,
  type MarkdownSurface,
  type RenderedMarkdown,
  renderMarkdown,
  slugify,
  VIDEO_EMBED_ORIGINS,
  type VideoEmbed,
  videoEmbed,
  withoutRepeatedTitle,
} from './markdown.js';
export { markdownBlockStyles } from './markdown-styles.js';
export {
  decodeSegments,
  fillPathTemplate,
  link,
  mountPath,
  slugPath,
  stripMountPath,
} from './paths.js';
export { SKELETON_CSS } from './skeleton.js';
export { baseStyles, MONO_STACK, safeCssColor, safeFontFamily } from './styles.js';
