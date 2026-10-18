/**
 * `client.admin.contacts` — the one admin namespace you can also call.
 *
 * `admin.contacts({ q })` lists, exactly as it always did, and the same object
 * carries the per-person calls a host app's server makes:
 *
 *   await helpwell.contacts.update('usr_8412', { attributes: { seats: 4 } });
 *   await helpwell.contacts.track('usr_8412', 'exported_csv', { rows: 120 });
 *
 * Every id here is either HelpWell's (`con_…`) or your own user id. An update
 * or event for a user id HelpWell has never seen creates the contact, so a
 * backend can describe people before they ever open the widget.
 */

import type { QueryInput, Transport } from './http.js';
import type {
  Condition,
  ConditionGroup,
  ContactDetail,
  ContactPage,
  ContactUpdate,
  EventPage,
} from './types.js';

export interface ListContactsOptions {
  q?: string;
  tag?: string;
  identified?: boolean;
  /** Only members of this saved segment. */
  segment?: string;
  /** Only contacts these conditions match, without saving a segment. */
  conditions?: ConditionGroup | Condition;
  cursor?: string;
  limit?: number;
}

export interface ContactEventsOptions {
  name?: string;
  cursor?: string;
  limit?: number;
}

export interface TrackOptions {
  url?: string;
  /** When it happened, for a backfill. ISO 8601. Defaults to now. */
  at?: string;
}

export interface ContactsApi {
  /** A page of contacts, newest first. Same as `list`. */
  (options?: ListContactsOptions): Promise<ContactPage>;
  list(options?: ListContactsOptions): Promise<ContactPage>;
  /** One contact, by HelpWell's id or your user id. */
  get(idOrUserId: string): Promise<ContactDetail>;
  /**
   * Merge attributes (`null` removes a key), add or remove tags, record
   * consent. Creates the contact when your user id is new, unless
   * `upsert: false`.
   */
  update(idOrUserId: string, patch: ContactUpdate): Promise<ContactDetail>;
  /** Their tracked events, newest first. */
  events(idOrUserId: string, options?: ContactEventsOptions): Promise<EventPage>;
  /** Server-side `track()`: record something they did in your app. */
  track(
    idOrUserId: string,
    name: string,
    props?: Record<string, unknown>,
    options?: TrackOptions,
  ): Promise<{ id: string; contactId: string }>;
  /** The list as CSV, source and consent labels included. */
  csv(options?: Omit<ListContactsOptions, 'cursor' | 'limit'>): Promise<string>;
}

/** Turn list options into query parameters; conditions travel as JSON. */
export function contactQuery(options: ListContactsOptions): QueryInput {
  const { conditions, ...rest } = options;
  return { ...rest, conditions: conditions ? JSON.stringify(conditions) : undefined };
}

export function contactsApi(transport: Transport): ContactsApi {
  const path = (id: string) => `/admin/contacts/${encodeURIComponent(id)}`;
  const list = (options: ListContactsOptions = {}) =>
    transport.request<ContactPage>('/admin/contacts', {
      admin: true,
      query: contactQuery(options),
    });

  return Object.assign(list, {
    list,
    get: (id: string) => transport.request<ContactDetail>(path(id), { admin: true }),
    update: (id: string, patch: ContactUpdate) =>
      transport.request<ContactDetail>(path(id), { method: 'PATCH', admin: true, json: patch }),
    events: (id: string, options: ContactEventsOptions = {}) =>
      transport.request<EventPage>(`${path(id)}/events`, { admin: true, query: { ...options } }),
    track: (
      id: string,
      name: string,
      props?: Record<string, unknown>,
      options: TrackOptions = {},
    ) =>
      transport.request<{ id: string; contactId: string }>('/admin/events', {
        method: 'POST',
        admin: true,
        json: { contact: id, name, props, ...options },
      }),
    csv: (options: Omit<ListContactsOptions, 'cursor' | 'limit'> = {}) =>
      transport.request<string>('/admin/contacts.csv', {
        admin: true,
        query: contactQuery(options),
        text: true,
      }),
  });
}
