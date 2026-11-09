/**
 * Popup windows: settings, help, the AI chat, the Outlook / GitHub / DevOps drawers and the developer panel
 * each get their own OS window (popup.html) beside or over the main one, instead of an overlay squeezed into it.
 *
 * The main window stays the only owner of the state:
 *  - whether a popup is open is still plain state (`settingsOpen`, `help`, `ai`, `drawer`, `dev`): the main window
 *    opens / places / hides the OS windows to match;
 *  - every state change is sent to the loaded popups as a copy (`yatai://state`), which they render;
 *  - a popup's actions come back by name (`yatai://act`, see act.ts) and run here.
 *
 * Adding a popup: a line in VIEWS, the component in popup.tsx, and it calls `act.*` instead of the actions.
 */
import { effLayout, get, subscribe } from './store';
import type { State } from './store';
import type * as Actions from './actions';
import { runAct } from './act';
import { emitTo, invoke, isTauri, listen, popupRect } from './platform';
import type { Placement } from './platform';

export interface PopupSpec extends Placement {
  /** open in the state? */
  open: (s: State) => boolean;
  /** the action that closes it (Esc / ⌘W / the window's close button / clicking away) */
  close: keyof typeof Actions;
  /** clicking anywhere else puts it away */
  blurCloses?: boolean;
}

export const VIEWS = {
  settings: { open: (s) => s.settingsOpen, close: 'closeSettings', place: 'center', w: 760, h: 720 },
  edit: { open: (s) => !!s.mdEdit, close: 'closeMdEdit', place: 'center', w: 760, h: 680 },
  help: { open: (s) => s.help, close: 'toggleHelp', place: 'center', w: 640, h: 700, blurCloses: true },
  ai: { open: (s) => !!s.ai, close: 'closeAi', place: 'beside', align: 'bottom', w: 460, h: 560 },
  drawer: { open: (s) => !!s.drawer && effLayout(s) !== 'pill', close: 'closeDrawer', place: 'beside', align: 'bottom', w: 460, h: 480 },
  dev: { open: (s) => s.dev, close: 'toggleDev', place: 'beside', align: 'top', w: 340, h: 'main' },
} satisfies Record<string, PopupSpec>;
export type View = keyof typeof VIEWS;
export const isView = (v: unknown): v is View => typeof v === 'string' && v in VIEWS;
export const viewOfLabel = (label: string) => label.replace(/^popup-/, '');
const label = (v: View) => `popup-${v}`;

/** on screen right now: open in the state, and the main window is not hidden away */
export const wanted = (v: View, s: State) => (VIEWS[v] as PopupSpec).open(s) && !s.hidden;

/** what a popup gets: the state without the undo snapshots (only their labels) and the context menu (it has functions) */
export const mirrorOf = (s: State) => ({
  ...s,
  past: s.past.map((h) => ({ label: h.label })),
  future: s.future.map((h) => ({ label: h.label })),
  menu: null,
});

/** close a popup that went away by itself (Esc, ⌘W, clicked away), if the state still has it open */
export function closeView(v: View) {
  if ((VIEWS[v] as PopupSpec).open(get())) runAct(VIEWS[v].close, []);
  else void invoke('popup_close', { view: v }); // out of step with the state: just hide it
}

/* ---------- the main window's side ---------- */
const shown = new Set<View>(); // asked to be on screen
const loaded = new Set<View>(); // the window's page is up and listening
const chain: Partial<Record<View, Promise<unknown>>> = {};
let layoutKey = '';

/** open / place / hide one window; queued per view so a quick open → close never ends up open */
function apply(v: View, focus: boolean) {
  chain[v] = (chain[v] ?? Promise.resolve())
    .then(async () => {
      if (!shown.has(v)) return invoke('popup_close', { view: v });
      const r = await popupRect(VIEWS[v]);
      if (!shown.has(v)) return; // closed while measuring: the next queued step hides it
      return invoke('popup_open', { view: v, x: r.x, y: r.y, w: r.w, h: r.h, focus });
    })
    .catch((e) => console.error(`yatai: popup ${v}`, e));
}

function sync() {
  const s = get();
  const lk = `${effLayout(s)}${s.focus?.ended ? '+' : ''}`;
  const relayout = layoutKey !== '' && lk !== layoutKey;
  layoutKey = lk;
  for (const v of Object.keys(VIEWS) as View[]) {
    const want = wanted(v, s);
    if (want && !shown.has(v)) (shown.add(v), apply(v, true));
    else if (!want && shown.has(v)) (shown.delete(v), apply(v, false));
  }
  // the main window is being moved / resized for its new layout: follow it once it got there
  if (relayout) setTimeout(() => shown.forEach((v) => VIEWS[v].place === 'beside' && apply(v, false)), 450);
}

let queued = false;
function broadcast() {
  if (queued || !loaded.size) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    const m = mirrorOf(get());
    loaded.forEach((v) => void emitTo(label(v), 'yatai://state', m));
  }, 0);
}

export function startPopups() {
  if (!isTauri) return;
  void listen<{ name: string; args: unknown[] }>('yatai://act', ({ name, args }) => runAct(name, Array.isArray(args) ? args : []));
  void listen<string>('yatai://popup-hello', (v) => {
    if (!isView(v)) return;
    loaded.add(v);
    void emitTo(label(v), 'yatai://state', mirrorOf(get()));
  });
  void listen<string>('yatai://popup-closed', (v) => isView(v) && closeView(v));
  subscribe(() => (sync(), broadcast()));
  sync();
}
