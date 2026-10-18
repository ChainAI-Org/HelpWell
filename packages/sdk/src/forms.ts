/**
 * `client.admin.forms`: email capture forms and giveaways, from a script.
 *
 *   const forms = await helpwell.admin.forms();                 // every form, with 30-day stats
 *   const form = await helpwell.admin.forms.create({ template: 'newsletter' });
 *   await helpwell.admin.forms.update(form.id, { enabled: true });
 *   const csv = await helpwell.admin.forms.submissionsCsv(form.id, { status: 'trusted' });
 *
 * A form's definition is the same JSON the dashboard's builder saves and
 * `export` writes, so a form can live in a repo and be imported on deploy.
 * The shapes restate core's with every `Date` as the ISO string the wire
 * carries (test/forms.test.ts pins them); definitions, verdicts and the
 * analytics hold no dates, so they are core's own types.
 */

import type {
  FormAnalytics,
  FormDefinition,
  FormPlacement,
  FormType,
  FormVerdict,
  GiveawayStats,
  RejectReason,
} from '@helpwell/core/repos';
import type { QueryInput, Transport } from './http.js';

export type {
  EntryState,
  FormAnalytics,
  FormDefinition,
  FormPlacement,
  FormSubmissionEvent,
  FormType,
  FormVerdict,
  GiveawayStats,
  RejectReason,
} from '@helpwell/core/repos';

/* ------------------------------------------------------------------ shapes */

