import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useS } from './store';
import type { MenuItem, MenuState } from './store';
import { closeMenu } from './actions';

/** Context menu + command palette: right-click or "/" . Type to filter, ↑↓ to move, Enter to run, ← / Esc to go back. */
export function Menu() {
  const s = useS();
  return s.menu ? <MenuInner key={s.menu.id} menu={s.menu} /> : null;
}

function MenuInner({ menu }: { menu: MenuState }) {
  const [stack, setStack] = useState<MenuItem[][]>([menu.items]);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = stack[stack.length - 1];

  const needle = q.replace(/^\//, '').trim().toLowerCase();
  const shown = needle
    ? list
        .filter((i) => (i.cmd ?? '').includes(needle) || i.label.toLowerCase().includes(needle))
        .sort((a, b) => Number(!(a.cmd ?? '').startsWith(needle)) - Number(!(b.cmd ?? '').startsWith(needle)))
    : list;
  const cur = shown[Math.min(hi, shown.length - 1)];

  useEffect(() => input.current?.focus(), []);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) });
  }, [stack.length, shown.length]);
  useEffect(() => {
    box.current?.querySelector('.mi.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi, stack.length]);

  const run = (it?: MenuItem) => {
    if (!it || it.disabled) return;
    if (it.sub) {
      setStack((st) => [...st, it.sub!]);
      setQ('');
      setHi(0);
      return;
    }
    closeMenu();
    it.run?.();
  };
  const back = () => {
    if (stack.length > 1) {
      setStack((st) => st.slice(0, -1));
      setQ('');
      setHi(0);
    } else closeMenu();
  };

  return (
    <div className="menu-veil" onMouseDown={closeMenu} onContextMenu={(e) => (e.preventDefault(), closeMenu())}>
      <div
        ref={box}
        className="menu"
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="menu-title">{stack.length > 1 ? '‹ ' : ''}{menu.title}</div>
        <input
          ref={input}
          className="menu-input"
          value={q}
          spellCheck={false}
          onChange={(e) => (setQ(e.target.value), setHi(0))}
          onKeyDown={(e) => {
            e.stopPropagation();
            const k = e.key;
            if (k === 'Escape') (e.preventDefault(), back());
            else if (k === 'ArrowDown') (e.preventDefault(), setHi((h) => (h + 1) % Math.max(1, shown.length)));
            else if (k === 'ArrowUp') (e.preventDefault(), setHi((h) => (h - 1 + shown.length) % Math.max(1, shown.length)));
            else if (k === 'ArrowRight' && cur?.sub && !q) (e.preventDefault(), run(cur));
            else if (k === 'ArrowLeft' && !q && stack.length > 1) (e.preventDefault(), back());
            else if (k === 'Enter') (e.preventDefault(), run(cur));
            else if (k === 'Tab') e.preventDefault();
            else if (!q && !e.metaKey && !e.ctrlKey) {
              const hit = list.find((i) => i.key === k);
              if (hit) (e.preventDefault(), run(hit));
            }
          }}
        />
        <div className="menu-list">
          {shown.map((it, i) => (
            <div
              key={it.id}
              role="menuitem"
              aria-disabled={it.disabled}
              className={`mi ${i === Math.min(hi, shown.length - 1) ? 'hi' : ''} ${it.danger ? 'danger' : ''} ${it.disabled ? 'off' : ''}`}
              title={it.tip}
              onMouseMove={() => setHi(i)}
              onClick={() => run(it)}
            >
              <span className="mi-ic">{it.icon ?? ''}</span>
              <span className="mi-l">{it.label}</span>
              {it.cmd && stack.length === 1 && <span className="mi-c">/{it.cmd}</span>}
              {it.key && <kbd>{it.key}</kbd>}
              {it.keys && <span className="mi-k">{it.keys}</span>}
              {it.sub && <span className="mi-k">›</span>}
            </div>
          ))}
          {!shown.length && <div className="mi-empty">No command matches “{q}”</div>}
        </div>
        <div className="menu-tip">{cur?.tip ?? '↑↓ move · ⏎ run · Esc back'}</div>
      </div>
    </div>
  );
}
