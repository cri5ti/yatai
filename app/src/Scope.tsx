import { useLayoutEffect, useRef, useState } from 'react';
import { useS } from './store';
import { Organizer } from './Organizer';
import { closeScopePick, openScopePick } from './actions';
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

/** the dropdown: the organizer, cut down to what is under one item, with a tick box on every row for being in Next */
export function ScopePick() {
  const s = useS();
  const pk = s.scopePick;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const owner = pk && s.nodes.find((n) => n.id === pk.id);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!pk || !r) return setPos(null);
    setPos({ x: Math.max(8, Math.min(pk.x - r.width, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(pk.y, window.innerHeight - r.height - 8)) });
  }, [pk?.id, pk?.x, pk?.y]);
  if (!pk || !owner) return null;
  const close = () => (closeScopePick(), focusArea());
  return (
    <div className="menu-veil spick-veil" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div
        ref={box}
        className="spick"
        aria-label="Under this item"
        style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') (e.preventDefault(), close());
        }}
      >
        <div className="spick-t">{plain(owner.title.split('\n')[0])}</div>
        <Organizer root={pk.id} checks />
      </div>
    </div>
  );
}
