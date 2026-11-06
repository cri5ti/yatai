import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import type { Layout, State, Tab } from './store';
import { Next } from './Next';
import { Inbox } from './Inbox';
import { Organizer } from './Organizer';
import { Focus } from './Focus';
import { Menu } from './Menu';
import { AiPop } from './AiPop';
import { capture, closeCapture, dismissToast, redo, setLayout, setTab, toggleHelp, toggleHidden, undo } from './actions';
import { fmt, meetingsFor } from './model';

export const effLayout = (s: State): Layout => (s.focus ? 'pill' : s.layout);

/* ---------- the yatai window ---------- */
function Win() {
  const s = useS();
  const layout = effLayout(s);
  const pill = layout === 'pill';
  const endedFocus = !!s.focus?.ended;
  const cycle: Layout[] = ['dock', 'float', 'max', 'pill'];
  const tabs: { id: Tab; label: string }[] = [
    { id: 'next', label: 'Next' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'organizer', label: 'Organizer' },
  ];

  return (
    <div className={`win layout-${layout} ${endedFocus ? 'ended' : ''} ${s.hidden ? 'hidden' : ''}`}>
      {!pill && (
        <div className="titlebar">
          <nav className="tabs" role="tablist" aria-label="Views">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={s.tab === t.id}
                className={s.tab === t.id ? 'on' : ''}
                title={`${t.label} (⌘${i + 1})`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
                    setTab(n);
                    requestAnimationFrame(() => (document.querySelectorAll('.tabs button')[tabs.findIndex((x) => x.id === n)] as HTMLElement)?.focus());
                  }
                }}
              >
                {t.label}
                {t.id === 'inbox' && s.inbox.length > 0 && <b className="badge">{s.inbox.length}</b>}
                {layout !== 'dock' && <kbd>⌘{i + 1}</kbd>}
              </button>
            ))}
          </nav>
          <div className="wc">
            <button title={s.past.length ? `Undo: ${s.past[s.past.length - 1].label} (⌘Z)` : 'Nothing to undo'} aria-label="Undo" disabled={!s.past.length} onClick={undo}>
              ↶
            </button>
            <button title={s.future.length ? `Redo: ${s.future[0].label} (⌘⇧Z)` : 'Nothing to redo'} aria-label="Redo" disabled={!s.future.length} onClick={redo}>
              ↷
            </button>
            <button title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={toggleHelp}>
              ?
            </button>
            <button title="Cycle layout" aria-label="Cycle layout" onClick={() => setLayout(cycle[(cycle.indexOf(s.layout) + 1) % cycle.length])}>
              ⧉
            </button>
            <button title="Hide to tray" aria-label="Hide to tray" onClick={toggleHidden}>
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="content">
        {pill ? <Focus /> : s.tab === 'next' ? <Next /> : s.tab === 'inbox' ? <Inbox /> : <Organizer />}
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

const HELP: [string, [string, string][]][] = [
  [
    'Everywhere',
    [
      ['⌘1 ⌘2 ⌘3', 'Next · Inbox · Organizer (Alt+1/2/3 also works in a browser)'],
      ['↑ ↓ ← →', 'Navigate everything'],
      ['⌘⏎', 'Create a new thing right here (⏎ or Esc on a blank field cancels)'],
      ['⌘↑ ⌘↓', 'Reorder (animated) — or drag'],
      ['⇧← ⇧→', 'Scroll the estimate (5m · 15m · 30m · 1h · 2h · 4h · 8h)'],
      ['/  or right-click', 'Commands: /consolidate /abandon /due /reschedule /tomorrow /estimate /duplicate /ai'],
      ['⌘Z  ⌘⇧Z', 'Undo / redo — every change goes through the undo manager'],
      ['⌘/', 'Ask AI'],
      ['?', 'This sheet'],
    ],
  ],
  [
    'Next',
    [
      ['↑ ↓', 'Move across tasks · → goes into its actions · ← back to the task'],
      ['⏎', 'Start the action (on a task: its first action) — starts a stopwatch, moves it to the top'],
      ['⌘⇧⏎  or F', 'Start in focus mode'],
      ['Space', 'Toggle done (just a marker — nothing disappears)'],
      ['→ / ←', 'On an action: expand / collapse its notes · on a task: expand / collapse the task'],
      ['⌘↑ ⌘↓ on an action', 'Reorder inside the task; past the edge it splits out into its own card'],
      ['R / F2', 'Edit (⇧⏎ for a new line)'],
      ['E', 'Estimate picker: 1=5m 2=15m 3=30m 4=1h 5=2h 6=4h 8=8h'],
    ],
  ],
  [
    'Organizer · Inbox',
    [
      ['A  N  ⇧N', 'Organizer: add child · sibling · project'],
      ['T', 'Organizer: put in / take out of Next'],
      ['⏎ · A · S', 'Inbox: file into… · accept AI suggestion · suggest'],
    ],
  ],
];

function Help() {
  const s = useS();
  if (!s.help) return null;
  return (
    <div className="ai-veil" onMouseDown={toggleHelp}>
      <div
        className="help"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') (e.preventDefault(), e.stopPropagation(), toggleHelp());
        }}
      >
        <h3>Keyboard shortcuts</h3>
        {HELP.map(([group, rows]) => (
          <div key={group}>
            <div className="lh">{group}</div>
            {rows.map(([k, d]) => (
              <div key={k} className="hrow">
                <kbd>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
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
      <Menu />
      <AiPop />
      <Help />

      <div className="toasts">
        {s.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.tone}`}
            onClick={() => {
              setTab('next');
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
