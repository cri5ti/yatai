import { useS } from './store';
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
