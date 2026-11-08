import { useSyncExternalStore } from 'react';

export type Status = 'todo' | 'doing' | 'waiting' | 'done' | 'dropped';
export type SmartSource = 'pr' | 'pipeline' | 'workitem' | 'ai';
/** what the (mocked) GitHub connector reports for a pull request */
export type PrStatus = 'draft' | 'review' | 'feedback' | 'failing' | 'ready' | 'merged' | 'closed';
export type DrawerKind = 'outlook' | 'github' | 'devops';
export type Layout = 'dock' | 'float' | 'max' | 'pill';
export type Tab = 'next' | 'inbox' | 'organizer';

export interface Node {
  id: string;
  parentId: string | null; // any item — or a meeting id for "prep" style items. Everything is just an item.
  title: string; // may be multi-line markdown; line 1 is the headline
  status: Status;
  today: boolean; // "in Next"
  open: boolean; // expanded in Organizer / not collapsed in Next
  created: number;
  modified: number;
  lastRun?: number;
  scheduled?: number;
  est?: number; // minutes
  due?: string; // yyyy-mm-dd
  later?: number; // deferred by N days (/tomorrow, /reschedule)
  spent?: number; // stopwatch total, ms
  smart?: { source: SmartSource };
}

export interface InboxItem {
  id: string;
  text: string;
  created: number;
  suggestion?: { parentId: string; reason: string } | null;
  suggesting?: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  start: number; // minutes of day
  movedTo?: number; // applied when flags.meetingMoved
  durationMin: number;
  where: string;
  open?: boolean; // card collapsed when false
}

/**
 * One card in Next. A task can have several segments (the "split schedule"): same task, its actions
 * scheduled in different places of the stack. Items are action ids (or `fx_<meetingId>` for the fixed calendar row).
 */
export interface Seg {
  id: string;
  owner: string; // item id, meeting id, or ROOT; the card header
  items: string[]; // the rows directly under the owner that are in Next (their Next-children nest under them)
  keep?: boolean; // an explicitly created, still-empty card
  pulled?: boolean; // holds sub-items dragged out of their parent row: the parent repeats as this card's header
}

export interface Current {
  id: string;
  since: number; // real ms
}

export interface Flags {
  prBuildFailing: boolean;
  prNewComments: boolean;
  prApproved: boolean;
  pipelineFailed: boolean;
  workItemChanged: boolean;
  aiNeedsFeedback: boolean;
  aiDone: boolean;
  meetingMoved: boolean;
}

export interface FocusState {
  nodeId: string;
  durationMin: number;
  startedAt: number;
  pausedAt?: number;
  pausedTotal: number;
  extra: number;
  ended: boolean;
  elapsedAtEnd?: number;
}

export interface Toast {
  id: string;
  text: string;
  tone: 'bad' | 'warn' | 'good' | 'info';
}

/* ---------- menus / ai / inline creation (UI state, not undoable) ---------- */
export type Target = { t: 'card'; key: string } | { t: 'row'; id: string } | { t: 'node'; id: string } | { t: 'inbox'; id: string } | { t: 'multi'; ids: string[] };

export interface MenuItem {
  id: string;
  label: string;
  cmd?: string; // slash alias, e.g. "consolidate"
  keys?: string; // shortcut hint
  key?: string; // digit/letter that picks it inside a submenu
  icon?: string;
  tip?: string;
  danger?: boolean;
  disabled?: boolean;
  sub?: MenuItem[];
  date?: { value?: string; pick: (iso: string) => void }; // opens a calendar inside the menu
  run?: () => void;
}
export interface MenuState {
  id: string;
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
  slash: boolean;
}

export interface AiMsg {
  id: string;
  role: 'user' | 'ai' | 'note';
  text: string;
  chips?: { label: string; run: () => void }[];
  suggest?: string[]; // follow-ups the AI proposes: clicking one sends it
  error?: boolean;
}
export interface AiState {
  ctx?: string;
  ctxId?: string;
  msgs: AiMsg[];
  busy: boolean;
  status?: string; // what the AI is doing right now ("Reading today's items…")
}

/* ---------- AI proposals: staged changes shown in purple until accepted / rejected ---------- */
export type PatchKey = 'title' | 'est' | 'due' | 'status' | 'today';
export interface SubSpec {
  id: string; // existing item, or an id minted when the AI proposed it
  isNew?: boolean;
  title?: string;
  est?: number | null;
  status?: Status;
  children?: SubSpec[]; // omitted = keep that item's own sub-items as they are
}
export type AiOp =
  | { op: 'patch'; id: string; set: { title?: string; est?: number | null; due?: string | null; status?: Status; today?: boolean } }
  | { op: 'subs'; id: string; items: SubSpec[] };
export interface Proposal {
  ops: AiOp[];
}

export type Ins =
  | { kind: 'action'; owner: string; seg?: string; after: string | null; before?: string } // before: insert above this row
  | { kind: 'task'; afterSeg: string | null }
  | { kind: 'node'; parentId: string | null; afterId: string | null; beforeId?: string };

export interface Nsel {
  card: string | null;
  row: string | null;
}

