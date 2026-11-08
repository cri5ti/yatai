/**
 * Everything that differs between the desktop app (Tauri) and the plain browser build (`bun run dev`).
 * The rest of the UI only talks to this module, so it runs in both.
 */
import type { Layout } from './store';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** macOS resizes frameless windows natively (and has no resize-drag API); elsewhere the edges are ours */
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent);
/** this page is a popup window (popup.html: settings, help, the AI chat, the drawers, the developer panel) */
export const inPopup = isTauri && typeof location !== 'undefined' && location.pathname.endsWith('/popup.html');

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let _invoke: Invoke | null = null;
async function core() {
  if (!_invoke) _invoke = (await import('@tauri-apps/api/core')).invoke as Invoke;
  return _invoke;
}
export const invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => (await core())<T>(cmd, args);

/** shell → UI events (tray, global hotkeys, quitting, the capture window) */
export async function listen<T = unknown>(event: string, fn: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, (e) => fn(e.payload));
}
export async function emitTo(target: string, event: string, payload?: unknown) {
  if (!isTauri) return;
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(target, event, payload);
}

/* ---------- the main window ---------- */
export type Rect = { x: number; y: number; w: number; h: number };
const PILL = { w: 360, h: 84, ended: 330 };
const DEFAULT = { dock: 372, float: { w: 560, h: 660 } };
/** physical → logical, and the area the OS leaves free for windows (no menu bar / taskbar / dock) */
async function workArea() {
  const { currentMonitor, primaryMonitor } = await import('@tauri-apps/api/window');
  const m = (await currentMonitor()) ?? (await primaryMonitor());
  if (!m) return { x: 0, y: 0, w: 1440, h: 900 };
  const f = m.scaleFactor;
  const a = m.workArea ?? { position: m.position, size: m.size };
  return { x: a.position.x / f, y: a.position.y / f, w: a.size.width / f, h: a.size.height / f };
}

/** our own geometry changes, so the move / resize events they cause are not saved as the user's */
let applying = 0;
export const isApplying = () => applying > 0;

/**
 * Put the OS window where a layout says: dock = right edge, full height · float = medium, top right ·
 * max = large · pill = small, always on top. A saved rect (the user moved / resized it) wins.
 */
export async function applyLayout(layout: Layout, saved: Partial<Record<string, Rect>>, ended: boolean) {
  if (!isTauri) return;
  const { getCurrentWindow, LogicalPosition, LogicalSize } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  const wa = await workArea();
  let r: Rect;
  if (layout === 'dock') {
    const width = Math.min(saved.dock?.w ?? DEFAULT.dock, wa.w);
    r = { x: wa.x + wa.w - width, y: wa.y, w: width, h: wa.h };
  } else if (layout === 'pill') {
    const h = ended ? PILL.ended : PILL.h;
    r = { x: wa.x + wa.w - PILL.w - 24, y: wa.y + 24, w: PILL.w, h };
  } else if (saved[layout]) {
    r = fit(saved[layout]!, wa);
  } else if (layout === 'float') {
    const h = Math.min(DEFAULT.float.h, wa.h - 80);
    r = { x: wa.x + wa.w - DEFAULT.float.w - 48, y: wa.y + 40, w: DEFAULT.float.w, h };
  } else {
    r = { x: wa.x + 28, y: wa.y + 24, w: wa.w - 56, h: wa.h - 48 };
  }
  applying++;
  try {
    await w.setAlwaysOnTop(layout === 'pill');
    await w.setResizable(layout !== 'pill');
    await w.setSize(new LogicalSize(r.w, r.h));
    await w.setPosition(new LogicalPosition(r.x, r.y));
  } finally {
    // the OS reports the resulting moves / resizes a little later
    setTimeout(() => applying--, 400);
  }
}
/** keep a remembered rect on screen (the monitor may have changed since) */
function fit(r: Rect, wa: Rect): Rect {
  const w = Math.min(r.w, wa.w);
  const h = Math.min(r.h, wa.h);
  return { w, h, x: Math.max(wa.x, Math.min(r.x, wa.x + wa.w - w)), y: Math.max(wa.y, Math.min(r.y, wa.y + wa.h - h)) };
}

