import { useEffect, useRef, useState } from 'react';
import { effLayout, get, useS } from './store';
import type { State, Tab } from './store';
import { Next } from './Next';
import { Inbox } from './Inbox';
import { Organizer } from './Organizer';
import { Focus } from './Focus';
import { Menu } from './Menu';
import { AiPop, ProposalBar } from './AiPop';
import { capture, closeCapture, setBounds, dismissToast, openDrawer, openSettings, setDensity, setLayout, setScale, setTab, toggleHelp, toggleHidden, toggleOnTop } from './actions';
import { DENSITIES, SCALES } from './store';
import { Drawer } from './Drawer';
import { GhIcon } from './Pr';
import { Settings } from './Settings';
import { MdEditor } from './MdEditorLazy';
import { DevPanel } from './Controls';
import { Help } from './Help';
import { applyLayout, isApplying, isMac, isTauri, onWindowChange, setBadge, setOnTop, setVisible, startDrag, windowRect } from './platform';
import type { Edge } from './platform';


const ALL: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const DIRS: Record<string, Edge[]> = { dock: ALL, float: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'], max: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] };

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
    void applyLayout(layout, get().bounds, ended, get().onTop).then(() => {
      if (!shown.current && !get().hidden) {
        shown.current = true;
        void setVisible(true);
      }
    });
  }, [layout, ended]);
  useEffect(() => void (shown.current && setVisible(!s.hidden)), [s.hidden]);
  useEffect(() => void setOnTop(s.onTop || layout === 'pill'), [s.onTop, layout]);
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
        setBounds(l, r);
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
  const edges = key ? DIRS[key] : [];
  /** edges and the title bar are handed to the OS: it resizes / moves the frameless window */
  const drag = (kind: Edge | 'move') => (e: React.PointerEvent) => {
    if (e.button !== 0 || !key) return;
    // the tab bar stretches across the title bar: only its buttons are buttons, the empty part drags the window
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    void startDrag(kind, e.nativeEvent);
  };
  const pill = layout === 'pill';
  const endedFocus = !!s.focus?.ended;
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
            <button className={s.onTop ? 'on' : ''} aria-pressed={s.onTop} title={s.onTop ? 'Always on top: on' : 'Keep on top of other windows'} aria-label="Always on top" onClick={toggleOnTop}>
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill={s.onTop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
                <path d="M9.5 1.8 14.2 6.5l-1.4.5-2.3 2.3.3 2.9-1 1-2.7-2.7-4 4-.7-.7 4-4L3.7 7.2l1-1 2.9.3L9.9 4.2z" />
              </svg>
            </button>
            <button title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={toggleHelp}>
              ?
            </button>
            <button title="Settings (⌘,)" aria-label="Settings" onClick={openSettings}>
              ⚙
            </button>
            <button title={layout === 'max' ? 'Back to the docked window' : 'Full-width window'} aria-label="Toggle docked / full width" onClick={() => setLayout(layout === 'max' ? 'dock' : 'max')}>
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
      {!pill && !isTauri && <Drawer />}
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

export function Shell() {
  const s = useS();
  return (
    <div className="desktop">
      <Win />
      <Menu />
      {/* the app opens these as their own windows (popups.ts); the browser build shows them in the page */}
      {!isTauri && (
        <>
          <Capture />
          <AiPop />
          <Help />
          <Settings />
          <MdEditor />
          {s.dev && <DevPanel />}
        </>
      )}

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
