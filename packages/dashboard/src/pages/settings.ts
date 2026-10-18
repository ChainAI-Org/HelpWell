/**
 * Settings.
 *
 * Everything is saved the moment it changes, because a settings screen with a
 * Save button people forget to press is worse than one without. Each control
 * carries a `data-patch` path and the island in the shell PATCHes it.
 *
 * There is no guardrails screen. The agent's rules live in the instructions,
 * which is the system prompt, with sensible defaults already written in, and
 * they are edited on the Playbook page — having two places to say "do not
 * make things up" means one of them is wrong. Nor is there a confidence
 * threshold or an escalation rule: the confidence score is internal, and
 * shown read-only in the conversation review.
 *
 * Every setting in the schema is either a control here (or on Connections or
 * Engage) or listed in `CONFIG_ONLY` with its reason, and shown as "Set in
 * helpwell.config / environment" on the tab it belongs to. The settings
 * coverage test holds that line. Secrets are never edited here: a secret shows
 * whether it is set and the environment variable it comes from.
 */

import {
  WEBHOOK_EVENTS as CORE_WEBHOOK_EVENTS,
  githubTokenPromptSpec,
  turnstilePromptSpec,
  widgetCspPromptSpec,
} from '@helpwell/core';
import type { HomeBlock, Settings } from '@helpwell/core/settings';
import { widgetMark } from '@helpwell/tokens';
import { html, icon, join, type RawHtml, raw, safeHref } from '@helpwell/ui';
import { clientScript } from '../client/index.js';
import {
  button,
  card,
  field,
  foldedCard,
  formatDateTime,
  jsonSelect,
  notice,
  pill,
  relativeTime,
  secretRow,
  segment,
  select,
  settingsGroup,
  subCard,
  textArea,
  textInput,
  toggle,
} from '../components.js';
import { configOnlyCard } from '../config-only.js';
import { byMode, managedContent } from '../content-mode.js';
import { type DashboardContext, pageAllowed } from '../layout.js';
import { modelField, modelPickerAssets } from '../model-picker.js';
import { setupPromptPanel } from '../setup-prompt.js';
import type { WebhookDeliveryRow } from './webhooks.js';

export type { WebhookDeliveryRow } from './webhooks.js';

export type SettingsTab = 'general' | 'agent' | 'widget' | 'knowledge' | 'changelog' | 'data';

export const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'agent', label: 'AI agent' },
  { key: 'widget', label: 'Widget' },
  { key: 'knowledge', label: 'Help center' },
  { key: 'changelog', label: 'Changelog' },
  { key: 'data', label: 'Data' },
];

/** What a webhook can subscribe to: core's own list, so the two cannot drift. */
export const WEBHOOK_EVENTS = CORE_WEBHOOK_EVENTS;

export const TURNSTILE_SECRET_ENV = 'HELPWELL_TURNSTILE_SECRET';

/** Which secrets are set. Only ever yes or no: the dashboard never sees a value. */
export interface SecretStatus {
  openRouter: boolean;
  identity: boolean;
  turnstile: boolean;
  adminToken: boolean;
  databaseUrl: boolean;
}

export function settingsPage(
  context: DashboardContext,
  settings: Settings,
  tab: SettingsTab,
  secrets: SecretStatus,
): RawHtml {
  const base = `${context.basePath}/settings`;

  return html`
<div class="db-toolbar">
  ${segment(
    SETTINGS_TABS.map((option) => ({
      label: option.label,
      href: `${base}?tab=${option.key}`,
      current: tab === option.key,
    })),
  )}
</div>

${tabBody(context, settings, tab, secrets)}
${configOnlyCard(tab, context)}`;
}

function tabBody(
  context: DashboardContext,
  settings: Settings,
  tab: SettingsTab,
  secrets: SecretStatus,
): RawHtml {
  switch (tab) {
    case 'general':
      return generalTab(settings);
    case 'agent':
      return agentTab(context, settings, secrets);
    case 'widget':
      return widgetTab(context, settings);
    case 'knowledge':
      return knowledgeTab(settings);
    case 'changelog':
      return changelogTab(context, settings);
    case 'data':
      return dataTab(settings);
  }
}

/* -------------------------------------------------------------- general */

function generalTab(settings: Settings): RawHtml {
  return card(
    'Your product',
    'Used in the widget header, page titles and the way the agent talks about you.',
    field(
      'Product name',
      textInput('name', settings.product.name, { patch: 'product.name' }),
      'Shown to customers.',
    ),
    field(
      'App URL',
      textInput('appUrl', settings.product.appUrl, {
        patch: 'product.appUrl',
        placeholder: 'https://app.example.com',
      }),
      'Where "Back to the app" links go, and what a page path the widget reports is resolved against.',
    ),
    field(
      'Support email',
      textInput('supportEmail', settings.product.supportEmail, {
        patch: 'product.supportEmail',
        type: 'email',
      }),
      'Where people can write when the agent cannot help. The widget shows it under an answer the agent could not give and on its Home tab; the help center shows "Contact support" in its footer and when someone says an article did not help. It is a mailto link: people write from their own mail client and you reply from yours, because HelpWell sends no email at all. Leave it empty to show none.',
    ),
    html`<div class="db-grid db-grid--2">
      ${field(
        'Timezone',
        textInput('timezone', settings.product.timezone, {
          patch: 'product.timezone',
          placeholder: 'Europe/London',
        }),
        'Dates in the dashboard and the help center are shown in this zone.',
      )}
      ${field(
        'Locale',
        textInput('locale', settings.product.locale, {
          patch: 'product.locale',
          placeholder: 'en-GB',
        }),
        'Sets the page language and how dates are written.',
      )}
    </div>`,
  );
}

/* ---------------------------------------------------------------- agent */

/**
 * What each tool does, from what `agent/tools.ts` actually does with it.
 * Before this the copy promised things no tool did ("propose the doc that
 * should exist"), so it is written from the code, not from the idea.
 */
