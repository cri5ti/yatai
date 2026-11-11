/**
 * The Outlook drawer's day view: the agenda plotted by the hour. Working hours (Settings → Outlook) take 80% of the
 * drawer's height; earlier / later meetings widen the range. Overlapping meetings sit side by side (a double booking is
 * marked in the accent colour), past ones are faded, and today has the red now-line.
 */
import type { ReactNode } from 'react';
import { cx } from './kbd';
import { fmt } from './model';

export interface SchedRow {
  id: string;
  title: ReactNode;
  at: { start: number; dur: number };
  have: boolean;
  dim?: boolean;
  clash?: boolean;
}

/** side-by-side columns for overlapping meetings: each gets a column, each cluster of overlaps a column count */
export function layoutColumns(rows: { id: string; at: { start: number; dur: number } }[]): Map<string, { col: number; cols: number }> {
  const sorted = [...rows].sort((a, b) => a.at.start - b.at.start || b.at.dur - a.at.dur);
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: { id: string; end: number; col: number }[] = [];
  let clusterEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => out.set(c.id, { col: c.col, cols }));
    cluster = [];
  };
  for (const r of sorted) {
    const end = r.at.start + Math.max(r.at.dur, 1);
    if (cluster.length && r.at.start >= clusterEnd) close();
    // the first column free at this start
    const used = new Set(cluster.filter((c) => c.end > r.at.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ id: r.id, end, col });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) close();
  return out;
}

/** the minutes shown: the working hours, widened to whole hours around anything earlier / later */
export function rangeOf(rows: SchedRow[], work: { start: number; end: number }) {
  const first = Math.min(work.start, ...rows.map((r) => r.at.start));
  const last = Math.max(work.end, ...rows.map((r) => r.at.start + r.at.dur));
  return { from: Math.max(0, Math.floor(first / 60) * 60), to: Math.min(24 * 60, Math.ceil(last / 60) * 60) };
}

/** pixels per minute: the working hours fill 80% of the visible height (never cramped below 0.5 px a minute) */
export const scaleFor = (height: number, work: { start: number; end: number }) => Math.max(0.5, (0.8 * height) / Math.max(60, work.end - work.start));

export function Schedule({
  rows,
  sel,
  height,
  work,
  now,
  onSelect,
  onAdd,
}: {
  rows: SchedRow[];
  sel: number;
  height: number;
  work: { start: number; end: number };
  now: number | null; // minutes of the day, today only
  onSelect: (i: number) => void;
  onAdd: (i: number) => void;
}) {
  const ppm = scaleFor(height, work);
  const { from, to } = rangeOf(rows, work);
  const cols = layoutColumns(rows);
  const y = (m: number) => (m - from) * ppm;
  const hours: number[] = [];
  for (let h = from; h <= to; h += 60) hours.push(h);
  return (
    <div className="sched" style={{ height: y(to) + 8 }} data-sched-from={from} data-sched-ppm={ppm}>
      <div className="swork" style={{ top: y(Math.max(from, work.start)), height: (Math.min(to, work.end) - Math.max(from, work.start)) * ppm }} />
      {hours.map((h) => (
        <div key={h} className="shour" style={{ top: y(h) }}>
          <span>{fmt(h)}</span>
        </div>
      ))}
      {rows.map((r, i) => {
        const c = cols.get(r.id) ?? { col: 0, cols: 1 };
        const top = y(r.at.start);
        const h = Math.max(18, r.at.dur * ppm - 2);
        return (
          <div
            key={r.id}
            className={cx('sblock', i === sel && 'is-sel', r.have && 'have', r.dim && 'dim', r.clash && 'clash', h < 34 && 'short')}
            style={{ top, height: h, left: `calc(52px + (100% - 60px) * ${c.col / c.cols})`, width: `calc((100% - 60px) / ${c.cols} - 3px)` }}
            title={r.clash ? 'Double booked: overlaps another meeting' : undefined}
            onClick={() => onSelect(i)}
            onDoubleClick={() => !r.have && onAdd(i)}
          >
            <div className="stitle">{r.title}</div>
            <div className="stime">
              {fmt(r.at.start)}–{fmt(r.at.start + r.at.dur)}
              {r.have ? ' · ✓ in yatai' : ''}
            </div>
          </div>
        );
      })}
      {now != null && now >= from && now <= to && <div className="snow" style={{ top: y(now) }} />}
    </div>
  );
}
