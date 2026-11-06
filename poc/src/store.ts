import { useSyncExternalStore } from 'react';

export type Kind = 'project' | 'task' | 'action';
export type Status = 'todo' | 'doing' | 'waiting' | 'done' | 'dropped';
export type SmartSource = 'pr' | 'pipeline' | 'workitem' | 'ai';
export type Layout = 'dock' | 'float' | 'max' | 'pill';
export type Tab = 'next' | 'inbox' | 'organizer';

export interface Node {
  id: string;
  parentId: string | null; // project/task id — or a meeting id for "prep" style actions
  kind: Kind;
  title: string; // actions may be multi-line markdown; line 1 is the headline
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
  owner: string; // task id or meeting id
  items: string[];
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
export type Target = { t: 'card'; key: string } | { t: 'row'; id: string } | { t: 'node'; id: string } | { t: 'inbox'; id: string };

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
  role: 'user' | 'ai';
  text: string;
  chips?: { label: string; run: () => void }[];
}
export interface AiState {
  ctx?: string;
  ctxId?: string;
  msgs: AiMsg[];
  busy: boolean;
}

export type Ins =
  | { kind: 'action'; owner: string; seg?: string; after: string | null }
  | { kind: 'task'; afterSeg: string | null }
  | { kind: 'node'; nodeKind: Kind; parentId: string | null; afterId: string | null };

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
  showApps: boolean;
  aiDelay: number;
  sel: string | null; // organizer selection
  nsel: Nsel; // next selection
  isel: string | null; // inbox selection
  expanded: Record<string, boolean>; // action text expanded
  edit: string | null; // id being renamed ('card:<key>' for a card title)
  ins: Ins | null; // inline "create here" draft
  menu: MenuState | null;
  ai: AiState | null;
  help: boolean;
  aiBusy: string | null;
  toasts: Toast[];
  past: Hist[];
  future: Hist[];
}

export const uid = () => Math.random().toString(36).slice(2, 9);
const DAY = 86_400_000;

function seedNodes(): Node[] {
  const now = Date.now();
  const mk = (id: string, parentId: string | null, kind: Kind, title: string, extra: Partial<Node> = {}): Node => ({
    id,
    parentId,
    kind,
    title,
    status: 'todo',
    today: false,
    open: true,
    created: now - 12 * DAY,
    modified: now - 2 * DAY,
    ...extra,
  });
  return [
    mk('p_rd', null, 'project', 'R&D'),
    mk('t_staff', 'p_rd', 'task', 'Extract staff', { modified: now - DAY, today: true }),
    mk(
      'a_staff1',
      't_staff',
      'action',
      'Audit staff module dependencies\nCheck who imports `StaffService`, focus on:\n- [x] payroll helper\n- [ ] reporting jobs\n- [ ] **legacy** admin endpoints\nNotes: https://wiki.example.com/staff-extraction',
      { today: true, est: 30, lastRun: now - 3 * DAY },
    ),
    mk('a_staff2', 't_staff', 'action', 'Draft extraction interface\n*Keep it small* — only what callers need today.', { today: true, est: 45 }),
    mk('a_staff3', 't_staff', 'action', 'Move StaffService into new package', { est: 90 }),
    mk('t_vec', 'p_rd', 'task', 'Spike: vector search', { open: false }),
    mk('a_vec1', 't_vec', 'action', 'Compare sqlite-vec vs pgvector', { est: 60 }),
    mk('a_vec2', 't_vec', 'action', 'Prototype similarity query'),

    mk('p_plat', null, 'project', 'Platform'),
    mk('t_rel', 'p_plat', 'task', 'Release 2.4', { today: true }),
    mk('a_pr', 't_rel', 'action', 'PR #482 — auth token refactor', { today: true, smart: { source: 'pr' }, status: 'waiting' }),
    mk('a_pipe', 't_rel', 'action', 'Deploy 2.4 to prod', { today: true, smart: { source: 'pipeline' }, status: 'waiting' }),
    mk('a_wi', 't_rel', 'action', 'WI 18233 — flaky integration test', { smart: { source: 'workitem' }, status: 'waiting' }),
    mk('t_ai', 'p_plat', 'task', 'Test migration', { today: true }),
    mk('a_claude', 't_ai', 'action', 'Claude: migrate tests to vitest', { today: true, smart: { source: 'ai' }, status: 'waiting' }),
    mk('a_review', 't_ai', 'action', "Review Claude's diff", { est: 20 }),

    mk('p_me', null, 'project', 'Personal', { open: false }),
    mk('t_tax', 'p_me', 'task', 'Taxes 2026'),
    mk('a_tax1', 't_tax', 'action', 'Gather receipts', { est: 25 }),
    mk('a_tax2', 't_tax', 'action', 'Book accountant', { est: 10 }),

    // an action living inside a meeting ("prep")
    mk('a_prep', 'm3', 'action', 'Prep: skim last 1:1 notes', { today: true, est: 10 }),
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
    showApps: true,
    aiDelay: 900,
    sel: 'p_rd',
    nsel: { card: null, row: null },
    isel: null,
    expanded: {},
    edit: null,
    ins: null,
    menu: null,
    ai: null,
    help: false,
    aiBusy: null,
    toasts: [],
    past: [],
    future: [],
  };
}

const KEY = 'yatai-poc-v2';
const transient = (s: State) => ({ ...s, toasts: [], aiBusy: null, capture: false, menu: null, ai: null, help: false, edit: null, ins: null, past: [], future: [] });

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
  const patch = fn(state);
  if (!patch) return false;
  const entry: Hist = { label, doc: docOf(state) };
  state = { ...state, ...patch, past: [...state.past.slice(-99), entry], future: [] };
  emit();
  return true;
}

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