export const TOOL_COPY: Record<keyof Settings['agent']['tools'], { title: string; hint: string }> =
  {
    searchDocs: {
      title: 'Search the docs again',
      hint: 'Lets the agent run its own follow-up searches of your published articles, optionally inside one collection, while it writes an answer. Every answer already starts from a search of the question, so switching this off only stops the extra searches.',
    },
    readChangelog: {
      title: 'Read the changelog',
      hint: 'Reads your latest published changelog entries (version, title, summary and date, up to 20) to answer "what changed" or "has this shipped". Drafts are never read.',
    },
    lookUpUser: {
      title: 'Look up the person',
      hint: "Reads the signed-in person's record: name, email, the attributes your app sent with identify(), and when they were first seen. Read-only, and empty for anonymous visitors.",
    },
    collectEmail: {
      title: 'Ask for an email address',
      hint: 'Shows an anonymous visitor an email field in the chat. Never offered to signed-in people. The address is saved on their contact; HelpWell sends nothing to it.',
    },
    markUnresolved: {
      title: 'Flag what the docs do not cover',
      hint: 'Lets the agent flag a question it could not answer from your docs: the conversation is marked unresolved, the question goes on the Gaps list, and a conversation.unresolved webhook is sent. Switched off, HelpWell still does this when an answer is not backed by the docs.',
    },
    suggestArticle: {
      title: 'Attach an article',
      hint: 'Attaches one of your published articles to the answer as a card, by its exact slug. It cannot invent one: an unknown slug is refused.',
    },
  };

/**
 * How the agent's avatar will look: the image when one is set, otherwise the
 * HelpWell mark on its own, never inside a circle.
 */
function agentAvatarPreview(url: string | null): RawHtml {
  const src = url?.trim() ? safeHref(url) : '';
  return html`<span class="db-avatarfield__preview" aria-hidden="true">${
    src && src !== '#'
      ? html`<img src="${raw(src)}" alt="" width="44" height="44">`
      : raw(widgetMark('var(--hw-accent)').replace('role="img" aria-label="Open support"', ''))
  }</span>`;
}

function agentTab(context: DashboardContext, settings: Settings, secrets: SecretStatus): RawHtml {
  const agent = settings.agent;
  const botActive =
    agent.abuse.botCheck === 'turnstile' &&
    agent.abuse.turnstileSiteKey.trim().length > 0 &&
    secrets.turnstile;

  return html`
${card(
  'Who is answering',
  'The name and tone go into the instructions wherever they say {{agent}} and {{tone}}. The name and avatar are shown beside every answer in the widget, and on the help center.',
  html`<div class="db-grid db-grid--2">
    ${field('Name', textInput('agentName', agent.name, { patch: 'agent.name', placeholder: 'Fern' }))}
    ${field('Tone', textInput('tone', agent.tone, { patch: 'agent.tone' }), 'One line, e.g. "Warm, brief, no exclamation marks".')}
  </div>
  <div class="db-avatarfield">
    ${agentAvatarPreview(agent.avatarUrl)}
    ${field(
      'Avatar image URL',
      textInput('avatarUrl', agent.avatarUrl ?? '', {
        patch: 'agent.avatarUrl',
        placeholder: 'https://example.com/avatar.png',
      }),
      'A square https image. Leave empty for the HelpWell mark.',
    )}
  </div>`,
  toggle(
    'Say it is an AI when asked',
    'Adds a line to the prompt: if someone asks, the agent says it is an AI assistant and never pretends to be a person.',
    agent.introduceAsAi,
    'agent.introduceAsAi',
  ),
)}

${card(
  'Instructions and playbook',
  byMode(
    context,
    'The system prompt and your house rules, as Markdown files in your repo.',
    'The system prompt and your house rules.',
  ),
  html`<p style="margin:0 0 12px">Edit them with a live preview on the Playbook page.</p>
  ${button('Open the playbook', { href: `${context.basePath}/playbook`, glyph: 'article' })}`,
)}

${card(
  'Models',
  "Your own OpenRouter key pays for these, and the list is OpenRouter's own, newest first. The fallback is used when the first one is unavailable. The embedding model lives on Connections.",
  html`<div class="db-grid db-grid--2">
    ${modelField(context, 'Answering', 'chat', agent.models.chat, {
      patch: 'agent.models.chat',
      kind: 'chat',
      keySet: secrets.openRouter,
    })}
    ${modelField(context, 'Fallback', 'fallback', agent.models.fallback, {
      patch: 'agent.models.fallback',
      kind: 'chat',
      keySet: secrets.openRouter,
    })}
    ${modelField(context, 'Writing docs and grading evals', 'docs', agent.models.docs, {
      patch: 'agent.models.docs',
      kind: 'chat',
      keySet: secrets.openRouter,
    })}
  </div>`,
  modelPickerAssets(context),
)}

${card(
  'What the agent can do',
  "Six tools the agent can call while it writes an answer. All six only read or write HelpWell's own records, never your app. A tool switched off is hidden from the model, and refused if it calls it anyway.",
  join(
    (Object.keys(TOOL_COPY) as (keyof typeof TOOL_COPY)[]).map((key) =>
      toggle(TOOL_COPY[key].title, TOOL_COPY[key].hint, agent.tools[key], `agent.tools.${key}`),
    ),
  ),
)}

${card(
  'Spend caps',
  'A hard stop, not a warning. Past the daily cap the agent answers from search alone rather than running up a bill.',
  html`<div class="db-grid db-grid--2">
    ${field(
      'Daily cap',
      textInput('dailyCapUsd', String(agent.spend.dailyCapUsd), {
        type: 'number',
        min: 0,
        step: 'any',
        patch: 'agent.spend.dailyCapUsd',
      }),
      'In US dollars. 0 means no cap.',
    )}
    ${field(
      'Warn at',
      textInput('warnAtPct', String(agent.spend.warnAtPct), {
        type: 'number',
        min: 1,
        max: 100,
        patch: 'agent.spend.warnAtPct',
      }),
      'Percent of the cap. Reports shows the warning.',
    )}
    ${field(
      'Messages per conversation',
      textInput('messagesPerConversation', String(agent.spend.messagesPerConversation), {
        type: 'number',
        min: 1,
        patch: 'agent.spend.messagesPerConversation',
      }),
    )}
    ${field(
      'Messages per visitor per hour',
      textInput('messagesPerVisitorPerHour', String(agent.spend.messagesPerVisitorPerHour), {
        type: 'number',
        min: 1,
        patch: 'agent.spend.messagesPerVisitorPerHour',
      }),
    )}
  </div>`,
)}

${card(
  'Abuse',
  'The widget is on a public page, so it needs a door policy. The honeypot and the origin check are always on.',
  toggle(
    'Signed-in visitors only',
    'Anonymous visitors can read the help center but not chat.',
    agent.abuse.signedInOnly,
    'agent.abuse.signedInOnly',
  ),
  toggle(
    'Block disposable email',
    'Refuse throwaway addresses when collecting one.',
    agent.abuse.blockDisposableEmail,
    'agent.abuse.blockDisposableEmail',
  ),
  toggle(
    'Refuse repeated messages',
    'The same message a third time in a row is refused with a request to rephrase it, before it reaches the model.',
    agent.abuse.throttleRepeats,
    'agent.abuse.throttleRepeats',
  ),
  field(
    'Blocked email domains',
    textInput('blockedDomains', agent.abuse.blockedDomains.join(', '), {
      patch: 'agent.abuse.blockedDomains',
      patchType: 'list',
      placeholder: 'spam.example, throwaway.test',
    }),
    'Comma separated.',
  ),
  field(
    'Blocked IP addresses',
    textArea('blockedIps', agent.abuse.blockedIps.join('\n'), {
      rows: 3,
      patch: 'agent.abuse.blockedIps',
      patchType: 'list',
      placeholder: '203.0.113.7\n198.51.100.0/24',
    }),
    'One per line, or comma separated. Exact addresses, dotted prefixes or IPv4 ranges such as 198.51.100.0/24; IPv6 exact only.',
  ),
  field(
    'Longest message',
    textInput('maxMessageLength', String(agent.spend.maxMessageLength), {
      type: 'number',
      min: 1,
      patch: 'agent.spend.maxMessageLength',
    }),
    'Characters. Anything longer is refused before it reaches the model.',
  ),
)}

${card(
  'Bot check',
  "Cloudflare Turnstile, run by the widget before a conversation's first message. It needs a site key here and a secret key in the server's environment.",
  html`<div class="db-grid db-grid--2">
    ${field(
      'Check visitors',
      select(
        'botCheck',
        agent.abuse.botCheck,
        [
          { value: 'off', label: 'Off' },
          { value: 'turnstile', label: 'Cloudflare Turnstile' },
        ],
        { patch: 'agent.abuse.botCheck' },
      ),
    )}
    ${field(
      'Turnstile site key',
      textInput('turnstileSiteKey', agent.abuse.turnstileSiteKey, {
        patch: 'agent.abuse.turnstileSiteKey',
        placeholder: '0x4AAAAAAA…',
      }),
      'The public one. The widget shows it to every visitor.',
    )}
  </div>`,
  secretRow(
    'Turnstile secret key',
    TURNSTILE_SECRET_ENV,
    secrets.turnstile,
    'Set it in the environment where the API runs, or pass it in code. Never here.',
  ),
  html`<p class="db-field__hint" style="margin-top:10px" data-check="botcheck">${
    agent.abuse.botCheck === 'off'
      ? 'Off: no challenge is shown.'
      : botActive
        ? 'On: new conversations need a passed challenge.'
        : 'Asked for, but not running until both the site key and the secret are set.'
  }</p>`,
  setupPromptPanel(
    'turnstile',
    turnstilePromptSpec({ productName: settings.product.name, apiPath: context.apiPath }),
  ),
)}
${widgetChecks(context)}`;
}