/* ---------- document (undoable) ---------- */
export interface Doc {
  nodes: Node[];
  inbox: InboxItem[];
  meetings: Meeting[];
  plan: Seg[];
  current: Current | null;
}
export interface Hist {
  label: string;
  doc: Doc;
}

export interface State extends Doc {
  flags: Flags;
  clock: number;
  clockSpeed: number;
  layout: Layout;
  prevLayout: Layout;
  tab: Tab;
  focus: FocusState | null;
  focusSpeed: number;
  hidden: boolean;
  capture: boolean;
  dark: boolean;
  prs: Record<string, PrStatus>; // 'org/repo#123' -> status
  prc: Record<string, number>; // 'org/repo#123' -> unresolved review comments
  drawer: { kind: DrawerKind; tab: string; sel: number } | null; // Outlook / GitHub / DevOps pop-up
  hl: Record<string, true>; // yellow highlights: changes the user did not make, cleared only by hovering them
  bounds: Partial<Record<'dock' | 'float' | 'max', { x: number; y: number; w: number; h: number }>>; // user-resized window rects (dock: only w)
  scale: number; // index into SCALES
  density: number; // index into DENSITIES
  showApps: boolean;
  aiDelay: number;
  sel: string | null; // organizer selection
  nsel: Nsel; // next selection
  isel: string | null; // inbox selection
  multi: string[]; // multi-selection (item ids), empty when a single item is selected
  anchor: string | null; // where a shift-range started
  expanded: Record<string, boolean>; // action text expanded
  edit: string | null; // id being renamed ('card:<key>' for a card title)
  ins: Ins | null; // inline "create here" draft
  menu: MenuState | null;
  ai: AiState | null;
  proposal: Proposal | null; // pending AI changes (not part of the document until accepted)
  help: boolean;
  aiBusy: string | null;
  toasts: Toast[];
  past: Hist[];
  future: Hist[];
}

/** UI scale (zoom) and row density (vertical padding multiplier) steps */
export const SCALES = [0.85, 1, 1.15, 1.3];
export const DENSITIES = [0.5, 1, 1.6];

export const uid = () => Math.random().toString(36).slice(2, 9);
const DAY = 86_400_000;

function seedNodes(): Node[] {
  const now = Date.now();
  const mk = (id: string, parentId: string | null, title: string, extra: Partial<Node> = {}): Node => ({
    id,
    parentId,
    title,
    status: 'todo',
    today: false,
    open: true,
    created: now - 12 * DAY,
    modified: now - 2 * DAY,
    ...extra,
  });
  return [
    mk('p_rd', null, 'R&D'),
    mk('t_staff', 'p_rd', 'Extract staff', { modified: now - DAY }),
    mk(
      'a_staff1',
      't_staff',
      'Audit staff module dependencies\nCheck who imports `StaffService`, focus on:\n- [x] payroll helper\n- [ ] reporting jobs\n- [ ] **legacy** admin endpoints\nNotes: https://wiki.example.com/staff-extraction',
      { today: true, est: 30, lastRun: now - 3 * DAY },
    ),
    // items nest to any depth
    mk('a_staff1a', 'a_staff1', 'List callers of PayrollHelper', { today: true, est: 10 }),
    mk('a_staff1b', 'a_staff1', 'Check the nightly job', { today: true }),
    mk('a_staff2', 't_staff', 'Draft extraction interface\n*Keep it small* — only what callers need today.', { today: true, est: 45 }),
    mk('a_staff3', 't_staff', 'Move StaffService into new package', { est: 90 }),
    mk('t_vec', 'p_rd', 'Spike: vector search', { open: false }),
    mk('a_vec1', 't_vec', 'Compare sqlite-vec vs pgvector', { est: 60 }),
    mk('a_vec2', 't_vec', 'Prototype similarity query'),

    mk('p_plat', null, 'Platform'),
    mk('t_rel', 'p_plat', 'Release 2.4'),
    mk('a_pr', 't_rel', 'https://github.com/acme/api/pull/482 Auth token refactor', { today: true }),
    mk('a_pipe', 't_rel', 'Deploy 2.4 to prod', { today: true, smart: { source: 'pipeline' }, status: 'waiting' }),
    mk('a_wi', 't_rel', 'WI 18233 — flaky integration test', { smart: { source: 'workitem' }, status: 'waiting' }),
    mk('t_ai', 'p_plat', 'Test migration'),
    mk('a_claude', 't_ai', 'Claude: migrate tests to vitest', { today: true, smart: { source: 'ai' }, status: 'waiting' }),
    mk('a_review', 't_ai', "Review Claude's diff\nhttps://github.com/acme/web/pull/1203", { est: 20 }),

    mk('p_me', null, 'Personal', { open: false }),
    mk('t_tax', 'p_me', 'Taxes 2026'),
    mk('a_tax1', 't_tax', 'Gather receipts', { est: 25 }),
    mk('a_tax2', 't_tax', 'Book accountant', { est: 10 }),

    // an item living inside a meeting ("prep")
    mk('a_prep', 'm3', 'Prep: skim last 1:1 notes', { today: true, est: 10 }),
  ];
}

