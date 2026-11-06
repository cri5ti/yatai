import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Desktop } from './Desktop';
import { Controls } from './Controls';
import { get, useS } from './store';
import { openCapture, setClock, setTab, toggleHidden, closeCapture } from './actions';

function App() {
  const s = useS();

  useEffect(() => {
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  }, [s.dark]);

  // mock clock
  useEffect(() => {
    if (!s.clockSpeed) return;
    const t = setInterval(() => setClock(Math.min(23 * 60, get().clock + get().clockSpeed / 2)), 500);
    return () => clearInterval(t);
  }, [s.clockSpeed]);

  // mock global hotkeys
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === ' ') (e.preventDefault(), get().capture ? closeCapture() : openCapture());
      else if (e.key.toLowerCase() === 'y') (e.preventDefault(), toggleHidden());
      else if (e.key === '1') (e.preventDefault(), setTab('today'));
      else if (e.key === '2') (e.preventDefault(), setTab('inbox'));
      else if (e.key === '3') (e.preventDefault(), setTab('organizer'));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="shell">
      <Desktop />
      <Controls />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