/** A form: its row and its current definition. */
export interface Form {
  /** Stable, and in the embed code: `<div data-helpwell-form="newsletter">`. */
  id: string;
  name: string;
  type: FormType;
  enabled: boolean;
  version: number;
  definition: FormDefinition;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** A row of the forms list, with its headline numbers for the range asked for. */
export interface FormListItem {
  id: string;
  name: string;
  type: FormType;
  enabled: boolean;
  version: number;
  placements: FormDefinition['placements'];
  /** How many A/B variants it has; 0 is just the one form. */
  variants: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  stats: { views: number; uniques: number; trusted: number; conversionRate: number | null };
}

export interface FormTemplateSummary {
  key: FormType;
  title: string;
  description: string;
  /** The name and id a form made from it starts with; the id is made unique. */
  name: string;
  id: string;
}

export interface FormVersionSummary {
  version: number;
  note: string | null;
  createdAt: string;
}

export interface FormVersion extends FormVersionSummary {
  definition: FormDefinition;
}

/** What `export` writes and `import` reads. */
export interface FormExport {
  helpwell: 'form';
  formatVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  definition: FormDefinition;
}

/** One submission, with the verdict that decided whether it is trusted. */
export interface FormSubmission {
  id: string;
  formId: string;
  formVersion: number;
  variant: string;
  placement: string;
  status: 'accepted' | 'rejected' | 'duplicate';
  /** Accepted, and not from a disposable address: what reaches the hook, and what conversion counts. */
  trusted: boolean;
  reasons: RejectReason[];
  verdict: FormVerdict | Record<string, never>;
  contactId: string | null;
  email: string | null;
  name: string | null;
  fields: Record<string, unknown>;
  consent: 'granted' | 'denied' | 'none';
  consentText: string | null;
  pageUrl: string | null;
  pagePath: string | null;
  referrer: string | null;
  utm: Record<string, string>;
  createdAt: string;
}

export interface FormSubmissionPage {
  items: FormSubmission[];
  nextCursor: string | null;
}

export interface GiveawayEntry {
  id: string;
  formId: string;
  submissionId: string;
  contactId: string | null;
  email: string;
  referralCode: string;
  /** The entry whose link brought this one in. */
  referredBy: string | null;
  trusted: boolean;
  disqualified: boolean;
  bonusReferrals: number;
  bonusActions: number;
  /** What a draw weighs: 1, plus referral and action bonuses, up to the form's maximum. */
  entries: number;
  actions: string[];
  createdAt: string;
}

export interface GiveawayWinner {
  id: string;
  drawId: string;
  entryId: string;
  email: string;
  contactId: string | null;
  entries: number;
  position: number;
  /** With the snapshot hash, enough to re-run the draw and get the same winners. */
  seed: string;
  snapshotHash: string;
  snapshotSize: number;
  totalWeight: number;
  status: 'selected' | 'redrawn';
  reason: string | null;
  replacedBy: string | null;
  replaces: string | null;
  createdAt: string;
  redrawnAt: string | null;
}

export interface GiveawayDraw {
  drawId: string;
  seed: string;
  snapshotHash: string;
  snapshotSize: number;
  totalWeight: number;
  winners: GiveawayWinner[];
}

export interface GiveawayOverview {
  stats: GiveawayStats;
  /** Newest first, each with how many people it referred. */
  entries: (GiveawayEntry & { referrals: number })[];
  winners: GiveawayWinner[];
}

/**
 * What `window.helpwell.forms.on('submit', cb)` hands the page. `received`
 * is a submission refused without saying so (a bot): treat it as nothing.
 */
export interface FormSubmitEvent {
  formId: string;
  submissionId: string;
  placement: FormPlacement;
  variant: string;
  status: 'accepted' | 'duplicate' | 'received';
  email: string;
  fields: Record<string, unknown>;
}

/** Copy-paste prompts for an AI coding assistant, already formatted. */
export interface FormPrompts {
  /** The inline embed, per platform: `html`, `nextjs`, `wordpress`. */
  embed: Partial<Record<'html' | 'nextjs' | 'wordpress', string>>;
  /** A button on your own page that opens the form as a popup. */
  button: string;
}

/* ----------------------------------------------------------------- options */

export type FormRange = '7d' | '30d' | '90d';

export interface ListFormsOptions {
  /** The window the stats cover. 30 days by default. */
  range?: FormRange;
  type?: FormType;
  /** Include archived forms. */
  archived?: boolean;
}

export interface CreateFormInput {
  /** Start from a template (`newsletter`, `giveaway`, … or `custom`). */
  template?: string;
  id?: string;
  name?: string;
  /** Anything given here is laid over the template. */
  definition?: Partial<FormDefinition> | Record<string, unknown>;
  /** Off by default, so a new form shows nowhere until you switch it on. */
  enabled?: boolean;
}

export interface UpdateFormInput {
  /** A whole definition: saved as a new version. */
  definition?: FormDefinition | Record<string, unknown>;
  name?: string;
  enabled?: boolean;
  archived?: boolean;
  /** Refuse the save (409) if someone saved a newer version first. */
  expectedVersion?: number;
  /** Kept in the version history. */
  note?: string;
}

export interface FormAnalyticsOptions {
  range?: FormRange;
  /** ISO dates; `from` wins over `range`. */
  from?: string;
  to?: string;
}

export interface ListFormSubmissionsOptions {
  /** `trusted` and `untrusted` are accepted submissions either way. */
  status?: 'accepted' | 'rejected' | 'duplicate' | 'trusted' | 'untrusted';
  /** Part of an email or a name. */
  q?: string;
  variant?: string;
  placement?: FormPlacement | string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/* --------------------------------------------------------------------- api */

export interface FormsApi {
  /** Every form, newest first, with its stats. Same as `list`. */
  (options?: ListFormsOptions): Promise<FormListItem[]>;
  list(options?: ListFormsOptions): Promise<FormListItem[]>;
  /** The starting points `create({ template })` takes. */
  templates(): Promise<FormTemplateSummary[]>;
  get(id: string): Promise<Form>;
  /** Refused with the definition's problems (400, `details.problems`) when it is incomplete. */
  create(input?: CreateFormInput): Promise<Form>;
  update(id: string, patch: UpdateFormInput): Promise<Form>;
  /** Deletes it, or archives it when it already has submissions. */
  delete(id: string): Promise<'deleted' | 'archived'>;
  /** A copy, switched off. */
  duplicate(id: string): Promise<Form>;
  versions(id: string): Promise<FormVersionSummary[]>;
  version(id: string, version: number): Promise<FormVersion>;
  /** Bring an earlier version back, as a new version. */
  restore(id: string, version: number): Promise<Form>;
  export(id: string): Promise<FormExport>;
  /** Refused (409) when the id exists, unless `overwrite`, which saves it as a new version. */
  import(
    exported: FormExport,
    options?: { overwrite?: boolean },
  ): Promise<{ form: Form; created: boolean }>;
  analytics(id: string, options?: FormAnalyticsOptions): Promise<FormAnalytics>;
  submissions(id: string, options?: ListFormSubmissionsOptions): Promise<FormSubmissionPage>;
  /** The same filters, as CSV. Cells that a spreadsheet would run as formulas are escaped. */
  submissionsCsv(
    id: string,
    options?: Omit<ListFormSubmissionsOptions, 'cursor' | 'limit'>,
  ): Promise<string>;
  submission(id: string, submissionId: string): Promise<FormSubmission>;
  /** A giveaway's stats, entries and winners. */
  giveaway(id: string, options?: { limit?: number }): Promise<GiveawayOverview>;
  entrantsCsv(id: string): Promise<string>;
  winnersCsv(id: string): Promise<string>;
  /** Pick winners, weighted by entries. Pass a `seed` to make the draw reproducible by anyone. */
  draw(id: string, options?: { count?: number; seed?: string }): Promise<GiveawayDraw>;
  /** Replace one winner, saying why; the replaced one stays in the audit trail. */
  redraw(
    id: string,
    winnerId: string,
    reason: string,
  ): Promise<{ redrawn: GiveawayWinner; replacement: GiveawayWinner }>;
  disqualify(id: string, entryId: string, disqualified?: boolean): Promise<GiveawayEntry>;
  /** Prompts to paste into an AI coding assistant to embed the form, or open it from a button. */
  prompts(
    id: string,
    options?: { platform?: 'html' | 'nextjs' | 'wordpress' },
  ): Promise<FormPrompts>;
}

export function formsApi(transport: Transport): FormsApi {
  const path = (id: string, rest = '') => `/admin/forms/${encodeURIComponent(id)}${rest}`;
  const list = async (options: ListFormsOptions = {}) => {
    const { archived, ...rest } = options;
    const page = await transport.request<{ items: FormListItem[] }>('/admin/forms', {
      admin: true,
      query: { ...rest, archived: archived ? '1' : undefined },
    });
    return page.items;
  };
  const submissionQuery = (options: ListFormSubmissionsOptions): QueryInput => ({ ...options });

  return Object.assign(list, {
    list,
    templates: async () =>
      (
        await transport.request<{ items: FormTemplateSummary[] }>('/admin/forms/templates', {
          admin: true,
        })
      ).items,
    get: (id: string) => transport.request<Form>(path(id), { admin: true }),
    create: (input: CreateFormInput = {}) =>
      transport.request<Form>('/admin/forms', { method: 'POST', admin: true, json: input }),
    update: (id: string, patch: UpdateFormInput) =>
      transport.request<Form>(path(id), { method: 'PATCH', admin: true, json: patch }),
    delete: async (id: string) =>
      (
        await transport.request<{ result: 'deleted' | 'archived' }>(path(id), {
          method: 'DELETE',
          admin: true,
        })
      ).result,
    duplicate: (id: string) =>
      transport.request<Form>(path(id, '/duplicate'), { method: 'POST', admin: true }),
    versions: async (id: string) =>
      (
        await transport.request<{ items: FormVersionSummary[] }>(path(id, '/versions'), {
          admin: true,
        })
      ).items,
    version: (id: string, version: number) =>
      transport.request<FormVersion>(path(id, `/versions/${encodeURIComponent(String(version))}`), {
        admin: true,
      }),
    restore: (id: string, version: number) =>
      transport.request<Form>(
        path(id, `/versions/${encodeURIComponent(String(version))}/restore`),
        {
          method: 'POST',
          admin: true,
        },
      ),
    export: (id: string) => transport.request<FormExport>(path(id, '/export'), { admin: true }),
    import: (exported: FormExport, options: { overwrite?: boolean } = {}) =>
      transport.request<{ form: Form; created: boolean }>('/admin/forms/import', {
        method: 'POST',
        admin: true,
        json: { ...exported, overwrite: options.overwrite === true },
      }),
    analytics: (id: string, options: FormAnalyticsOptions = {}) =>
      transport.request<FormAnalytics>(path(id, '/analytics'), {
        admin: true,
        query: { ...options },
      }),
    submissions: (id: string, options: ListFormSubmissionsOptions = {}) =>
      transport.request<FormSubmissionPage>(path(id, '/submissions'), {
        admin: true,
        query: submissionQuery(options),
      }),
    submissionsCsv: (
      id: string,
      options: Omit<ListFormSubmissionsOptions, 'cursor' | 'limit'> = {},
    ) =>
      transport.request<string>(path(id, '/submissions.csv'), {
        admin: true,
        query: submissionQuery(options),
        text: true,
      }),
    submission: (id: string, submissionId: string) =>
      transport.request<FormSubmission>(
        path(id, `/submissions/${encodeURIComponent(submissionId)}`),
        {
          admin: true,
        },
      ),
    giveaway: (id: string, options: { limit?: number } = {}) =>
      transport.request<GiveawayOverview>(path(id, '/giveaway'), {
        admin: true,
        query: { ...options },
      }),
    entrantsCsv: (id: string) =>
      transport.request<string>(path(id, '/giveaway/entrants.csv'), { admin: true, text: true }),
    winnersCsv: (id: string) =>
      transport.request<string>(path(id, '/giveaway/winners.csv'), { admin: true, text: true }),
    draw: (id: string, options: { count?: number; seed?: string } = {}) =>
      transport.request<GiveawayDraw>(path(id, '/giveaway/draw'), {
        method: 'POST',
        admin: true,
        json: { count: options.count ?? 1, seed: options.seed },
      }),
    redraw: (id: string, winnerId: string, reason: string) =>
      transport.request<{ redrawn: GiveawayWinner; replacement: GiveawayWinner }>(
        path(id, `/giveaway/winners/${encodeURIComponent(winnerId)}/redraw`),
        { method: 'POST', admin: true, json: { reason } },
      ),
    disqualify: (id: string, entryId: string, disqualified = true) =>
      transport.request<GiveawayEntry>(
        path(id, `/giveaway/entries/${encodeURIComponent(entryId)}`),
        {
          method: 'PATCH',
          admin: true,
          json: { disqualified },
        },
      ),
    prompts: (id: string, options: { platform?: 'html' | 'nextjs' | 'wordpress' } = {}) =>
      transport.request<FormPrompts>(path(id, '/prompts'), { admin: true, query: { ...options } }),
  });
}