/**
 * What the API itself says about the widget's outside dependencies
 * (`GET /admin/widget/checks`): whether the Turnstile secret is set, and
 * where from, including one passed in code, which the dashboard cannot see;
 * and whether the status page answers. The page renders its own best guess
 * from the environment first, so without JavaScript nothing is missing. The
 * code is client/settings.ts, served as a file.
 */
function widgetChecks(context: DashboardContext): RawHtml {
  return html`<span hidden data-widget-checks="${context.apiPath}/admin/widget/checks"></span>
${clientScript(context, 'widget-checks')}`;
}

/* --------------------------------------------------------------- widget */

function widgetTab(context: DashboardContext, settings: Settings): RawHtml {
  const widget = settings.widget;

  return html`
${settingsGroup(
  'wg-home',
  'Home screen',
  'What visitors see first when they open the widget. Changes show in the preview as you make them.',
  subCard(
    'Greeting',
    'The words at the top of Home, saved as you type. Leave a box empty to keep the standard words. Use {{ product.name }} for your product name and {{ contact.first_name }} for the visitor’s first name (“there” until your app says who is visiting). The older {product} and {first_name} still work.',
    html`<div class="db-grid db-grid--2">
      ${field(
        'Title',
        textInput('greetingTitle', widget.greeting.title, {
          patch: 'widget.greeting.title',
          placeholder: 'Hi there',
          maxLength: 80,
          live: true,
        }),
        'Standard: "Hi there", or "Hi Ada" when your app says who is visiting.',
      )}
      ${field(
        'Subtitle',
        textInput('greetingSubtitle', widget.greeting.subtitle, {
          patch: 'widget.greeting.subtitle',
          placeholder: 'How can we help with {{ product.name }}?',
          maxLength: 160,
          live: true,
        }),
        'Standard: "How can we help with your product?"',
      )}
    </div>`,
  ),
  subCard(
    'Tabs',
    'Turn off what you do not use. One tab left and the tab bar disappears entirely.',
    toggle(
      'Home',
      'Search, your open conversation, and what is new.',
      widget.tabs.home,
      'widget.tabs.home',
    ),
    toggle(
      'Messages',
      'Every conversation this visitor has had.',
      widget.tabs.messages,
      'widget.tabs.messages',
    ),
    toggle(
      'Help',
      'Browse the help center without leaving the page.',
      widget.tabs.help,
      'widget.tabs.help',
    ),
    toggle(
      'Updates',
      'Your changelog, with an unread dot.',
      widget.tabs.updates,
      'widget.tabs.updates',
    ),
    toggle('Roadmap', 'Vote and suggest.', widget.tabs.roadmap, 'widget.tabs.roadmap'),
  ),
  subCard(
    'Blocks',
    'What sits under the greeting, top to bottom. Move them, remove them, or add one. Saved as you go.',
    homeBlocksEditor(context, widget.home.blocks),
  ),
  subCard(
    'Status',
    'A line on the Home tab saying whether everything is working, so nobody asks what your status page already says.',
    html`<div class="db-grid db-grid--2">
    ${field(
      'Where it comes from',
      select(
        'statusMode',
        widget.status.mode,
        [
          { value: 'auto', label: 'My status page' },
          { value: 'manual', label: 'What I set here' },
        ],
        { patch: 'widget.status.mode' },
      ),
    )}
    ${field(
      'Status page URL',
      textInput('statusUrl', widget.statusUrl, {
        patch: 'widget.statusUrl',
        placeholder: 'https://status.example.com',
      }),
      'Atlassian Statuspage, Instatus or Better Stack. Also where the status line links to.',
    )}
    ${field(
      'Status, when set here',
      select(
        'statusLevel',
        widget.status.level,
        [
          { value: 'operational', label: 'All systems working' },
          { value: 'degraded', label: 'Degraded performance' },
          { value: 'partial_outage', label: 'Partial outage' },
          { value: 'major_outage', label: 'Major outage' },
          { value: 'maintenance', label: 'Maintenance' },
        ],
        { patch: 'widget.status.level' },
      ),
      'Used when the status comes from here.',
    )}
    ${field(
      'Message, when set here',
      textInput('statusMessage', widget.status.message, {
        patch: 'widget.status.message',
        maxLength: 280,
        placeholder: 'Exports are slow; we are on it.',
      }),
      'Up to 280 characters. Leave empty for the standard line for that status.',
    )}
  </div>`,
    html`<p class="db-field__hint" data-check="status" hidden></p>`,
  ),
  widgetChecks(context),
)}

${settingsGroup(
  'wg-launcher',
  'Launcher',
  'The button that opens the widget on your site. It is the HelpWell mark in your accent colour, unless you give it an image of your own.',
  card(
    null,
    null,
    html`<div class="db-grid db-grid--2">
    ${field(
      'Placement',
      select(
        'position',
        widget.position,
        [
          { value: 'bottom-right', label: 'Bottom right' },
          { value: 'bottom-left', label: 'Bottom left' },
          { value: 'draggable', label: 'Draggable' },
        ],
        { patch: 'widget.position' },
      ),
      'Draggable starts at the bottom right. Each visitor can drag it anywhere, and it stays where they put it.',
    )}

    ${field(
      'Launcher image URL',
      textInput('launcherIconUrl', widget.appearance.launcherIconUrl ?? '', {
        patch: 'widget.appearance.launcherIconUrl',
        placeholder: 'https://example.com/launcher.png',
      }),
      'An https image to use instead of the HelpWell mark. Leave empty for the mark.',
    )}
  </div>`,
  ),
)}

${settingsGroup(
  'wg-more',
  'Look and behavior',
  'How the panel looks, and when and for whom it shows.',
  subCard(
    'Look',
    'How the panel looks. Colours and the logo come from Branding.',
    html`<div class="db-grid db-grid--2">
    ${field('Accent', textInput('accent', widget.appearance.accent, { type: 'color', patch: 'widget.appearance.accent' }))}
    ${field(
      'Theme',
      select(
        'theme',
        widget.appearance.theme,
        [
          { value: 'system', label: 'Follow the visitor' },
          { value: 'light', label: 'Always light' },
          { value: 'dark', label: 'Always dark' },
        ],
        { patch: 'widget.appearance.theme' },
      ),
    )}
    ${field(
      'Font',
      select('font', widget.appearance.font, fontChoices(widget.appearance.font), {
        patch: 'widget.appearance.font',
      }),
    )}
    ${field(
      'Bubble shape',
      select(
        'bubbleStyle',
        widget.appearance.bubbleStyle,
        [
          { value: 'rounded', label: 'Rounded' },
          { value: 'soft', label: 'Soft' },
          { value: 'square', label: 'Square' },
        ],
        { patch: 'widget.appearance.bubbleStyle' },
      ),
    )}
    ${field(
      'Header pattern',
      select(
        'pattern',
        widget.appearance.pattern,
        [
          { value: 'none', label: 'None' },
          { value: 'waves', label: 'Waves' },
          { value: 'dots', label: 'Dots' },
          { value: 'grid', label: 'Grid' },
          { value: 'diagonal', label: 'Diagonal' },
          { value: 'noise', label: 'Noise' },
          { value: 'confetti', label: 'Confetti' },
          { value: 'image', label: 'An image' },
        ],
        { patch: 'widget.appearance.pattern' },
      ),
    )}
    ${field(
      'Pattern image URL',
      textInput('patternImageUrl', widget.appearance.patternImageUrl ?? '', {
        patch: 'widget.appearance.patternImageUrl',
        placeholder: 'https://example.com/header.png',
      }),
      'Used when the header pattern is "An image".',
    )}
    ${field(
      'Corner radius',
      textInput('radius', String(widget.appearance.radius), {
        type: 'number',
        min: 0,
        max: 32,
        patch: 'widget.appearance.radius',
      }),
      'Pixels, 0 to 32.',
    )}
  </div>`,
  ),
  subCard(
    'Media',
    'YouTube, Vimeo, Loom and Wistia links in answers and articles.',
    toggle(
      'Play videos in the widget',
      "Off, a video shows as a card that opens the player. On, it plays in the panel, loading nothing from the provider until the visitor clicks. Your site's Content-Security-Policy then has to allow the players.",
      widget.media.inlineVideo,
      'widget.media.inlineVideo',
    ),
    setupPromptPanel(
      'widget-csp',
      widgetCspPromptSpec({
        productName: settings.product.name,
        apiPath: context.apiPath,
        inlineVideo: widget.media.inlineVideo,
        botCheck: settings.agent.abuse.botCheck === 'turnstile',
      }),
    ),
  ),
  subCard(
    'Where it shows',
    'Glob rules. `*` matches inside a path segment, `**` across them. Exclude wins over include, so a checkout page stays clean.',
    field(
      'Show on',
      textInput('include', widget.displayRules.include.join(', '), {
        patch: 'widget.displayRules.include',
        patchType: 'list',
        placeholder: '**',
      }),
      'Comma separated.',
    ),
    field(
      'Never show on',
      textInput('exclude', widget.displayRules.exclude.join(', '), {
        patch: 'widget.displayRules.exclude',
        patchType: 'list',
        placeholder: '/checkout/**, /login',
      }),
      'Comma separated.',
    ),
    html`<div class="db-grid db-grid--2">
    ${field(
      'Who sees it',
      select(
        'audience',
        widget.displayRules.audience,
        [
          { value: 'all', label: 'Everyone' },
          { value: 'identified', label: 'Signed-in people only' },
          { value: 'anonymous', label: 'Anonymous visitors only' },
        ],
        { patch: 'widget.displayRules.audience' },
      ),
    )}
    ${field(
      'On which devices',
      jsonSelect(
        'devices',
        widget.displayRules.devices,
        [
          { value: ['desktop', 'mobile'], label: 'Desktop and mobile' },
          { value: ['desktop'], label: 'Desktop only' },
          { value: ['mobile'], label: 'Mobile only' },
        ],
        'widget.displayRules.devices',
      ),
    )}
  </div>`,
  ),
  subCard(
    'Before a chat starts',
    'A catch-all for visitors your app could not identify. Call identify() and nobody ever sees this.',
    html`<div class="db-grid db-grid--2">
    ${field(
      'Ask for details',
      select(
        'when',
        widget.preChat.when,
        [
          { value: 'never', label: 'Never' },
          { value: 'unknown_only', label: 'Only when we do not know who they are' },
        ],
        { patch: 'widget.preChat.when' },
      ),
    )}
    ${field(
      'When to ask',
      select(
        'timing',
        widget.preChat.timing,
        [
          { value: 'before', label: 'Before the first message' },
          { value: 'after', label: 'After the first answer, from the agent' },
        ],
        { patch: 'widget.preChat.timing' },
      ),
    )}
    ${field(
      'What to ask for',
      jsonSelect(
        'fields',
        widget.preChat.fields,
        [
          { value: ['email', 'name'], label: 'Email and name' },
          { value: ['email'], label: 'Email only' },
          { value: ['name'], label: 'Name only' },
        ],
        'widget.preChat.fields',
      ),
    )}
  </div>`,
    toggle(
      'Email is required',
      'Refuse to start without one.',
      widget.preChat.requireEmail,
      'widget.preChat.requireEmail',
    ),
    field(
      'Consent line',
      textInput('consentLine', widget.preChat.consentLine, { patch: 'widget.preChat.consentLine' }),
    ),
  ),
)}

${foldedCard(
  'wg-advanced',
  'Advanced placement',
  'Distance from the side and the bottom, and stacking order.',
  html`<div class="db-grid db-grid--2">
    ${field(
      'Distance from the side',
      textInput('offsetX', String(widget.offset.x), { type: 'number', patch: 'widget.offset.x' }),
      'Pixels.',
    )}
    ${field(
      'Distance from the bottom',
      textInput('offsetY', String(widget.offset.y), { type: 'number', patch: 'widget.offset.y' }),
      'Pixels. Raise it to clear a cookie bar or a chat bubble of your own.',
    )}
    ${field(
      'Stacking order',
      textInput('zIndex', String(widget.zIndex), { type: 'number', patch: 'widget.zIndex' }),
      'The CSS z-index. Lower it if the widget covers one of your own overlays.',
    )}
  </div>`,
)}`;
}

