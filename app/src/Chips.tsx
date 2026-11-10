import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useS } from './store';
import { closePrioPick, openPrioPick, setPrio, setPrioFilter } from './actions';
import { cx, focusArea } from './kbd';
import type { Node } from './store';
import { alertsFor, dueLabel } from './model';

/** live status chips for smart items */
export function Chips({ node }: { node: Node }) {
  const s = useS();
  return (
    <>
      {alertsFor(node, s.snaps).map((a) => (
        <span key={a.key} className={`chip ${a.tone}`}>
          {a.text}
        </span>
      ))}
    </>
  );
}

export function DueChip({ node }: { node: Node }) {
  if (!node.due || node.status === 'done') return null;
  const d = dueLabel(node.due);
  return <span className={`chip ${d.tone}`}>⚑ {d.text}</span>;
}

/** the priority colour: a 3-point ramp, --prio-hi (1) → --prio-mid (3) → --prio-lo (5) */
export const prioBg = (p: number) => {
  p = Math.max(1, Math.min(5, p));
  return p <= 3 ? `color-mix(in oklch, var(--prio-mid) ${(p - 1) * 50}%, var(--prio-hi))` : `color-mix(in oklch, var(--prio-lo) ${(p - 3) * 50}%, var(--prio-mid))`;
};

/** the quick-priority square (1 = highest … 5); `inside` = it comes from something hidden under a collapsed item.
 *  With `ids` it is a button that opens the little picker — and shows as a faint ghost on hover when there is no priority yet. */
export function Prio({ v, ids }: { v: { p: number; inside: boolean } | null; ids?: string[] }) {
  if (!v && !ids) return null;
  const tip = !v ? 'Set a priority (keys 1–5)' : v.inside ? `Priority ${v.p} — the highest inside (keys 1–5)` : `Priority ${v.p} (keys 1–5 · same key again or 0 clears)`;
  const body = v ? v.p : '';
  const style = v ? { background: prioBg(v.p) } : undefined;
  if (!ids) return <span className="prio" style={style} title={tip}>{body}</span>;
  return (
    <button
      className={cx('prio', !v && 'ghost')}
      style={style}
      tabIndex={-1}
      title={tip}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openPrioPick(ids, r.right, r.bottom + 4);
      }}
    >
      {body}
    </button>
  );
}

/** the little picker: five squares and a clear, for the selection's priority or (no ids) the view filter */
export function PrioPick() {
  const s = useS();
  const pk = s.prioPick;
  const box = useRef<HTMLDivElement>(null);
  const cur = pk ? (pk.ids ? s.nodes.find((n) => n.id === pk.ids![0])?.prio ?? 0 : s.prioFilter ?? 0) : 0;
  const [hi, setHi] = useState(cur || 1);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setHi(cur || 1), [pk]);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!pk || !r) return setPos(null);
    setPos({ x: Math.max(8, Math.min(pk.x - r.width, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(pk.y, window.innerHeight - r.height - 8)) });
    box.current?.focus();
  }, [pk]);
  if (!pk) return null;
  const close = () => (closePrioPick(), focusArea());
  const pick = (p: number) => {
    if (pk.ids) {
      // from the picker the choice is explicit: picking the current one keeps it
      if (p && s.nodes.filter((n) => pk.ids!.includes(n.id)).every((n) => n.prio === p)) return close();
      setPrio(pk.ids, p);
      close();
    } else (p && p === s.prioFilter ? closePrioPick() : setPrioFilter(p), focusArea());
  };
  const filter = !pk.ids;
  return (
    <div className="menu-veil" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div
        ref={box}
        className="ppick"
        role="listbox"
        tabIndex={-1}
        aria-label={filter ? 'Show priority up to' : 'Priority'}
        style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          const k = e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
          if (/^[0-5]$/.test(k)) return (e.preventDefault(), pick(+k));
          if (e.key === 'Escape') return (e.preventDefault(), close());
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') return (e.preventDefault(), setHi((h) => (h + (e.key === 'ArrowRight' ? 1 : 5)) % 6));
          if (e.key === 'Enter' || e.key === ' ') return (e.preventDefault(), pick(hi));
        }}
      >
        <div className="ppick-t">{filter ? 'Show up to' : 'Priority'}</div>
        <div className="ppick-row">
          {[1, 2, 3, 4, 5].map((p) => (
            <button key={p} tabIndex={-1} className={cx('prio', p === cur && 'on', p === hi && 'hi')} style={{ background: prioBg(p) }} onMouseMove={() => setHi(p)} onClick={() => pick(p)} title={filter ? (p === 1 ? 'Only priority 1 (⌥1)' : `Priorities 1–${p} (⌥${p})`) : `Priority ${p} (${p})`}>
              {p}
            </button>
          ))}
          <button tabIndex={-1} className={cx('prio clear', hi === 0 && 'hi')} onMouseMove={() => setHi(0)} onClick={() => pick(0)} title={filter ? 'Show everything (⌥0)' : 'No priority (0)'}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
