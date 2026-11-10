import { useS } from './store';
import type { CSSProperties } from 'react';
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

/** the quick-priority square (1 = highest … 9); `inside` = it comes from something hidden under a collapsed item */
export function Prio({ v }: { v: { p: number; inside: boolean } | null }) {
  if (!v) return null;
  return (
    <span
      className={'prio' + (v.inside ? ' inside' : '')}
      style={{ '--pn': v.p - 1 } as CSSProperties}
      title={v.inside ? `Priority ${v.p} — the highest inside (keys 1–9)` : `Priority ${v.p} (keys 1–9 · same key again or 0 clears)`}
    >
      {v.p}
    </span>
  );
}