const FONTS = ['Plus Jakarta Sans', 'Inter', 'Geist', 'DM Sans', 'Manrope'];

/** The offered fonts, plus the saved one when a config file named another. */
function fontChoices(current: string): { value: string; label: string }[] {
  const names = FONTS.includes(current) || !current ? FONTS : [current, ...FONTS];
  return names.map((name) => ({ value: name, label: name }));
}

/* ------------------------------------------------------ home block editor */

const BLOCK_LABELS: Record<HomeBlock['type'], { label: string; hint: string }> = {
  search: { label: 'Search', hint: 'A search box for the help center.' },
  conversation: { label: 'Your conversation', hint: 'The open conversation, while there is one.' },
  newConversation: { label: 'Start a conversation', hint: 'The button that opens a new chat.' },
  articles: { label: 'Articles', hint: 'A short list of articles.' },
  updates: { label: "What's new", hint: 'Your latest changelog entries.' },
  status: { label: 'Status', hint: 'The status line, from the Status settings below.' },
  links: { label: 'Links', hint: 'A list of links of your own.' },
  card: { label: 'Card', hint: 'A title, some Markdown, an image and a button.' },
  form: { label: 'Form', hint: 'A form, drawn by whatever registered it with the widget.' },
};

/** A new block of each kind, with the schema's defaults filled in. */
const NEW_BLOCKS: Record<HomeBlock['type'], HomeBlock> = {
  search: { type: 'search' },
  conversation: { type: 'conversation' },
  newConversation: { type: 'newConversation' },
  articles: { type: 'articles', title: 'Popular articles', collection: '', slugs: [], limit: 5 },
  updates: { type: 'updates', title: "What's new", count: 3 },
  status: { type: 'status' },
  links: { type: 'links', title: '', items: [] },
  card: { type: 'card', title: '', body: '', image: '', cta: { label: '', url: '' } },
  form: { type: 'form', formId: '' },
};

