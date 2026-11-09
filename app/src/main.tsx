import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles.css';
import { Shell } from './Window';
import { DENSITIES, SCALES, get, set, useS } from './store';
import { acceptAi, capture, openMdEdit, highlight, closeCapture, openAi, closeAi, openCapture, openSettings, rejectAi, redo, rollDay, setClock, setTab, tickClock, toast, toggleDev, toggleHelp, toggleHidden, undo } from './actions';
import { isEditable, mod } from './kbd';
import { flush, loadState } from './persist';
import { refreshAiKey } from './ai';
import { startPopups } from './popups';
import { startTracker } from './plugins/tracker';
import { invoke, isFrontmost, isTauri, listen, openLinksWithModifier, setVisible } from './platform';

function App() {
  const s = useS();

  useEffect(() => {
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
    try {
      localStorage.setItem('yatai-theme', s.dark ? 'dark' : 'light'); // the capture window reads it
    } catch {
      /* ignore */
    }
  }, [s.dark]);

  // real time: the clock follows the time of day, and a new day rolls over
  useEffect(() => {
    tickClock();
    const t = setInterval(tickClock, 15_000);
    const wake = () => document.visibilityState === 'visible' && tickClock();
    document.addEventListener('visibilitychange', wake);
    return () => (clearInterval(t), document.removeEventListener('visibilitychange', wake));
  }, []);

  // the shell: tray, global hotkeys, the capture window, quitting
  useEffect(() => {
    const offs = [
      listen('yatai://toggle', async () => {
        // a window that is open but buried comes forward; a frontmost one goes away
        if (!get().hidden && !(await isFrontmost())) return void setVisible(true);
        toggleHidden();
      }),
      listen('yatai://show', () => set(() => ({ hidden: false }))),
      listen('yatai://hide', () => (set(() => ({ hidden: true })), void flush())),
      listen('yatai://settings', openSettings),
      listen('yatai://dev', toggleDev),
      listen<string>('yatai://captured', (text) => {
        if (!text.trim()) return;
        capture(text);
        toast('Captured to the Inbox', 'good');
      }),
      listen('yatai://quit', async () => {
        await flush();
        await invoke('quit');
      }),
    ];
    const save = () => void flush();
    window.addEventListener('blur', save);
    window.addEventListener('beforeunload', save);
    return () => {
      offs.forEach((o) => void o.then((f) => f()));
      window.removeEventListener('blur', save);
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  // scale + density are plain CSS variables
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(SCALES[s.scale] ?? 1));
    document.documentElement.style.setProperty('--dens', String(DENSITIES[s.density] ?? 1));
    // the layout just changed shape without anything "moving": let the animation snapshots catch up
    requestAnimationFrame(() => window.dispatchEvent(new Event('flip-resync')));
  }, [s.scale, s.density]);

  // developer panel: a simulated clock
  useEffect(() => {
    if (!s.clockSpeed) return;
    const t = setInterval(() => setClock(Math.min(23 * 60, get().clock + get().clockSpeed / 2)), 500);
    return () => clearInterval(t);
  }, [s.clockSpeed]);

  // global shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const M = mod(e);
      const k = e.key;
      const tabs = ['next', 'inbox', 'organizer'] as const;
      // browser build: stand-ins for the OS-level global hotkeys (the app registers real ones)
      if (e.altKey && !M && !isTauri) {
        if (k === ' ') return (e.preventDefault(), get().capture ? closeCapture() : openCapture());
        if (k.toLowerCase() === 'y' || k === '¥') return (e.preventDefault(), toggleHidden());
        const code = e.code.replace('Digit', '');
        if (['1', '2', '3'].includes(code)) return (e.preventDefault(), setTab(tabs[+code - 1]));
        return;
      }
      if (M && !e.altKey && get().proposal) {
        // a pending AI proposal: ⌘⏎ accepts, ⌘⌫ rejects (but ⌘⌫ still edits a text field that has text)
        const t = e.target as HTMLInputElement | null;
        if (k === 'Enter') return (e.preventDefault(), e.stopPropagation(), acceptAi());
        if (k === 'Backspace' && !(isEditable(t) && t?.value)) return (e.preventDefault(), e.stopPropagation(), rejectAi());
      }
      if (M && !e.altKey) {
        if (['1', '2', '3'].includes(k)) return (e.preventDefault(), setTab(tabs[+k - 1]));
        if (k === ',') return (e.preventDefault(), openSettings());
        if (e.shiftKey && k.toLowerCase() === 'd') return (e.preventDefault(), toggleDev());
        if (k === '/') return (e.preventDefault(), get().ai ? closeAi() : openAi(contextId()));
        if (k.toLowerCase() === 'e' && !e.shiftKey && !isEditable(e.target)) return (e.preventDefault(), openMdEdit());
        if (k.toLowerCase() === 'e' && e.shiftKey && !isEditable(e.target)) return (e.preventDefault(), openMdEdit(true));
        if (isEditable(e.target)) return; // let text fields keep their own undo
        if (k.toLowerCase() === 'z') return (e.preventDefault(), e.shiftKey ? redo() : undo());
        if (k.toLowerCase() === 'y') return (e.preventDefault(), redo());
        return;
      }
      if (k === '?' && !isEditable(e.target) && !M) (e.preventDefault(), toggleHelp());
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  return (
    <div className="shell">
      <Shell />
    </div>
  );
}

/** ⌘/ asks about whatever is selected */
function contextId(): string | undefined {
  const s = get();
  if (s.tab === 'organizer') return s.sel ?? undefined;
  if (s.tab === 'next') return s.nsel.row && !s.nsel.row.startsWith('fx_') ? s.nsel.row : undefined;
  return undefined;
}

async function boot() {
  try {
    await loadState();
  } catch (e) {
    console.error('yatai: could not load the database', e);
    document.body.textContent = `yatai could not open its database: ${String(e)}`;
    if (isTauri) void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show());
    return;
  }
  rollDay();
  void refreshAiKey();
  startPopups();
  openLinksWithModifier();
  startTracker({ toast, highlight });
  if (isTauri)
    void invoke<string[]>('shortcuts_taken').then((t) => t.length && toast(`${t.join(' and ')} ${t.length > 1 ? 'are' : 'is'} used by another app — use the tray icon instead`, 'warn'));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
