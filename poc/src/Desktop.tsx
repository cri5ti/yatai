import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { quietFlip } from './flip';
import { useS } from './store';
import type { Layout, State, Tab } from './store';
import { Next } from './Next';
import { Inbox } from './Inbox';
import { Organizer } from './Organizer';
import { Focus } from './Focus';
import { Menu } from './Menu';
import { AiPop, ProposalBar } from './AiPop';
import { capture, closeCapture, setBounds, dismissToast, openDrawer, redo, setDensity, setLayout, setScale, setTab, toggleHelp, toggleHidden, undo } from './actions';
import { CALENDAR, DENSITIES, SCALES } from './store';
import { Drawer } from './Drawer';
import { GhIcon } from './Pr';
import { fmt, meetingsFor } from './model';

/** the Organizer is the full-width app: from the thin dock it expands (animated) to fill the screen */
export const effLayout = (s: State): Layout => (s.focus ? 'pill' : s.tab === 'organizer' && s.layout === 'dock' ? 'max' : s.layout);

const MIN_W = 320;
const MIN_H = 280;
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const DIRS: Record<string, Dir[]> = { dock: ['w'], float: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'], max: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] };

/** drag an edge/corner to resize (dock: its left edge) and the title bar to move (float / max).
 *  Works on the DOM while dragging (no re-render per pixel), then saves the rect; double-click an edge resets it. */
function useWindowDrag(win: React.RefObject<HTMLDivElement>, key: 'dock' | 'float' | 'max' | null) {
  return (kind: Dir | 'move') => (e: React.PointerEvent) => {
    const el = win.current;
    const host = el?.offsetParent as HTMLElement | null;
    if (!el || !host || !key || e.button !== 0) return;
    if (kind === 'move' && ((e.target as HTMLElement).closest('button, .tabs') || key === 'dock')) return;
    e.preventDefault();
    const pw = host.clientWidth;
    const ph = host.clientHeight;
    const r0 = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const p0 = { x: e.clientX, y: e.clientY };
    let r = { ...r0 };
    el.classList.add('resizing', kind === 'move' ? 'moving' : 'resizing');
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const apply = (ev: PointerEvent) => {
      const dx = ev.clientX - p0.x;
      const dy = ev.clientY - p0.y;
      let { x, y, w, h } = r0;
      if (kind === 'move') {
        x = clamp(x + dx, 0, pw - w);
        y = clamp(y + dy, 0, ph - h);
      } else {
        if (kind.includes('e')) w = clamp(r0.w + dx, MIN_W, pw - r0.x);
        if (kind.includes('s')) h = clamp(r0.h + dy, MIN_H, ph - r0.y);
        if (kind.includes('w')) {
          const right = r0.x + r0.w;
          w = clamp(r0.w - dx, MIN_W, key === 'dock' ? pw : right);
          x = right - w;
        }
        if (kind.includes('n')) {
          const bottom = r0.y + r0.h;
          h = clamp(r0.h - dy, MIN_H, bottom);
          y = bottom - h;
        }
      }
      r = { x, y, w, h };
      if (key === 'dock') document.documentElement.style.setProperty('--dock-w', `${w}px`);
      else Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };
    const up = () => {
      window.removeEventListener('pointermove', apply);
      window.removeEventListener('pointerup', up);
      el.classList.remove('resizing', 'moving');
      quietFlip(500);
      setBounds(key, r);
    };
    window.addEventListener('pointermove', apply);
    window.addEventListener('pointerup', up);
  };
}

/* ---------- the yatai window ---------- */
function Win() {
  const s = useS();
  const layout = effLayout(s);
  const winRef = useRef<HTMLDivElement>(null);
  const key = layout === 'dock' || layout === 'float' || layout === 'max' ? layout : null;
  const bnd = key ? s.bounds[key] : undefined;
  const drag = useWindowDrag(winRef, key);
  useLayoutEffect(() => {
    // the dock width lives in a CSS variable (the toasts keep clear of it too)
    if (key === 'dock' && bnd) document.documentElement.style.setProperty('--dock-w', `${bnd.w}px`);
    else document.documentElement.style.removeProperty('--dock-w');
  }, [key, bnd?.w]);
  const style: React.CSSProperties | undefined = bnd && key && key !== 'dock' ? { left: bnd.x, top: bnd.y, width: bnd.w, height: bnd.h } : undefined;
  const pill = layout === 'pill';
  const endedFocus = !!s.focus?.ended;
  const cycle: Layout[] = ['dock', 'float', 'max', 'pill'];
  const tabs: { id: Tab; label: string }[] = [
    { id: 'next', label: 'Next' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'organizer', label: 'Organizer' },
  ];

  return (
    <div ref={winRef} style={style} className={`win layout-${layout} ${endedFocus ? 'ended' : ''} ${s.hidden ? 'hidden' : ''}`}>
      {key && DIRS[key].map((d) => <div key={d} className={`rz rz-${d}`} data-rz={d} onPointerDown={drag(d)} onDoubleClick={() => setBounds(key, null)} title="Drag to resize (double-click resets)" />)}
      {!pill && (
        <div className="titlebar" onPointerDown={drag('move')} onDoubleClick={(e) => key && !(e.target as HTMLElement).closest('button') && setBounds(key, null)}>
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

/* ---------- fake desktop apps (decorative, data-driven) ---------- */
function OutlookWin() {
  const s = useS();
  const ms = meetingsFor({ meetings: CALENDAR, flags: s.flags, clock: s.clock }); // Outlook itself: everything, whatever yatai shows
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