/**
 * An ordered list editor for `widget.home.blocks`. The rows are plain markup;
 * a small script keeps a hidden input's JSON in step with them and fires a
 * change on it, which the island saves like any other control.
 */
function homeBlocksEditor(context: DashboardContext, blocks: HomeBlock[]): RawHtml {
  const id = 'db-home-blocks';
  return html`<div class="db-blocks" data-blocks="${id}">
  <input type="hidden" id="${id}" value="${JSON.stringify(blocks)}" data-patch="widget.home.blocks" data-patch-type="json">
  <ol class="db-blocks__list">${join(blocks.map((block) => blockRow(block)))}</ol>
  ${
    blocks.length === 0
      ? html`<p class="db-muted db-blocks__empty">No blocks: the Home tab shows only its header.</p>`
      : null
  }
  <div class="db-blocks__add">
    ${select(
      'newBlock',
      'articles',
      (Object.keys(BLOCK_LABELS) as HomeBlock['type'][]).map((type) => ({
        value: type,
        label: BLOCK_LABELS[type].label,
      })),
    )}
    <button type="button" class="db-btn" data-block-add>${raw(icon('plus', 15))}<span>Add block</span></button>
  </div>
  ${join(
    (Object.keys(NEW_BLOCKS) as HomeBlock['type'][]).map(
      (type) =>
        html`<template data-block-template="${type}">${blockRow(NEW_BLOCKS[type])}</template>`,
    ),
  )}
</div>
${homeBlocksScript(context)}`;
}

