import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import { endFocus, extendFocus, focusElapsedMin, leaveFocus, leavePill, pauseFocus, startFocus } from './actions';
import { fmt, meetingsFor, nextActions, pathOf, plain } from './model';
import { isEditable } from './kbd';

const mmss = (min: number) => {
  const t = Math.max(0, Math.round(min * 60));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Focus mode: everything hidden but the current action and a timer. Fully keyboard-driven. */
export function Focus() {
  const s = useS();
  const [, tick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const f = s.focus;

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, [f?.ended, !f]);
  useEffect(() => {
    if (f && !f.ended && !f.pausedAt && focusElapsedMin(f) >= f.durationMin + f.extra) endFocus();
  });

  const nexts = f?.ended ? nextActions(s, f.nodeId).slice(0, 3) : nextActions(s).slice(0, 1);
  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (!f) {
      if (k === 'Enter' && nexts[0]) (stop(), startFocus(nexts[0].id));
      else if (k === 'Escape') (stop(), leavePill());
    } else if (f.ended) {
      if (k === 'Enter' || k === 'd') (stop(), leaveFocus({ done: true }));
      else if (k === 'n') (stop(), leaveFocus());
      else if (k === '+') (stop(), extendFocus(15));
      else if (['1', '2', '3'].includes(k) && nexts[+k - 1]) (stop(), leaveFocus({ done: true, next: nexts[+k - 1].id }));
      else if (k === 'Escape') (stop(), leaveFocus());
    } else if (k === ' ') (stop(), pauseFocus());
    else if (k === '+') (stop(), extendFocus(5));
    else if (k === 'Enter' || k === 'e') (stop(), endFocus());
    else if (k === 'Escape') (stop(), leaveFocus());
  };

  /* ---- no active focus: compact "next up" pill ---- */
  if (!f) {
    const next = nexts[0];
    return (
      <div className="pill idle kbd-area" data-kbd-area tabIndex={0} ref={box} onKeyDown={onKey} onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && leavePill()}>
        <div className="pill-main">
          <div className="pill-label">Next up</div>
          <div className="pill-title">{next ? plain(next.title.split('\n')[0]) : 'Nothing queued'}</div>
        </div>
        {next && (
          <button className="btn primary" onClick={() => startFocus(next.id)}>
            ▶ Focus <kbd>⏎</kbd>
          </button>
        )}
        <button className="x pill-out" title="Back to the full window (Esc, ⌘1)" aria-label="Back to the full window" onClick={leavePill}>
          ⤢
        </button>
      </div>
    );
  }

  const node = s.nodes.find((n) => n.id === f.nodeId);
  const title = node ? plain(node.title.split('\n')[0]) : undefined;
  const total = f.durationMin + f.extra;
  const el = focusElapsedMin(f);
  const left = total - el;
  const pct = Math.min(100, (el / total) * 100);
  const path = pathOf(s.nodes, node?.parentId ?? null).join(' › ');

  if (f.ended) {
    const upcoming = meetingsFor(s).find((m) => m.state === 'upcoming' && m.minsAway - (f.elapsedAtEnd ?? 0) <= 30);
    return (
      <div className="pill ended kbd-area" data-kbd-area tabIndex={0} ref={box} onKeyDown={onKey}>
        <div className="pill-label">⏱ Focus complete · {Math.round(f.elapsedAtEnd ?? 0)} min</div>
        <div className="pill-title">{title}</div>
        <div className="ended-q">How did it go?</div>
        <div className="row">
          <button className="btn primary" onClick={() => leaveFocus({ done: true })}>
            ✓ Done <kbd>⏎</kbd>
          </button>
          <button className="btn" onClick={() => leaveFocus()}>
            Not done <kbd>N</kbd>
          </button>
          <button className="btn" onClick={() => extendFocus(15)}>
            +15 min <kbd>+</kbd>
          </button>
        </div>
        {upcoming && (
          <div className="chip warn block">
            {upcoming.title} at {fmt(upcoming.eff)} — maybe a short task next
          </div>
        )}
        {nexts.length > 0 && (
          <>
            <div className="ended-q">Switch to…</div>
            {nexts.map((n, i) => (
              <button key={n.id} className="btn wide" onClick={() => leaveFocus({ done: true, next: n.id })}>
                <kbd>{i + 1}</kbd> ✓ done, then ▶ {plain(n.title.split('\n')[0])}
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`pill running kbd-area ${f.pausedAt ? 'paused' : ''}`} data-kbd-area tabIndex={0} ref={box} onKeyDown={onKey}>
      <div className="pill-main">
        <div className="pill-label">{path}</div>
        <div className="pill-title">{title}</div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="pill-time">{mmss(left)}</div>
      <div className="pill-btns">
        <button className="x" title={f.pausedAt ? 'Resume (Space)' : 'Pause (Space)'} onClick={pauseFocus}>
          {f.pausedAt ? '▶' : '❚❚'}
        </button>
        <button className="x" title="+5 min (+)" onClick={() => extendFocus(5)}>
          +5
        </button>
        <button className="x" title="Finish now (Enter)" onClick={endFocus}>
          ■
        </button>
      </div>
    </div>
  );
}
