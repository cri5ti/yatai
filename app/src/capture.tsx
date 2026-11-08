import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles.css';
import { emitTo, listen } from './platform';

/**
 * The quick-capture window (⌥Space from anywhere). It is its own small window, so it can pop up over any app
 * without bringing yatai forward; the text is sent to the main window, which adds it to the Inbox.
 */
async function hide() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

function Capture() {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const theme = () => {
    try {
      document.documentElement.dataset.theme = localStorage.getItem('yatai-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    theme();
    const opened = listen('yatai://capture-open', () => {
      theme();
      setText('');
      requestAnimationFrame(() => ref.current?.focus());
    });
    // clicking elsewhere puts it away (what was typed is kept for next time)
    const blur = () => void hide();
    window.addEventListener('blur', blur);
    return () => (void opened.then((f) => f()), window.removeEventListener('blur', blur));
  }, []);
  return (
    <div className="capture-pop capture-win">
      <div className="cp-label">Quick capture → Inbox</div>
      <input
        ref={ref}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (text.trim()) await emitTo('main', 'yatai://captured', text);
            setText('');
            await hide();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            await hide();
          }
        }}
      />
      <div className="cp-hint">⏎ save · Esc cancel</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Capture />
  </StrictMode>,
);