function blockRow(block: HomeBlock): RawHtml {
  const meta = BLOCK_LABELS[block.type];
  return html`<li class="db-blocks__row" data-block="${JSON.stringify(block)}">
  <div class="db-blocks__head">
    <span class="db-blocks__name">${meta.label}</span>
    <span class="db-blocks__hint">${meta.hint}</span>
    <span class="db-blocks__moves">
      <button type="button" class="db-iconbtn" data-block-move="up" aria-label="Move ${meta.label} up">${raw(icon('arrowUp', 14))}</button>
      <button type="button" class="db-iconbtn db-iconbtn--down" data-block-move="down" aria-label="Move ${meta.label} down">${raw(icon('arrowUp', 14))}</button>
      <button type="button" class="db-iconbtn" data-block-move="remove" aria-label="Remove ${meta.label}">${raw(icon('close', 14))}</button>
    </span>
  </div>
  ${blockFields(block)}
</li>`;
}

function blockField(label: string, key: string, value: string, kind = 'text'): RawHtml {
  return html`<label class="db-field"><span class="db-field__label">${label}</span><input class="db-input" data-field="${key}" data-kind="${kind}" value="${value}"${
    kind === 'number' ? raw(' type="number"') : null
  }></label>`;
}

function blockFields(block: HomeBlock): RawHtml | null {
  switch (block.type) {
    case 'articles':
      return html`<div class="db-grid db-grid--2">
        ${blockField('Title', 'title', block.title)}
        ${blockField('Collection', 'collection', block.collection)}
        ${blockField('Or these slugs', 'slugs', block.slugs.join(', '), 'list')}
        ${blockField('How many', 'limit', String(block.limit), 'number')}
      </div>`;
    case 'updates':
      return html`<div class="db-grid db-grid--2">
        ${blockField('Title', 'title', block.title)}
        ${blockField('How many', 'count', String(block.count), 'number')}
      </div>`;
    case 'links':
      return html`${blockField('Title', 'title', block.title)}
      <label class="db-field"><span class="db-field__label">Links, one per line: label | URL | icon</span><textarea class="db-textarea" rows="3" data-field="items" data-kind="links">${block.items
        .map((item) => [item.label, item.url, item.icon].filter(Boolean).join(' | '))
        .join('\n')}</textarea></label>`;
    case 'card':
      return html`<div class="db-grid db-grid--2">
        ${blockField('Title', 'title', block.title)}
        ${blockField('Image URL', 'image', block.image)}
        ${blockField('Button label', 'cta.label', block.cta.label)}
        ${blockField('Button URL', 'cta.url', block.cta.url)}
      </div>
      <label class="db-field"><span class="db-field__label">Body (Markdown)</span><textarea class="db-textarea" rows="3" data-field="body" data-kind="text">${block.body}</textarea></label>`;
    case 'form':
      return blockField('Form id', 'formId', block.formId);
    default:
      return null;
  }
}

/** The block list's behaviour: client/settings.ts, served as a file. */
function homeBlocksScript(context: DashboardContext): RawHtml {
  return clientScript(context, 'home-blocks');
}

/* ------------------------------------------------------------ knowledge */

function knowledgeTab(settings: Settings): RawHtml {
  const help = settings.helpCenter;

  return html`
${card(
  'Where it lives',
  'Served from a path on your own app, next to the API, or from a domain of its own.',
  html`<div class="db-grid db-grid--2">
    ${field(
      'Path',
      textInput('subpath', help.subpath, { patch: 'helpCenter.subpath', placeholder: '/help' }),
      'Where the help center is mounted when you do not pass a basePath yourself.',
    )}
    ${field(
      'Public address',
      textInput('domain', help.domain, {
        patch: 'helpCenter.domain',
        placeholder: 'help.example.com',
      }),
      'Where the public reaches it, such as help.example.com or example.com/help. Canonical links, the sitemap, the feed and llms.txt all use it. Empty: the address each request arrives on. Pointing the domain at your app is a job for your DNS.',
    )}
  </div>`,
)}

${card(
  'What it shows',
  null,
  toggle('Search', 'A search box on every page.', help.search, 'helpCenter.search'),
  toggle(
    'Ask the agent',
    'The widget on the help center itself.',
    help.askAgent,
    'helpCenter.askAgent',
  ),
  toggle(
    'Article ratings',
    'Helpful / not helpful at the end of each article.',
    help.ratings,
    'helpCenter.ratings',
  ),
  toggle(
    'Reading time',
    'An estimate at the top of each article.',
    help.readingTime,
    'helpCenter.readingTime',
  ),
  toggle(
    'Sitemap',
    'sitemap.xml, so search engines find your docs.',
    help.sitemap,
    'helpCenter.sitemap',
  ),
  toggle(
    'llms.txt',
    'A plain-text index so AI assistants cite your real docs.',
    help.llmsTxt,
    'helpCenter.llmsTxt',
  ),
  toggle(
    'Powered by HelpWell',
    'The credit line in the footer.',
    help.poweredBy,
    'helpCenter.poweredBy',
  ),
)}

${card(
  'Look',
  'Colours are hex. Plus Jakarta Sans and Bricolage Grotesque are served by the help center itself; any other font is used by name, so it has to be one the visitor has.',
  html`<div class="db-grid db-grid--2">
    ${field('Accent', textInput('hcAccent', help.theme.accent, { type: 'color', patch: 'helpCenter.theme.accent' }))}
    ${field(
      'Background',
      textInput('hcBg', help.theme.background, {
        type: 'color',
        patch: 'helpCenter.theme.background',
      }),
      'The page ground in light mode. Dark mode keeps the charcoal set.',
    )}
    ${field(
      'Hero',
      select(
        'hero',
        help.theme.hero,
        [
          { value: 'glow', label: 'Glow and search' },
          { value: 'flat', label: 'Flat' },
          { value: 'brand', label: 'Brand block' },
        ],
        { patch: 'helpCenter.theme.hero' },
      ),
      'The top of the home page: a soft glow of your accent, plain, or a solid block of it.',
    )}
    ${field(
      'Dark mode',
      select(
        'defaultTheme',
        help.theme.defaultTheme,
        [
          { value: 'system', label: "Follow the reader's system" },
          { value: 'light', label: 'Start light' },
          { value: 'dark', label: 'Start dark' },
        ],
        { patch: 'helpCenter.theme.defaultTheme' },
      ),
      'Readers can always switch; this is where they start.',
    )}
    ${field('Headline font', textInput('headlineFont', help.theme.headlineFont, { patch: 'helpCenter.theme.headlineFont' }), 'Titles and article headings.')}
    ${field('Body font', textInput('bodyFont', help.theme.bodyFont, { patch: 'helpCenter.theme.bodyFont' }))}
    ${field('Logo URL', textInput('logoUrl', help.theme.logoUrl ?? '', { patch: 'helpCenter.theme.logoUrl' }), 'Falls back to your product name.')}
    ${field('Dark mode logo URL', textInput('logoDarkUrl', help.theme.logoDarkUrl ?? '', { patch: 'helpCenter.theme.logoDarkUrl' }), 'Shown in dark mode. Empty: the logo above in both.')}
    ${field(
      'Favicon URL',
      textInput('faviconUrl', help.theme.faviconUrl ?? '', {
        patch: 'helpCenter.theme.faviconUrl',
        placeholder: 'https://example.com/favicon.png',
      }),
      'The icon in the browser tab. Empty: the browser default.',
    )}
  </div>`,
  toggle(
    'Under cards on collections',
    'Each collection card sits on a tinted strip with its article count and when it was last updated. Off, the count sits inside a plain card.',
    help.theme.underCards,
    'helpCenter.theme.underCards',
  ),
  field(
    'Tints',
    textInput('tints', help.theme.tints.join(', '), {
      patch: 'helpCenter.theme.tints',
      patchType: 'list',
      placeholder: 'lavender, peach, butter, mint',
    }),
    'The tints collection cards may use, in rotation order: any of lavender, peach, butter and mint. A collection keeps the tint its _meta.json chose when it is in this list, and takes the next one from it when not.',
  ),
)}`;
}

