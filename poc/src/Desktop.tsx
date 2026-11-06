import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import type { Layout, State } from './store';
import { Today } from './Today';
import { Inbox } from './Inbox';
import { Organizer } from './Organizer';
import { Focus } from './Focus';
import { capture, closeCapture, dismissToast, setLayout, setTab, toggleHidden } from './actions';
import { fmt, meetingsFor } from './model';

export const effLayout = (s: State): Layout => (s.focus ? 'pill' : s.layout);

/* ---------- the yatai window ---------- */
function Win() {
  const s = useS();
  const layout = effLayout(s);
  const pill = layout === 'pill';
  const endedFocus = !!s.focus?.ended;
  const cycle: Layout[] = ['dock', 'float', 'max', 'pill'];

  return (
    <div className={`win layout-${layout} ${endedFocus ? 'ended' : ''} ${s.hidden ? 'hidden' : ''}`}>
      {!pill && (
        <div className="titlebar">
          <span className="logo">◆ yatai</span>
          <nav className="tabs">
            <button className={s.tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>
              Today
            </button>
            <button className={s.tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>
              Inbox{s.inbox.length > 0 && <b className="badge">{s.inbox.length}</b>}
            </button>
            <button className={s.tab === 'organizer' ? 'on' : ''} onClick={() => setTab('organizer')}>
              Organizer
            </button>
          </nav>
          <div className="wc">
            <button title="Cycle layout" onClick={() => setLayout(cycle[(cycle.indexOf(s.layout) + 1) % cycle.length])}>
              ⧉
            </button>
            <button title="Hide to tray" onClick={toggleHidden}>
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="content">
        {pill ? <Focus /> : s.tab === 'today' ? <Today /> : s.tab === 'inbox' ? <Inbox /> : <Organizer />}
      </div>
      {s.aiBusy && <div className="aibusy">✨ {s.aiBusy}</div>}
    </div>
  );
}

/* ---------- fake desktop apps (decorative, data-driven) ---------- */
function OutlookWin() {
  const s = useS();
  const ms = meetingsFor(s);
  return (
    <div className="app outlook">
      <div className="app-title">📅 Outlook — Calendar</div>
      <div className="app-body">
        {ms.map((m) => (
          <div key={m.id} className={`ev ${m.state}`}>
            <b>{fmt(m.eff)}</b> {m.title}
            {m.movedFrom != null && <i> (moved)</i>}
          </div>
        ))}
      </div>
    </div>
  );
}
function CodeWin() {
  return (
    <div className="app code">
      <div className="app-title">⌨ VS Code — staff-service</div>
      <div className="app-body mono">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="codeline" style={{ width: `${30 + ((i * 37) % 55)}%`, marginLeft: (i % 3) * 14 }} />
        ))}
      </div>
    </div>
  );
}

/* ---------- global capture popup (mock of the global hotkey window) ---------- */
function Capture() {
  const s = useS();
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (s.capture) ref.current?.focus();
    else setText('');
  }, [s.capture]);
  if (!s.capture) return null;
  return (
    <div className="capture-pop">
      <div className="cp-label">Quick capture → Inbox</div>
      <input
        ref={ref}
        placeholder="What's on your mind?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            capture(text);
            closeCapture();
          }
          if (e.key === 'Escape') closeCapture();
        }}
      />
      <div className="cp-hint">Enter to save · Esc to cancel</div>
    </div>
  );
}

export function Desktop() {
  const s = useS();
  const att = s.inbox.length;
  const nextM = meetingsFor(s).find((m) => m.state !== 'done');
  return (
    <div className="desktop">
      {s.showApps && (
        <>
          <OutlookWin />
          <CodeWin />
        </>
      )}
      <Win />
      <Capture />

      <div className="toasts">
        {s.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.tone}`}
            onClick={() => {
              setTab('today');
              dismissToast(t.id);
            }}
          >
            <b>yatai</b>
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      <div className="taskbar">
        <div className="tb-left">⊞</div>
        <div className="tb-mid">
          <button className={`tray ${s.hidden ? '' : 'on'}`} onClick={toggleHidden} title="yatai (click to show/hide)">
            ◆ {att > 0 && <b className="badge">{att}</b>}
          </button>
        </div>
        <div className="tb-right">
          {nextM && <span className="tb-next">next: {fmt(nextM.eff)}</span>}
          <span className="tb-clock">{fmt(s.clock)}</span>
        </div>
      </div>
    </div>
  );
}
