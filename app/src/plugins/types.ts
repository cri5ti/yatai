/**
 * The plugin interface (design/plugins.md §3–4). Everything that crosses it is plain JSON, so the state
 * can be copied to popup windows and a plugin could later move out of process.
 * A ref is the string `<plugin>:<id>` ('github:acme/api#482'); the id is opaque to the core.
 */
export type Tone = 'bad' | 'warn' | 'good' | 'info';

/** something worth attention in a snapshot; the key is stable so the core can tell a new alert from one that is still there */
export interface Alert {
  key: string;
  tone: Tone;
  text: string; // the chip
  toast?: string; // when it appears: a longer sentence for the toast (default: `<name>: <text>`)
}

/** the state glyph + label shown beside a tracked thing (for GitHub the glyph is a PrStatus) */
export interface View {
  glyph: string;
  label: string;
  tone: Tone;
  count?: number;
  /** a passing state (queued, building): moving into it is not announced, unless the item asks to be told everything */
  quiet?: boolean;
  /** whose move it is: 'me' (mine to act on) or 'them' (waiting on someone else); unset when it does not apply / is not known */
  turn?: Turn;
}
export type Turn = 'me' | 'them';

/** what a plugin currently knows about one ref */
export interface Snapshot {
  ref: string;
  name: string; // short, for toasts: 'api#482'
  title: string;
  view: View;
  alerts: Alert[];
  rev: string; // changes when anything shown changes
  gone?: boolean; // deleted, or the token cannot see it
  desc?: string; // the PR's description (live GitHub only), used once to fill in a bare pasted link
  /** things to act on inside it (a failing check, an unresolved review thread): kept as sub-items of the item, checked off once gone */
  details?: Detail[];
  /** what the cheap poll saw when the details were last fetched: while it is the same, the details are not asked for again */
  basis?: string;
}

/** one outstanding thing a source reports; `key` is stable while it is outstanding */
export interface Detail {
  key: string;
  text: string; // the sub-item's headline
  url?: string; // where to look (the run, the comment): goes on the sub-item's second line
}

/** the left-hand mark of a drawer row */
export type Lead = { glyph: string; count?: number; kind?: 'build'; turn?: Turn } | { text: string };

/** one row in a drawer */
export interface Entry {
  ref: string;
  title: string;
  sub: string;
  lead: Lead;
  /** the text of the item when it is brought in (a url, a label) */
  text: string;
  snap?: Snapshot; // seeds the snapshot of the new item
  smart?: string; // brought in as a smart item of this source ('workitem'); PRs are just links
  dim?: boolean;
  meeting?: { id: string; title: string; start: number; durationMin: number; where: string; day: string }; // a calendar entry: brought in as a meeting card on its day
  clash?: boolean; // a calendar entry that overlaps another one (double booked)
  canInbox: boolean;
}

export interface ListDef {
  id: string;
  label: string;
  /** lists of one kind under a first row of their own (DevOps: Builds · Work items) */
  group?: string;
}

/** a meeting from a calendar-like plugin (minutes of the day) */
export interface AgendaEvent {
  day?: string; // yyyy-mm-dd (set by the tracker)
  id: string;
  title: string;
  start: number;
  durationMin: number;
  where: string;
  cancelled?: boolean;
}

/** thrown by an implementation when the credentials are missing or were rejected */
export class AuthError extends Error {}

/** what an implementation (live or mock) provides; any subset */
export interface Impl {
  /** live state for the refs tracked in Next: one batched call. `force`: the user asked (Refresh): fetch everything, details too */
  fetch?(refs: string[], opts?: { force?: boolean }): Promise<Snapshot[]>;
  lists?: ListDef[];
  list?(id: string): Promise<Entry[]>;
  agenda?(day: string): Promise<AgendaEvent[]>;
  /** a source that pulls a stream of its own (new emails): called every cycle; what it returns is toasted */
  poll?(): Promise<Notice[]>;
}
export interface Notice {
  text: string;
  tone: Tone;
}

export interface Plugin {
  id: string; // also the drawer kind
  name: string;
  /** refs written in a piece of text (a pasted url), in order */
  match?(text: string): string[];
  /** the live implementation needs a token (kept in the keychain); Settings → Accounts connects it */
  auth?: {
    field: { label: string; placeholder: string; help: string }; // what Settings asks for
    configured(): Promise<boolean>;
    who(): Promise<string>; // verifies the token; throws AuthError when rejected
    connect(token: string): Promise<string>;
    disconnect(): Promise<void>;
  };
  live?: Impl;
  mock?: Impl;
  pollMs: { active: number; idle: number };
}

export type AccountState = { state: 'none' | 'connected' | 'expired'; as?: string; host?: string };
export interface ListState {
  entries: Entry[];
  at: number;
  error?: string;
  loading?: boolean; // a refresh is running
}

export const refKey = (plugin: string, id: string) => `${plugin}:${id}`;
export const pluginOf = (ref: string) => ref.slice(0, ref.indexOf(':'));