/* ------------------------------------------------------------ changelog */

/**
 * Where entries come from. With a repo, `helpwell changelog` drafts them
 * from what shipped, and Source and Repository say from where. With managed
 * content there is no command line to run it from, so entries are written
 * on the Changelog page and those two settings, which only steer the
 * command, are not offered.
 */
function changelogSource(context: DashboardContext, settings: Settings): RawHtml[] {
  const changelog = settings.changelog;
  if (managedContent(context)) {
    return [
      html`<p style="margin:0 0 12px">Write an entry on the Changelog page, then publish it when it is ready.</p>
      ${button('Open the changelog', { href: `${context.basePath}/changelog`, glyph: 'article' })}`,
    ];
  }
  return [
    field(
      'Source',
      select(
        'source',
        changelog.source ?? '',
        [
          // Saved as an empty value, which the schema reads as unset.
          { value: '', label: 'Detect it' },
          { value: 'github_releases', label: 'GitHub releases' },
          { value: 'tags', label: 'Git tags' },
          { value: 'commits', label: 'Commits since the last entry' },
          { value: 'manual', label: 'I write them myself' },
        ],
        { patch: 'changelog.source' },
      ),
      'Detect it: GitHub releases when Repository is set or the repo’s origin remote is on GitHub, and Git tags otherwise or until the first release is published, worked out each time helpwell changelog runs. GitHub releases: the notes on your latest release, read from the GitHub API. Git tags: the commits since the previous tag. Commits since the last entry: the commits since the newest published entry, or since the previous tag before anything is published. I write them myself: helpwell changelog drafts nothing.',
    ),
    field(
      'Repository',
      textInput('repo', changelog.repo, { patch: 'changelog.repo', placeholder: 'acme/app' }),
      'owner/name on GitHub, for GitHub releases. Left empty, the repo’s origin remote is used. helpwell changelog sends GITHUB_TOKEN from its environment when it is set; without one GitHub allows 60 requests an hour and cannot read a private repository.',
    ),
    // Detection may land on GitHub releases, so the token setup is offered then too.
    changelog.source === 'github_releases' || changelog.source === undefined
      ? setupPromptPanel(
          'github-token',
          githubTokenPromptSpec({
            productName: settings.product.name,
            repo: changelog.repo || undefined,
          }),
        )
      : html``,
  ];
}

function changelogTab(context: DashboardContext, settings: Settings): RawHtml {
  const changelog = settings.changelog;

  return html`
${card(
  'Where entries come from',
  byMode(
    context,
    'helpwell changelog drafts an entry from what you shipped, then you edit and publish it here.',
    'Entries are written and published here, in the dashboard.',
  ),
  ...changelogSource(context, settings),
  field(
    'Categories',
    textInput('categories', changelog.categories.join(', '), {
      patch: 'changelog.categories',
      patchType: 'list',
    }),
    'Comma separated. Used as tags on an entry.',
  ),
  field(
    'Group by',
    select(
      'groupBy',
      changelog.groupBy,
      [
        { value: 'version', label: 'Version' },
        { value: 'date', label: 'Month' },
      ],
      { patch: 'changelog.groupBy' },
    ),
    'On the public page, the widget’s Updates tab and the embedded feed: each entry led by its version, or entries under a heading for each month.',
  ),
)}

${card(
  'Where it appears',
  null,
  toggle(
    'Public page',
    'A /changelog page with an RSS feed.',
    changelog.publicPage,
    'changelog.publicPage',
  ),
  toggle(
    'Widget tab',
    'An Updates tab with an unread dot.',
    changelog.widgetTab,
    'changelog.widgetTab',
  ),
  field(
    'How people find out',
    select(
      'notification',
      changelog.notification,
      [
        { value: 'badge', label: 'A dot on the launcher' },
        { value: 'drawer', label: 'A drawer' },
        { value: 'modal', label: 'A modal' },
        { value: 'popup', label: 'A popup' },
        { value: 'embed', label: 'Embedded in your app' },
        { value: 'none', label: 'Nothing' },
      ],
      { patch: 'changelog.notification' },
    ),
    'The open source build never emails. Notifications are in-app only.',
  ),
  field(
    'Entries per page',
    textInput('pageSize', String(changelog.pageSize), {
      type: 'number',
      min: 1,
      max: 50,
      patch: 'changelog.pageSize',
    }),
    'The feed loads more as people scroll, so this stays small.',
  ),
)}

${card(
  'Roadmap',
  null,
  toggle(
    'Public roadmap',
    'Four lanes, with voting.',
    changelog.roadmap.enabled,
    'changelog.roadmap.enabled',
  ),
  field(
    'Who can suggest an idea',
    select(
      'whoCanSubmit',
      changelog.roadmap.whoCanSubmit,
      [
        { value: 'identified', label: 'Signed-in people only' },
        { value: 'anyone', label: 'Anyone' },
      ],
      { patch: 'changelog.roadmap.whoCanSubmit' },
    ),
  ),
)}`;
}