/** a seeded split: "Extract staff" is scheduled in two places of the stack */
const seedPlan = (): Seg[] => [
  { id: 's_t_staff', owner: 't_staff', items: ['a_staff1'] },
  { id: 's_t_rel', owner: 't_rel', items: ['a_pr', 'a_pipe'] },
  { id: 's_t_ai', owner: 't_ai', items: ['a_claude'] },
  { id: 's_t_staff_2', owner: 't_staff', items: ['a_staff2'] },
];

const seedInbox = (): InboxItem[] => [
  { id: uid(), text: 'extract staff: check who calls the payroll helper', created: Date.now() - 3600_000 },
  { id: uid(), text: 'try sqlite-vec for embeddings', created: Date.now() - 7200_000 },
  { id: uid(), text: 'renew passport', created: Date.now() - 86_400_000 },
  { id: uid(), text: 'ask Sam about the release checklist', created: Date.now() - 90_000_000 },
];

export const seedMeetings = (): Meeting[] => [
  { id: 'm1', title: 'Team standup', start: 9 * 60 + 30, durationMin: 15, where: 'Teams' },
  { id: 'm2', title: 'Design review', start: 14 * 60, movedTo: 11 * 60 + 30, durationMin: 45, where: 'Room 4.12' },
  { id: 'm3', title: '1:1 with Sam', start: 16 * 60, durationMin: 30, where: 'Teams' },
];

/** everything on the (mocked) Outlook calendar today — yatai only shows the ones you have brought in */
export const CALENDAR: Meeting[] = [
  ...seedMeetings(),
  { id: 'm4', title: 'Sprint planning', start: 10 * 60 + 30, durationMin: 60, where: 'Teams' },
  { id: 'm5', title: 'Lunch & learn', start: 12 * 60 + 30, durationMin: 45, where: 'Cafeteria' },
  { id: 'm6', title: 'Dentist', start: 17 * 60 + 30, durationMin: 60, where: 'Off-site' },
];

export const defaultFlags = (): Flags => ({
  prBuildFailing: false,
  prNewComments: false,
  prApproved: false,
  pipelineFailed: false,
  workItemChanged: false,
  aiNeedsFeedback: false,
  aiDone: false,
  meetingMoved: false,
});

export function initialState(): State {
  return {
    nodes: seedNodes(),
    inbox: seedInbox(),
    meetings: seedMeetings(),
    plan: seedPlan(),
    current: null,
    flags: defaultFlags(),
    clock: 9 * 60 + 5,
    clockSpeed: 0,
    layout: 'dock',
    prevLayout: 'dock',
    tab: 'next',
    focus: null,
    focusSpeed: 30,
    hidden: false,
    capture: false,
    dark: false,
    prs: { 'acme/api#482': 'review', 'acme/web#1203': 'draft' },
    prc: {},
    drawer: null,
    hl: {},
    bounds: {},
    scale: 1,
    density: 1,
    showApps: true,
    aiDelay: 900,
    sel: 'p_rd',
    nsel: { card: null, row: null },
    isel: null,
    multi: [],
    anchor: null,
    expanded: {},
    edit: null,
    ins: null,
    menu: null,
    ai: null,
    proposal: null,
    help: false,
    aiBusy: null,
    toasts: [],
    past: [],
    future: [],
  };
}

const KEY = 'yatai-poc-v3';
const transient = (s: State) => ({ ...s, drawer: null, toasts: [], aiBusy: null, capture: false, menu: null, ai: null, proposal: null, help: false, edit: null, ins: null, multi: [], anchor: null, past: [], future: [] });

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...initialState(), ...transient(JSON.parse(raw)) };
  } catch {
    /* ignore */
  }
  return initialState();
}

let state: State = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(transient(state)));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** UI-state change (not undoable) */
export function set(fn: (s: State) => Partial<State>) {
  state = { ...state, ...fn(state) };
  emit();
}

export const docOf = (s: State): Doc => ({ nodes: s.nodes, inbox: s.inbox, meetings: s.meetings, plan: s.plan, current: s.current });

/**
 * The single entry point for every data change: snapshots the document for undo/redo.
 * Return null from `fn` to signal "nothing changed" (no history entry).
 */
export function commit(label: string, fn: (s: State) => Partial<State> | null): boolean {
  if (state.proposal && !label.startsWith('AI:')) {
    blocked?.();
    return false; // the AI proposal has to be accepted or rejected first
  }
  const patch = fn(state);
  if (!patch) return false;
  const entry: Hist = { label, doc: docOf(state) };
  state = { ...state, ...patch, past: [...state.past.slice(-99), entry], future: [] };
  emit();
  return true;
}

let blocked: (() => void) | null = null;
/** what to tell the user when an edit is refused because an AI proposal is pending */
export const onBlocked = (fn: () => void) => (blocked = fn);

export const get = () => state;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useS = () => useSyncExternalStore(subscribe, get);

export function resetAll() {
  state = initialState();
  emit();
}
export { seedInbox };
