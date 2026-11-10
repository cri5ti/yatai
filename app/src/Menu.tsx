import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, useS } from './store';
import type { MenuItem, MenuState } from './store';
import { closeMenu } from './actions';
import { Calendar, calKey, fromIso, parseDay, toIso, today } from './DatePick';
import { parseWhen, remindLabel } from './remind';

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
  // a "date" item turns the menu into a calendar: arrows move the day, typing jumps to a date, ⏎ picks
  const [cal, setCal] = useState<{ item: MenuItem; cursor: Date } | null>(null);
  // a "when" item turns the input into a typed time ("20m", "fri 10:00"); the tip line previews it, ⏎ sets it
  const [when, setWhen] = useState<MenuItem | null>(null);
  const at = when ? parseWhen(q, new Date(), get().settings.workStart) : null;
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
  }, [stack.length, shown.length, !!cal, !!when]);
  useEffect(() => {
    box.current?.querySelector('.mi.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi, stack.length]);

  const run = (it?: MenuItem) => {
    if (!it || it.disabled) return;
    if (it.date) {
      setCal({ item: it, cursor: it.date.value ? fromIso(it.date.value) : today() });
      setQ('');
      return;
    }
    if (it.when) {
      setWhen(it);
      setQ('');
      return;
    }
    if (it.sub) {
      setStack((st) => [...st, it.sub!]);
      setQ('');
      setHi(0);
      return;
    }
    closeMenu();
    it.run?.();
  };
  const pickDate = (d: Date) => {
    const it = cal!.item;
    closeMenu();
    it.date!.pick(toIso(d));
  };
  const back = () => {
    if (when) {
      setWhen(null);
      setQ('');
      return;
    }
    if (cal) {
      setCal(null);
      setQ('');
      return;
    }
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
        <div className="menu-title">{stack.length > 1 || cal || when ? '‹ ' : ''}{menu.title}{cal ? ` · ${cal.item.label.replace(/…$/, '')}` : when ? ' · remind me' : ''}</div>
        <input
          ref={input}
          className="menu-input"
          value={q}
          spellCheck={false}
          placeholder={cal ? 'fri · +3 · +2w · nov 20 · 2026-12-01' : when ? '20m · 1h30 · 14:30 · fri 10:00 · tomorrow 3pm' : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
            const d = cal && parseDay(e.target.value);
            if (d) setCal({ ...cal!, cursor: d });
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            const k = e.key;
            if (when) {
              if (k === 'Enter') {
                e.preventDefault();
                if (at) (closeMenu(), when.when!.pick(at.getTime()));
                return;
              }
              if (k === 'Escape' || (k === 'Backspace' && !q)) return (e.preventDefault(), back());
              if (k === 'Tab') e.preventDefault();
              return;
            }
            if (cal) {
              const d = calKey(k, e.shiftKey, cal.cursor);
              if (d) return (e.preventDefault(), setCal({ ...cal, cursor: d }));
              if (k === 'Enter') return (e.preventDefault(), pickDate(parseDay(q) ?? cal.cursor));
              if (k === 'Escape' || (k === 'Backspace' && !q)) return (e.preventDefault(), back());
              if (k === 'Tab') e.preventDefault();
              return;
            }
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
        {when ? (
          <div className={`menu-when${at ? ' ok' : ''}`} aria-live="polite">
            {at
              ? `⏰ ${remindLabel(at.getTime())} · ${at.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : q.trim()
                ? 'Not a time (yet)'
                : 'Type when: in some minutes or hours, a time today, a day, or a day and a time'}
          </div>
        ) : cal ? (
          <Calendar cursor={cal.cursor} value={cal.item.date!.value} onCursor={(d) => setCal({ ...cal, cursor: d })} onPick={pickDate} />
        ) : (
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
        )}
        <div className="menu-tip">
          {when
            ? (at ? '⏎ set · Esc back' : 'Esc back')
            : cal
            ? `${cal.cursor.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} — ←→ day · ↑↓ week · PgUp/PgDn month · Home today · ⏎ pick · Esc back`
            : cur?.tip ?? '↑↓ move · ⏎ run · Esc back'}
        </div>
      </div>
    </div>
  );
}