/** the window's current rect in logical px (for remembering what the user dragged it to) */
export async function windowRect(): Promise<Rect | null> {
  if (!isTauri) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  const f = await w.scaleFactor();
  const [p, s] = await Promise.all([w.outerPosition(), w.innerSize()]);
  return { x: p.x / f, y: p.y / f, w: s.width / f, h: s.height / f };
}

/** where a popup window goes: centered on the screen, or beside the main window (left of the dock, else right, else over it) */
export interface Placement {
  place: 'center' | 'beside';
  align?: 'top' | 'bottom';
  w: number;
  /** 'main': as tall as the main window */
  h: number | 'main';
}
export async function popupRect(p: Placement): Promise<Rect> {
  const wa = await workArea();
  const m = (await windowRect()) ?? wa;
  const M = 8;
  const w = Math.min(p.w, wa.w - 2 * M);
  const h = Math.min(p.h === 'main' ? m.h : p.h, wa.h - 2 * M);
  if (p.place === 'center') return { x: wa.x + (wa.w - w) / 2, y: wa.y + Math.max(M, (wa.h - h) / 3), w, h };
  let x: number;
  if (m.x - wa.x >= w + M) x = m.x - M - w;
  else if (wa.x + wa.w - (m.x + m.w) >= w + M) x = m.x + m.w + M;
  else x = Math.max(wa.x + M, m.x + 12); // no room beside it: over its left side
  const y = p.align === 'top' ? m.y : m.y + m.h - h;
  return { x, y: Math.max(wa.y, Math.min(y, wa.y + wa.h - h)), w, h };
}

export async function onWindowChange(fn: () => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  const a = await w.onMoved(fn);
  const b = await w.onResized(fn);
  return () => (a(), b());
}

export async function setVisible(show: boolean) {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (show) {
    await w.show();
    await w.setFocus();
  } else await w.hide();
}

/** visible and frontmost? (⌥Y / the tray icon bring a buried window forward instead of hiding it) */
export async function isFrontmost(): Promise<boolean> {
  if (!isTauri) return document.hasFocus();
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  return (await w.isVisible()) && (await w.isFocused());
}

export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const DIR = { n: 'North', s: 'South', e: 'East', w: 'West', ne: 'NorthEast', nw: 'NorthWest', se: 'SouthEast', sw: 'SouthWest' } as const;
/**
 * Hand an edge / title-bar drag to the OS (the window has no native frame). The OS call that resizes by an edge is
 * not available on macOS, so there the pointer is followed by hand (setSize / setPosition, one step per frame).
 */
