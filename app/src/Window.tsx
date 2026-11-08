import { useEffect, useRef, useState } from 'react';
import { get, useS } from './store';
import type { Layout, State, Tab } from './store';
import { Next } from './Next';
import { Inbox } from './Inbox';
import { Organizer } from './Organizer';
import { Focus } from './Focus';
import { Menu } from './Menu';
import { AiPop, ProposalBar } from './AiPop';
import { capture, closeCapture, setBounds, dismissToast, openDrawer, openSettings, redo, setDensity, setLayout, setScale, setTab, toggleHelp, toggleHidden, undo } from './actions';
import { DENSITIES, SCALES } from './store';
import { Drawer } from './Drawer';
import { GhIcon } from './Pr';
import { Settings } from './Settings';
import { DevPanel } from './Controls';
import { applyLayout, isApplying, isMac, isTauri, onWindowChange, setBadge, setVisible, startDrag, windowRect } from './platform';
import type { Edge } from './platform';

/** the Organizer is the full-width app: from the thin dock it expands (animated) to fill the screen */
export const effLayout = (s: State): Layout => (s.focus ? 'pill' : s.tab === 'organizer' && s.layout === 'dock' ? 'max' : s.layout);

const DIRS: Record<string, Edge[]> = { dock: ['w'], float: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'], max: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] };

/**
 * The OS window follows the layout: placed and sized when the layout changes (or a focus session ends and the pill grows),
 * and whatever the user drags it to is remembered per layout. Visibility follows `hidden` (tray, ⌥Y, ✕).
 */
function useOsWindow() {
  const s = useS();
  const layout = effLayout(s);
  const ended = !!s.focus?.ended;
  const shown = useRef(false);
  useEffect(() => {
    void applyLayout(layout, get().bounds, ended).then(() => {
      if (!shown.current && !get().hidden) {
        shown.current = true;
        void setVisible(true);
      }
    });
  }, [layout, ended]);
  useEffect(() => void (shown.current && setVisible(!s.hidden)), [s.hidden]);
  // remember a move / resize the user made (not the ones applyLayout makes)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    let off: (() => void) | undefined;
    void onWindowChange(() => {
      if (isApplying()) return;
      clearTimeout(t);
      t = setTimeout(async () => {
        const l = effLayout(get());
        const r = await windowRect();
        if (!r || isApplying() || (l !== 'dock' && l !== 'float' && l !== 'max')) return;
        if (l !== 'dock') return setBounds(l, r);
        // the dock keeps only its width: it goes straight back to the right edge, full height
        setBounds(l, { ...r, x: 0, y: 0 });
        void applyLayout('dock', get().bounds, false);
      }, 300);
    }).then((u) => (off = u));
    return () => (clearTimeout(t), off?.());
  }, []);
  useEffect(() => void setBadge(s.inbox.length), [s.inbox.length]);
}

