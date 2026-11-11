import { useLayoutEffect, useRef, useState } from 'react';
import { useS } from './store';
import type { Node } from './store';
import { closeScopePick, openScopePick, toggleScope } from './actions';
import { cx, focusArea } from './kbd';
import { plain } from './model';

/** the count pill on a row of Next: how many items under it are not in Next. Faint, until the selection is on or inside it. */
export function ScopePill({ id, count, active }: { id: string; count: number; active: boolean }) {
  return (
    <button
      className={cx('scope-pill', active && 'on')}
      tabIndex={-1}
      title={`${count} more item${count > 1 ? 's' : ''} under this one, not in Next — choose what to bring in`}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openScopePick(id, r.right, r.bottom + 4);
      }}
    >
      +{count}
    </button>
  );
}

interface Line {
  node: Node;
  depth: number;
}
/** the open items under `id`, in organizer order (an item already in Next stays listed, ticked, so it can be taken out again) */
function linesOf(nodes: Node[], id: string): Line[] {
  const out: Line[] = [];
  const walk = (pid: string, depth: number) => {
    for (const n of nodes) {
      if (n.parentId !== pid) continue;
      if (n.status === 'dropped' || (n.status === 'done' && !n.today)) continue;
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(id, 0);
  return out;
}

/** the dropdown: every item under one item, with a tick box for being in Next. Ticking brings it in with everything under it. */
export function ScopePick() {
  const s = useS();
  const pk = s.scopePick;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hi, setHi] = useState(0);
  const lines = pk ? linesOf(s.nodes, pk.id) : [];
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!pk || !r) return setPos(null);
    setPos({ x: Math.max(8, Math.min(pk.x - r.width, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(pk.y, window.innerHeight - r.height - 8)) });
    setHi(0);
    box.current?.focus();
  }, [pk?.id, pk?.x, pk?.y]);
  if (!pk) return null;
  const owner = s.nodes.find((n) => n.id === pk.id);
  const close = () => (closeScopePick(), focusArea());
  return (
    <div className="menu-veil" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div
        ref={box}
        className="spick"
        role="menu"
        tabIndex={-1}
        aria-label="Under this item"
        style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') return (e.preventDefault(), close());
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return (e.preventDefault(), setHi((h) => Math.max(0, Math.min(lines.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1)))));
          if ((e.key === ' ' || e.key === 'Enter') && lines[hi]) return (e.preventDefault(), toggleScope(lines[hi].node.id));
        }}
      >
        <div className="spick-t">{owner ? plain(owner.title.split('\n')[0]) : 'Under this item'}</div>
        {lines.length === 0 && <div className="spick-none">Nothing under it</div>}
        {lines.map((l, i) => (
          <label key={l.node.id} className={cx('spick-row', i === hi && 'hi', l.node.status === 'done' && 'done')} style={{ paddingLeft: 6 + l.depth * 14 }} onMouseMove={() => setHi(i)}>
            <input type="checkbox" tabIndex={-1} checked={l.node.today} onChange={() => toggleScope(l.node.id)} />
            <span className="spick-x">{plain(l.node.title.split('\n')[0])}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