/* ------------------------------------------------------------------ data */

function dataTab(settings: Settings): RawHtml {
  return html`
${notice(
  'info',
  'HelpWell stores everything in your own database. Nothing is sent anywhere except to the model provider you configured.',
)}

${card(
  'Keeping things',
  null,
  field(
    'Delete conversations after',
    textInput('retentionMonths', String(settings.data.retentionMonths), {
      type: 'number',
      min: 0,
      patch: 'data.retentionMonths',
    }),
    'Months. 0 keeps them forever. Contacts are never deleted automatically — erase one from their page.',
  ),
)}

${card(
  'Housekeeping',
  'Applies the retention rule and clears expired rate counters. Safe to run whenever.',
  html`<form method="post" action="?tab=data">
    <input type="hidden" name="action" value="maintenance">
    ${button('Run housekeeping now', { glyph: 'refresh' })}
  </form>`,
)}`;
}

/* ----------------------------------------------------------- connections */

export function connectionsPage(
  context: DashboardContext,
  settings: Settings,
  status: {
    openRouterConfigured: boolean;
    repo: { name: string; articles: number; lastSync: Date | null } | null;
    deliveries?: WebhookDeliveryRow[];
    secrets?: SecretStatus;
  },
): RawHtml {
  const secrets: SecretStatus = status.secrets ?? {
    openRouter: status.openRouterConfigured,
    identity: false,
    turnstile: false,
    adminToken: false,
    databaseUrl: false,
  };
  return html`
${card(
  'OpenRouter',
  'The only thing HelpWell needs to answer a question. Your key, your account, your bill — set it as OPENROUTER_API_KEY where the app runs.',
  html`<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    ${
      status.openRouterConfigured
        ? pill('good', html`${raw(icon('check', 12))} Connected`)
        : pill('warn', html`${raw(icon('alert', 12))} Not set`)
    }
    <span class="db-muted">${
      status.openRouterConfigured
        ? `Answering with ${settings.agent.models.chat}`
        : 'Without a key the agent answers from search alone.'
    }</span>
  </div>
  <pre class="db-code">OPENROUTER_API_KEY=sk-or-...</pre>`,
)}

${card(
  'Embeddings',
  'Optional. With an embedding model, search also matches on meaning rather than only on words. Without it, full-text search still works.',
  modelField(context, 'Embedding model', 'embeddings', settings.agent.models.embeddings, {
    patch: 'agent.models.embeddings',
    kind: 'embeddings',
    keySet: secrets.openRouter,
    hint: 'Leave empty to switch semantic search off.',
    placeholder: 'openai/text-embedding-3-small',
  }),
  modelPickerAssets(context),
)}

${card(
  'Keys and secrets',
  'Read from the environment where HelpWell runs, or passed in code. The dashboard only ever says whether each one is set.',
  secretRow('Model key', 'OPENROUTER_API_KEY', secrets.openRouter, 'Needed for written answers.'),
  secretRow(
    'Identity signing secret',
    'HELPWELL_IDENTITY_SECRET',
    secrets.identity,
    'Needed to recognise signed-in people.',
  ),
  secretRow(
    'Turnstile secret key',
    TURNSTILE_SECRET_ENV,
    secrets.turnstile,
    'Only for the bot check.',
  ),
  secretRow(
    'Admin token',
    'HELPWELL_ADMIN_TOKEN',
    secrets.adminToken,
    'For scripts and CI that call the admin API, and a way into this dashboard when passed as adminToken.',
  ),
  secretRow(
    'Database URL',
    'HELPWELL_DATABASE_URL',
    secrets.databaseUrl,
    'Unset means the embedded database.',
  ),
)}

${card(
  byMode(context, 'Your repo', 'Articles'),
  byMode(
    context,
    'Articles are Markdown files you already own. HelpWell reads them; it never writes to your repo without you running a command.',
    'Articles are saved in the knowledge base, and indexed for search and the agent as they are saved.',
  ),
  status.repo
    ? html`<dl class="db-kv">
        ${managedContent(context) ? null : html`<dt>Docs folder</dt><dd>${status.repo.name}</dd>`}
        <dt>Articles indexed</dt><dd>${String(status.repo.articles)}</dd>
        <dt>Last indexed</dt><dd>${
          status.repo.lastSync ? formatDateTime(status.repo.lastSync, context) : 'never'
        }</dd>
      </dl>`
    : managedContent(context)
      ? html`<p class="db-muted">Nothing indexed yet. Write an article in the knowledge base.</p>`
      : html`<p class="db-muted">Nothing indexed yet. Run <code>helpwell sync</code>.</p>`,
)}

${webhooksCard(context, settings, status.deliveries ?? [])}

${card(
  'Install the widget',
  'One script tag, anywhere before the closing body tag. The Get set up page has the version for your framework, and a prompt for your AI assistant.',
  html`<pre class="db-code">&lt;script src="${context.apiPath}/assets/loader.js" defer&gt;&lt;/script&gt;</pre>
  <p style="margin:10px 0 0">${button('Get set up', { href: `${context.basePath}/home`, glyph: 'rocket' })}</p>`,
)}

${configOnlyCard('connections', context)}`;
}

/**
 * Webhooks, in brief: how many there are and how the last delivery went.
 * They have a page of their own (pages/webhooks.ts), where they are listed,
 * tested and, for managed content, added.
 */
function webhooksCard(
  context: DashboardContext,
  settings: Settings,
  deliveries: WebhookDeliveryRow[],
): RawHtml {
  const active = settings.webhooks.filter((hook) => hook.active && hook.url).length;
  const last = deliveries[0];
  return card(
    'Webhooks',
    'Send HelpWell events to your own systems. Each delivery is signed so you can check it came from here.',
    html`<dl class="db-kv">
      <dt>Webhooks</dt><dd>${
        settings.webhooks.length === 0
          ? 'none yet'
          : `${settings.webhooks.length} (${active} active)`
      }</dd>
      <dt>Last delivery</dt><dd>${
        last
          ? html`<code>${last.event}</code>, ${last.status}, ${relativeTime(last.createdAt, context)}`
          : 'none yet'
      }</dd>
    </dl>
    ${
      pageAllowed(context, 'webhooks')
        ? html`<p style="margin:12px 0 0">${button('Webhooks', { href: `${context.basePath}/webhooks`, glyph: 'zap' })}</p>`
        : null
    }`,
  );
}