export async function startDrag(kind: Edge | 'move', ev?: PointerEvent) {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (kind === 'move') return void (await w.startDragging());
  if (!isMac || !ev) return void (await w.startResizeDragging(DIR[kind] as never));
  const { LogicalPosition, LogicalSize } = await import('@tauri-apps/api/dpi');
  const f = await w.scaleFactor();
  const pos = (await w.outerPosition()).toLogical(f);
  const size = (await w.outerSize()).toLogical(f);
  const min = { w: 300, h: 72 };
  const x0 = ev.screenX;
  const y0 = ev.screenY;
  let want: PointerEvent | null = null;
  let busy = false;
  const step = async () => {
    if (busy || !want) return;
    busy = true;
    const e = want;
    want = null;
    const dx = e.screenX - x0;
    const dy = e.screenY - y0;
    let { x, y } = pos;
    let { width, height } = size;
    if (kind.includes('e')) width = Math.max(min.w, size.width + dx);
    if (kind.includes('s')) height = Math.max(min.h, size.height + dy);
    if (kind.includes('w')) {
      width = Math.max(min.w, size.width - dx);
      x = pos.x + size.width - width;
    }
    if (kind.includes('n')) {
      height = Math.max(min.h, size.height - dy);
      y = pos.y + size.height - height;
    }
    await Promise.all([w.setSize(new LogicalSize(width, height)), w.setPosition(new LogicalPosition(x, y))]);
    busy = false;
    if (want) void step();
  };
  const move = (e: PointerEvent) => ((want = e), void step());
  const up = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

export const setBadge = (count: number) => isTauri && invoke('set_badge', { count }).catch(() => {});
export const showCapture = () => isTauri && invoke('show_capture').catch(() => {});

/* ---------- AI transport ---------- */
declare const __WEB_AI__: { configured: boolean; model: string; effort: string };
/** browser build: what the dev proxy was started with (app/.env) */
export const WEB_AI = typeof __WEB_AI__ !== 'undefined' ? __WEB_AI__ : { configured: false, model: 'gpt-4.1-mini', effort: '' };

export interface KeyStatus {
  configured: boolean;
  source: 'env' | 'keychain' | null;
}
export async function aiKeyStatus(): Promise<KeyStatus> {
  if (!isTauri) return { configured: WEB_AI.configured, source: WEB_AI.configured ? 'env' : null };
  return invoke<KeyStatus>('ai_key_status');
}
export const aiSetKey = (key: string) => invoke<KeyStatus>('ai_set_key', { key });

/** POST to the OpenAI API; the key is added outside the page (Rust in the app, the dev proxy in a browser) */
export async function aiPost(path: string, body: string, baseUrl: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; data: any }> {
  if (!isTauri) {
    const res = await fetch(`/api/openai/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  }
  // the request itself cannot be cancelled across the bridge; an abort just stops waiting for it
  const call = invoke<{ status: number; body: string }>('ai_post', { baseUrl, path, body });
  const aborted = new Promise<never>((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true }));
  const r = await Promise.race([call, aborted]);
  let data: any = null;
  try {
    data = JSON.parse(r.body);
  } catch {
    /* not json */
  }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, data };
}

/* ---------- plugins: requests and tokens go through Rust (src-tauri/src/plugin.rs) ---------- */
export interface SecretStatus {
  configured: boolean;
  host: string | null;
}
export const pluginSecretStatus = (plugin: string): Promise<SecretStatus> =>
  isTauri ? invoke<SecretStatus>('plugin_secret_status', { plugin }) : Promise.resolve({ configured: false, host: null });
/** store the token for `host` (empty token: remove it); it is not readable from the page afterwards */
export const pluginSecretSet = (plugin: string, host: string, token: string) => invoke<SecretStatus>('plugin_secret_set', { plugin, host, token });

/** GET the url stored as the plugin's secret (never readable from the page) */
export const pluginGetSecretUrl = (plugin: string) => invoke<HttpRes>('plugin_get_secret_url', { plugin });

export interface HttpRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}
/** an https request made by Rust; `auth` adds the plugin's token (only to the host it was stored for) */
export async function pluginHttp(plugin: string, req: { method?: string; url: string; headers?: Record<string, string>; body?: string; auth?: boolean }): Promise<HttpRes> {
  if (!isTauri) throw new Error('This source needs the desktop app');
  return invoke<HttpRes>('plugin_http', { req: { plugin, method: req.method, url: req.url, headers: req.headers, body: req.body, auth: !!req.auth } });
}

/* ---------- links ---------- */
export const openUrl = (url: string) => (isTauri ? invoke('open_url', { url }) : Promise.resolve(void window.open(url, '_blank', 'noreferrer')));

/**
 * Links in the app: ⌘-click (Ctrl-click) opens one in the system browser; a plain click never navigates the webview
 * (it keeps doing what it did: selecting the row). Desktop app only; a browser handles its own links.
 */
export function openLinksWithModifier() {
  if (!isTauri) return;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !/^https?:/i.test(a.href)) return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        e.stopPropagation();
        void openUrl(a.href).catch(() => {});
      }
    },
    true,
  );
}