/* ---------- the yatai window ---------- */
function Win() {
  const s = useS();
  const layout = effLayout(s);
  useOsWindow();
  const key = isTauri && (layout === 'dock' || layout === 'float' || layout === 'max') ? layout : null;
  const edges = key && !isMac ? DIRS[key] : [];
  /** edges and the title bar are handed to the OS: it resizes / moves the frameless window */
  const drag = (kind: Edge | 'move') => (e: React.PointerEvent) => {
    if (e.button !== 0 || !key) return;
    if (kind === 'move' && ((e.target as HTMLElement).closest('button, .tabs') || key === 'dock')) return;
    e.preventDefault();
    void startDrag(kind);
  };
  const pill = layout === 'pill';
  const endedFocus = !!s.focus?.ended;
  const cycle: Layout[] = ['dock', 'float', 'max', 'pill'];
  const tabs: { id: Tab; label: string }[] = [
    { id: 'next', label: 'Next' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'organizer', label: 'Organizer' },
  ];

  return (
    <div className={`win layout-${layout} ${endedFocus ? 'ended' : ''} ${s.hidden && !isTauri ? 'hidden' : ''}`}>
      {key && edges.map((d) => <div key={d} className={`rz rz-${d}`} data-rz={d} onPointerDown={drag(d)} onDoubleClick={() => resetBounds(key)} title="Drag to resize (double-click resets)" />)}
      {!pill && (
        <div className="titlebar" onPointerDown={drag('move')} onDoubleClick={(e) => key && !(e.target as HTMLElement).closest('button') && resetBounds(key)}>
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
            <button title="Settings (⌘,)" aria-label="Settings" onClick={openSettings}>
              ⚙
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
      {!pill && !s.ai && <ProposalBar />}
      {!pill && (
        <div className="uibar" role="toolbar" aria-label="Sources and display">
          <div className="ugrp drawers" role="group" aria-label="Sources">
            <button className={s.drawer?.kind === 'outlook' ? 'on' : ''} aria-pressed={s.drawer?.kind === 'outlook'} title="Outlook — bring meetings in" onClick={() => openDrawer('outlook')}>
              <span aria-hidden>📅</span> Outlook
            </button>
            <button className={s.drawer?.kind === 'github' ? 'on' : ''} aria-pressed={s.drawer?.kind === 'github'} title="GitHub — bring pull requests in" onClick={() => openDrawer('github')}>
              <GhIcon /> GitHub
            </button>
            <button className={s.drawer?.kind === 'devops' ? 'on' : ''} aria-pressed={s.drawer?.kind === 'devops'} title="DevOps — bring work items in" onClick={() => openDrawer('devops')}>
              <span aria-hidden>◈</span> DevOps
            </button>
          </div>
          <span className="grow" />
          <div className="ugrp" role="group" aria-label="Scale">
            {SCALES.map((v, i) => (
              <button key={v} className={s.scale === i ? 'on' : ''} aria-pressed={s.scale === i} title={`Scale ${Math.round(v * 100)}%`} aria-label={`Scale ${Math.round(v * 100)}%`} onClick={() => setScale(i)}>
                {Math.round(v * 100)}
              </button>
            ))}
          </div>
          <div className="ugrp" role="group" aria-label="Density">
            {DENSITIES.map((_, i) => (
              <button key={i} className={s.density === i ? 'on' : ''} aria-pressed={s.density === i} title={['Tight', 'Normal', 'Roomy'][i] + ' rows'} aria-label={['Tight', 'Normal', 'Roomy'][i] + ' rows'} onClick={() => setDensity(i)}>
                <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden>
                  {[0, 1, 2].map((k) => (
                    <rect key={k} x="0" y={[0.5, 3.5, 6.5][k] + (i - 1) * (k - 1) * -1.2} width="12" height="1.4" rx=".7" fill="currentColor" />
                  ))}
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
      {!pill && <Drawer />}
      {s.aiBusy && <div className="aibusy">✨ {s.aiBusy}</div>}
    </div>
  );
}

/** double-click an edge / the title bar: back to where the layout puts the window by default */
function resetBounds(key: 'dock' | 'float' | 'max') {
  setBounds(key, null);
  void applyLayout(key, get().bounds, false);
}

/* ---------- quick capture inside the window (browser build; the app has its own capture window, ⌥Space) ---------- */
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
      ['⌥Space', 'Quick capture into the Inbox — from any app'],
      ['⌥Y', 'Show / hide yatai — from any app (or click the tray icon)'],
      ['⌘1 ⌘2 ⌘3', 'Next · Inbox · Organizer'],
      ['⌘,', 'Settings (AI key and model)'],
      ['↑ ↓ ← →', 'Navigate everything'],
      ['⏎  ·  ⇧⏎', 'Add a new item below · above the selection (⏎ again keeps adding; ⏎ or Esc on a blank field stops)'],
      ['⌘↑ ⌘↓', 'Reorder (animated) — or drag'],
      ['⇧← ⇧→', 'Scroll the estimate (5m · 15m · 30m · 1h · 2h · 4h · 8h)'],
      ['/  or right-click', 'Commands: /consolidate /abandon /due /reschedule /tomorrow /estimate /duplicate /ai'],
      ['−  +', 'Collapse / expand everything'],
      ['⌘Z  ⌘⇧Z', 'Undo / redo — every change goes through the undo manager'],
      ['⌘/', 'Ask AI — its changes come back as a purple proposal'],
      ['⌘⏎  ·  ⌘⌫', 'Accept · reject the AI proposal'],
      ['?', 'This sheet'],
    ],
  ],
  [
    'Next',
    [
      ['↑ ↓', 'Move across tasks · → goes into its actions · ← back to the task'],
      ['⇧Space', 'Start / pause the action (on a task: its first action) — stopwatch, moves it to the top'],
      ['F2  or R', 'Edit (⇧⏎ inside the editor for a new line)'],
      ['Space', 'Complete just this item — its children keep their own state'],
      ['↑ / ↓', 'Always the next item you can see — children included'],
      ['⇧↑ ⇧↓ · ⇧click · ⌘click', 'Multi-select, then Space / ⌘[ ⌘] / ⌘↑↓ / ⌫ act on all of them'],
      ['⌘⇧⏎  or F', 'Start in focus mode'],
      ['Space', 'Toggle done (just a marker — nothing disappears)'],
      ['→ / ←', 'On an action: expand / collapse its notes · on a task: expand / collapse the task'],
      ['⌘↑ ⌘↓ on an action', 'Reorder inside the task; past the edge it splits out into its own card'],
      ['Drag a sub-item out', 'Splits it into its own card, its parent repeated as the header — drag it back onto the parent (or /consolidate) to merge'],
      ['E', 'Estimate picker: 1=5m 2=15m 3=30m 4=1h 5=2h 6=4h 8=8h'],
    ],
  ],
  [
    'Organizer · Inbox',
    [
      ['A  N  ⇧N', 'Organizer: add child · sibling · project'],
      ['T', 'Organizer: put in / take out of Next'],
      ['F · A · S', 'Inbox: file into… · accept AI suggestion · suggest (⇧S all)'],
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

export function Shell() {
  const s = useS();
  return (
    <div className="desktop">
      <Win />
      {!isTauri && <Capture />}
      <Menu />
      <AiPop />
      <Help />
      <Settings />
      {s.dev && <DevPanel />}

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
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
