import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles.css';
import { Desktop } from './Desktop';
import { Controls } from './Controls';
import { DENSITIES, SCALES, get, useS } from './store';
import { closeCapture, openAi, closeAi, openCapture, redo, setClock, setTab, toggleHelp, toggleHidden, undo } from './actions';
import { isEditable, mod } from './kbd';

function App() {
  const s = useS();

  useEffect(() => {
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  }, [s.dark]);

  // scale + density are plain CSS variables
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(SCALES[s.scale] ?? 1));
    document.documentElement.style.setProperty('--dens', String(DENSITIES[s.density] ?? 1));
    // the layout just changed shape without anything "moving": let the animation snapshots catch up
    requestAnimationFrame(() => window.dispatchEvent(new Event('flip-resync')));
  }, [s.scale, s.density]);

  // mock clock
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
      // mock of OS-level global hotkeys (Alt)
      if (e.altKey && !M) {
        if (k === ' ') return (e.preventDefault(), get().capture ? closeCapture() : openCapture());
        if (k.toLowerCase() === 'y' || k === '¥') return (e.preventDefault(), toggleHidden());
        const code = e.code.replace('Digit', '');
        if (['1', '2', '3'].includes(code)) return (e.preventDefault(), setTab(tabs[+code - 1]));
        return;
      }
      if (M && !e.altKey) {
        if (['1', '2', '3'].includes(k)) return (e.preventDefault(), setTab(tabs[+k - 1]));
        if (k === '/') return (e.preventDefault(), get().ai ? closeAi() : openAi(contextId()));
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
      <Desktop />
      <Controls />
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
