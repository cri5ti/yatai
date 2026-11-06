import { useSyncExternalStore } from 'react';

export type Kind = 'project' | 'task' | 'action';
export type Status = 'todo' | 'doing' | 'waiting' | 'done';
export type SmartSource = 'pr' | 'pipeline' | 'workitem' | 'ai';
export type Layout = 'dock' | 'float' | 'max' | 'pill';
export type Tab = 'today' | 'inbox' | 'organizer';

export interface Node {
  id: string;
  parentId: string | null;
  kind: Kind;
  title: string;
  status: Status;
  today: boolean;
  open: boolean;
  created: number;
  modified: number;
  lastRun?: number;
  scheduled?: number; // minutes of day
  est?: number; // minutes
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
  startedAt: number; // real ms
  pausedAt?: number;
  pausedTotal: number; // real ms
  extra: number; // extra minutes added
  ended: boolean;
  elapsedAtEnd?: number;
}

export interface Toast {
  id: string;
  text: string;
  tone: 'bad' | 'warn' | 'good' | 'info';
}

export interface State {
  nodes: Node[];
  inbox: InboxItem[];
  meetings: Meeting[];
  flags: Flags;
  clock: number; // minutes of day (mock)
  clockSpeed: number; // mock minutes per real second
  layout: Layout;
  prevLayout: Layout;
  tab: Tab;
  focus: FocusState | null;
  focusSpeed: number; // multiplier for focus timer
  hidden: boolean;
  capture: boolean;
  dark: boolean;
  showApps: boolean;
  aiDelay: number;
  sel: string | null;
  aiBusy: string | null;
  toasts: Toast[];
}

export const uid = () => Math.random().toString(36).slice(2, 9);
const DAY = 86_400_000;

function seedNodes(): Node[] {
  const now = Date.now();
  const mk = (
    id: string,
    parentId: string | null,
    kind: Kind,
    title: string,
    extra: Partial<Node> = {},
  ): Node => ({
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
    mk('t_staff', 'p_rd', 'task', 'Extract staff', { modified: now - DAY }),
    mk('a_staff1', 't_staff', 'action', 'Audit staff module dependencies', { today: true, est: 30, lastRun: now - 3 * DAY }),
    mk('a_staff2', 't_staff', 'action', 'Draft extraction interface', { today: true, est: 45 }),
    mk('a_staff3', 't_staff', 'action', 'Move StaffService into new package', { est: 90 }),
    mk('t_vec', 'p_rd', 'task', 'Spike: vector search', { open: false }),
    mk('a_vec1', 't_vec', 'action', 'Compare sqlite-vec vs pgvector', { est: 60 }),
    mk('a_vec2', 't_vec', 'action', 'Prototype similarity query'),

    mk('p_plat', null, 'project', 'Platform'),
    mk('t_rel', 'p_plat', 'task', 'Release 2.4', { today: true }),
    mk('a_pr', 't_rel', 'action', 'PR #482 — auth token refactor', { today: true, smart: { source: 'pr' }, status: 'waiting' }),
    mk('a_pipe', 't_rel', 'action', 'Deploy 2.4 to prod', { today: true, smart: { source: 'pipeline' }, status: 'waiting' }),
    mk('a_wi', 't_rel', 'action', 'WI 18233 — flaky integration test', { smart: { source: 'workitem' }, status: 'waiting' }),
    mk('t_ai', 'p_plat', 'task', 'Test migration'),
    mk('a_claude', 't_ai', 'action', 'Claude: migrate tests to vitest', { today: true, smart: { source: 'ai' }, status: 'waiting' }),
    mk('a_review', 't_ai', 'action', "Review Claude's diff", { est: 20 }),

    mk('p_me', null, 'project', 'Personal', { open: false }),
    mk('t_tax', 'p_me', 'task', 'Taxes 2026'),
    mk('a_tax1', 't_tax', 'action', 'Gather receipts', { est: 25 }),
    mk('a_tax2', 't_tax', 'action', 'Book accountant', { est: 10 }),
  ];
}

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
    flags: defaultFlags(),
    clock: 9 * 60 + 5,
    clockSpeed: 0,
    layout: 'dock',
    prevLayout: 'dock',
    tab: 'today',
    focus: null,
    focusSpeed: 30,
    hidden: false,
    capture: false,
    dark: false,
    showApps: true,
    aiDelay: 900,
    sel: 'p_rd',
    aiBusy: null,
    toasts: [],
  };
}

const KEY = 'yatai-poc-v1';

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...initialState(), ...s, capture: false, aiBusy: null, toasts: [] };
    }
  } catch {
    /* ignore */
  }
  return initialState();
}

let state: State = load();
const listeners = new Set<() => void>();

export function set(fn: (s: State) => Partial<State>) {
  state = { ...state, ...fn(state) };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, toasts: [], aiBusy: null, capture: false }));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const get = () => state;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useS = () => useSyncExternalStore(subscribe, get);

export function resetAll() {
  set(() => ({ ...initialState() }));
}
export { seedInbox };
