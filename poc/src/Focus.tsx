import { useEffect, useState } from 'react';
import { useS } from './store';
import { endFocus, extendFocus, focusElapsedMin, leaveFocus, pauseFocus, startFocus } from './actions';
import { fmt, meetingsFor, nextActions, pathOf, todayModel } from './model';

const mmss = (min: number) => {
  const t = Math.max(0, Math.round(min * 60));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export function Focus() {
  const s = useS();
  const [, tick] = useState(0);
  const f = s.focus;

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (f && !f.ended && !f.pausedAt && focusElapsedMin(f) >= f.durationMin + f.extra) endFocus();
  });

  /* ---- no active focus: compact "next up" pill ---- */
  if (!f) {
    const next = nextActions(s)[0];
    return (
      <div className="pill idle">
        <div className="pill-main">
          <div className="pill-label">Next up</div>
          <div className="pill-title">{next ? next.title : 'Nothing queued'}</div>
        </div>
        {next && (
          <button className="btn primary" onClick={() => startFocus(next.id)}>
            ▶ Focus
          </button>
        )}
      </div>
    );
  }

  const node = s.nodes.find((n) => n.id === f.nodeId);
  const total = f.durationMin + f.extra;
  const el = focusElapsedMin(f);
  const left = total - el;
  const pct = Math.min(100, (el / total) * 100);
  const path = pathOf(s.nodes, node?.parentId ?? null).join(' › ');

  if (f.ended) {
    const nexts = nextActions(s, f.nodeId).slice(0, 3);
    const upcoming = meetingsFor(s).find((m) => m.state === 'upcoming' && m.minsAway - (f.elapsedAtEnd ?? 0) <= 30);
    return (
      <div className="pill ended">
        <div className="pill-label">⏱ Focus complete · {Math.round(f.elapsedAtEnd ?? 0)} min</div>
        <div className="pill-title">{node?.title}</div>
        <div className="ended-q">How did it go?</div>
        <div className="row">
          <button className="btn primary" onClick={() => leaveFocus({ done: true })}>
            ✓ Done
          </button>
          <button className="btn" onClick={() => leaveFocus()}>
            Not done
          </button>
          <button className="btn" onClick={() => extendFocus(15)}>
            +15 min
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
            {nexts.map((n) => (
              <button key={n.id} className="btn wide" onClick={() => leaveFocus({ done: true, next: n.id })}>
                ✓ done, then ▶ {n.title}
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`pill running ${f.pausedAt ? 'paused' : ''}`}>
      <div className="pill-main">
        <div className="pill-label">{path}</div>
        <div className="pill-title">{node?.title}</div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="pill-time">{mmss(left)}</div>
      <div className="pill-btns">
        <button className="x" title={f.pausedAt ? 'Resume' : 'Pause'} onClick={pauseFocus}>
          {f.pausedAt ? '▶' : '❚❚'}
        </button>
        <button className="x" title="+5 min" onClick={() => extendFocus(5)}>
          +5
        </button>
        <button className="x" title="Finish now" onClick={endFocus}>
          ■
        </button>
      </div>
    </div>
  );
}

export const _unused = todayModel;
