import { useEffect, useMemo, useRef, useState } from 'react';
import { set } from './store';
import { useView } from './proposal';
import type { Node } from './store';
import {
  addNode, breakDown, dismissHl, cycleEst, editText, estimate, focusItem, indentItems, isDone, moveNode, outdentItems, removeNodes, reorderItems, startFirst,
  fileInboxTo, openAllTree, pasteItems, subtree, toast, toggleDoneNodes, toggleOpen, toggleStartItem, toggleToday,
} from './actions';
import { openEstMenu, openMenu } from './commands';
import { childrenOf, depthOf, fmtEst, hlSubtree, laterLabel, plain, relTime } from './model';
import { InlineEdit } from './Inline';
import { inline } from './md';
import { countItems, parseMarkdown, toMarkdown, treeOf } from './clip';
import { Chips, DueChip } from './Chips';
import { useFlip } from './flip';
import { cx, focusArea, isEditable, mod } from './kbd';

interface RowItem {
  n: Node;
  depth: number;
  kids: boolean;
}
function visibleRows(nodes: Node[]): RowItem[] {
  const out: RowItem[] = [];
  const walk = (pid: string | null, d: number) => {
    for (const n of childrenOf(nodes, pid)) {
      const kids = nodes.some((c) => c.parentId === n.id);
      out.push({ n, depth: d, kids });
      if (n.open && kids) walk(n.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

type Hint = { id: string; zone: 'before' | 'inside' | 'after' };
export const INBOX_MIME = 'application/x-yatai-inbox';
const TABLE_AT = 880; // px: below this the organizer is a list, above it the same rows grow columns

/** Everything, as one tree of items — the same rows as Next, but all of them (and a table when there is room). */
export function Organizer({ embedded = false }: { embedded?: boolean }) {
  const { s, marks } = useView();
  const rows = useMemo(() => visibleRows(s.nodes), [s.nodes]);
  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const dnd = useRef<string | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const wide = width >= TABLE_AT;
  useFlip(area, 'data-fr');

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // selection always resolves to something visible (a collapsed parent stands in for hidden children)
  const selId = useMemo(() => {
    let cur: Node | undefined = s.nodes.find((n) => n.id === s.sel);
    const vis = new Set(rows.map((r) => r.n.id));
    while (cur && !vis.has(cur.id)) cur = s.nodes.find((n) => n.id === cur!.parentId);
    return cur?.id ?? rows[0]?.n.id ?? null;
  }, [s.sel, s.nodes, rows]);
  const live = useMemo(() => s.multi.filter((id) => s.nodes.some((n) => n.id === id)), [s.multi, s.nodes]);
  const multi = useMemo(() => new Set(live.length > 1 ? live : []), [live]);

  useEffect(() => {
    if (!embedded) area.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    area.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selId, rows.length]);
  // moving the keyboard cursor onto a yellow highlight counts as having seen it
  const lastSel = useRef<string | null>(null);
  useEffect(() => {
    if (lastSel.current !== null && lastSel.current !== selId && selId) {
      const n = s.nodes.find((x) => x.id === selId);
      const kids = s.nodes.some((c) => c.parentId === selId);
      dismissHl(s.hl[selId] ? [selId] : n && kids && !n.open ? hlSubtree(s.nodes, s.hl, selId) : []);
    }
    lastSel.current = selId;
  }, [selId]);

  const select = (id: string | null) => set(() => ({ sel: id, multi: [], anchor: null }));
  const targets = () => (live.length > 1 ? live : selId ? [selId] : []);

  const extendTo = (id: string) => {
    const a = s.anchor ?? selId;
    const ai = rows.findIndex((r) => r.n.id === a);
    const bi = rows.findIndex((r) => r.n.id === id);
    if (ai < 0 || bi < 0) return;
    const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
    set(() => ({ multi: rows.slice(lo, hi + 1).map((r) => r.n.id), anchor: a, sel: id }));
  };
  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey) return extendTo(id);
    if (e.metaKey || e.ctrlKey) {
      const base = live.length > 1 ? live : selId ? [selId] : [];
      const next = base.includes(id) ? base.filter((v) => v !== id) : [...base, id];
      return set(() => ({ multi: next, anchor: id, sel: id }));
    }
    select(id);
  };

  const insertSibling = (n: Node) => set(() => ({ ins: { kind: 'node', parentId: n.parentId, afterId: n.id } }));
  const insertAbove = (n: Node) => set(() => ({ ins: { kind: 'node', parentId: n.parentId, afterId: null, beforeId: n.id } }));
  const insertChild = (n: Node) => {
    set(() => ({ ins: { kind: 'node', parentId: n.id, afterId: [...s.nodes].reverse().find((c) => c.parentId === n.id)?.id ?? n.id } }));
    toggleOpen(n.id, true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target)) return;
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // ⌥↑↓ = skip sub-items: only top-level rows (⇧⌥ extends the selection)
      e.preventDefault(); e.stopPropagation();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const ci = rows.findIndex((r) => r.n.id === selId);
      let j = (ci < 0 ? (dir > 0 ? -1 : rows.length) : ci) + dir;
      while (j >= 0 && j < rows.length && rows[j].depth !== 0) j += dir;
      const nx = rows[j];
      if (nx) (e.shiftKey ? extendTo(nx.n.id) : select(nx.n.id));
      return;
    }
    if (e.altKey) return;
    const k = e.key;
    const M = mod(e);
    const stop = () => (e.preventDefault(), e.stopPropagation());
    const i = rows.findIndex((r) => r.n.id === selId);
    const cur = i >= 0 ? rows[i].n : null;
    const bulk = live.length > 1;
    const ids = targets();

    if (k === 'Enter') {
      // Enter adds below, ⇧Enter adds above, ⌘⇧Enter starts focus mode
      stop();
      if (M && e.shiftKey) return cur && focusItem(cur.id);
      if (!cur) return set(() => ({ ins: { kind: 'node', parentId: null, afterId: null } }));
      return e.shiftKey ? insertAbove(cur) : insertSibling(cur);
    }
    if (M && k === ']') return (stop(), indentItems(ids));
    if (M && k === '[') return (stop(), outdentItems(ids));
    if (M && (k === 'ArrowUp' || k === 'ArrowDown')) return (stop(), reorderItems(ids, k === 'ArrowUp' ? -1 : 1));
    if (M && k.toLowerCase() === 'a') {
      stop();
      return set(() => ({ multi: rows.map((r) => r.n.id), anchor: rows[0]?.n.id ?? null }));
    }
    if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      stop();
      const nx = rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)))];
      return nx && extendTo(nx.n.id);
    }
    if (e.shiftKey && k === ' ' && cur) {
      stop();
      return cur.smart ? toast(`(mock) opening ${plain(cur.title.split('\n')[0])} in browser`) : toggleStartItem(cur.id);
    }
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight') && ids.length) {
      stop();
      return cycleEst(ids, k === 'ArrowRight' ? 1 : -1);
    }
    // − / + : collapse / expand everything
    if (!M && (k === '-' || k === '_')) return (stop(), openAllTree(false));
    if (!M && (k === '+' || k === '=')) return (stop(), openAllTree(true));
    if (M || (e.shiftKey && k !== 'N')) return;

    if (k === 'ArrowDown' || k === 'ArrowUp') {
      stop();
      select(rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)))]?.n.id ?? null);
    } else if (k === 'ArrowRight' && cur) {
      stop();
      const kids = childrenOf(s.nodes, cur.id);
      if (kids.length && !cur.open) toggleOpen(cur.id, true);
      else if (kids.length) select(kids[0].id);
    } else if (k === 'ArrowLeft' && cur) {
      stop();
      const kids = childrenOf(s.nodes, cur.id);
      if (kids.length && cur.open) toggleOpen(cur.id, false);
      else if (cur.parentId && s.nodes.some((n) => n.id === cur.parentId)) select(cur.parentId);
    } else if (k === 'Home') (stop(), select(rows[0]?.n.id ?? null));
    else if (k === 'End') (stop(), select(rows[rows.length - 1]?.n.id ?? null));
    else if (k === 'Escape' && bulk) (stop(), set(() => ({ multi: [], anchor: null })));
    else if (k === 'N') (stop(), set(() => ({ ins: { kind: 'node', parentId: null, afterId: null } })));
    else if (k === '/') {
      stop();
      openMenu(bulk ? { t: 'multi', ids: live } : cur ? { t: 'node', id: cur.id } : null, undefined, undefined, { slash: true });
    } else if (!cur) return;
    else if (k === 'r' || k === 'F2') (stop(), set(() => ({ edit: cur.id })));
    else if (k === ' ') (stop(), toggleDoneNodes(ids));
    else if (k === 't') (stop(), ids.forEach((id) => toggleToday(id)));
    else if (k === 'f') (stop(), focusItem(cur.id));
    else if (k === 'a') (stop(), insertChild(cur));
    else if (k === 'n') (stop(), insertSibling(cur));
    else if (k === 'b') (stop(), breakDown(cur.id));
    else if (k === 'e') (stop(), openEstMenu(ids));
    else if (k === 'Delete' || k === 'Backspace') {
      stop();
      const gone = new Set(bulk ? live : [cur.id]);
      const next = rows.find((r, j) => j > i && !gone.has(r.n.id))?.n.id ?? [...rows].reverse().find((r) => !gone.has(r.n.id))?.n.id ?? null;
      removeNodes([...gone]);
      select(next);
    }
  };

  /* ---- drag & drop: before / inside / after a row; any item can go under any other ---- */
  const zoneOf = (e: React.DragEvent): Hint['zone'] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    return f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside';
  };
  const isExt = (e: React.DragEvent) => !dnd.current && e.dataTransfer.types.includes(INBOX_MIME);
  const extIds = (e: React.DragEvent): string[] => {
    try {
      return JSON.parse(e.dataTransfer.getData(INBOX_MIME));
    } catch {
      return [];
    }
  };
  const resolveDrop = (srcId: string, target: Node, zone: Hint['zone']) => {
    if (srcId && subtree(s.nodes, srcId).has(target.id)) return null; // never into itself
    if (zone === 'inside') return { parentId: target.id as string | null, beforeId: null as string | null };
    if (zone === 'before') return { parentId: target.parentId, beforeId: target.id as string | null };
    const sibs = childrenOf(s.nodes, target.parentId).filter((n) => n.id !== srcId);
    const nxt = sibs[sibs.findIndex((n) => n.id === target.id) + 1];
    return { parentId: target.parentId, beforeId: nxt?.id ?? null };
  };

  /* ---- inline creation draft goes after the subtree of its anchor ---- */
  const ins = s.ins?.kind === 'node' ? s.ins : null;
  const list: ({ row: RowItem } | { draft: true; depth: number })[] = rows.map((row) => ({ row }));
  if (ins) {
    const depth = ins.parentId ? depthOf(s.nodes, ins.parentId) + 1 : 0;
    const bi = ins.beforeId ? rows.findIndex((r) => r.n.id === ins.beforeId) : -1;
    const ai = ins.afterId ? rows.findIndex((r) => r.n.id === ins.afterId) : -1;
    let at = rows.length;
    if (bi >= 0) at = bi;
    else if (ai >= 0) {
      const base = rows[ai].depth;
      at = ai + 1;
      while (at < rows.length && rows[at].depth > base) at++;
    }
    list.splice(at, 0, { draft: true, depth });
  }

  /** a new-item row: same gutter as a real row, so the editor starts where the text would */
  const draftRow = (depth: number) => (
    <div key="draft" className="orow draft" style={{ ['--d' as string]: depth } as React.CSSProperties}>
      <span className="check ghost" />
      <InlineEdit
        key={`${ins!.afterId}|${ins!.beforeId}`}
        chain
        onCommit={(t, chain) => {
          const id = addNode(ins!.parentId, t, ins!.afterId, {}, 'Add item', ins!.beforeId);
          // keep adding: the next one goes right below the one just created
          set(() => ({ ins: chain ? { kind: 'node' as const, parentId: ins!.parentId, afterId: id } : null }));
          if (!chain) focusArea();
        }}
        onCancel={() => (set(() => ({ ins: null })), focusArea())}
      />
    </div>
  );

  const running = s.current?.id;

  return (
    <div className={cx('organizer view', embedded && 'embedded', wide && 'is-table')} ref={root}>
      {wide && (
        <div className="ohead">
          <span className="c-title">Item</span>
          <span className="c-m">Est</span>
          <span className="c-m">Due</span>
          <span className="c-m">Modified</span>
          <span className="c-m">Last run</span>
          <span className="c-m">Next</span>
        </div>
      )}

      <div
        className="tree kbd-area"
        data-kbd-area
        tabIndex={0}
        ref={area}
        onKeyDown={onKey}
        onMouseDown={(e) => (e.shiftKey || e.metaKey || e.ctrlKey) && !isEditable(e.target) && e.preventDefault()}
        onCopy={(e) => {
          if (isEditable(e.target) || !targets().length) return;
          const tree = treeOf(s.nodes, targets(), (id) => isDone(s.nodes, id));
          e.preventDefault();
          e.clipboardData.setData('text/plain', toMarkdown(tree));
          toast(`Copied ${countItems(tree)} item${countItems(tree) > 1 ? 's' : ''} as markdown`, 'info');
        }}
        onPaste={(e) => {
          if (isEditable(e.target)) return;
          const tree = parseMarkdown(e.clipboardData.getData('text/plain'));
          if (!tree.length) return;
          e.preventDefault();
          const c = selId ? s.nodes.find((n) => n.id === selId) : null;
          pasteItems(tree, { parentId: c ? c.parentId : null, afterId: c ? c.id : null });
        }}
        aria-label="Organizer — arrows to navigate, ? for shortcuts"
        onDragOver={(e) => {
          if ((dnd.current || isExt(e)) && !e.defaultPrevented) e.preventDefault();
        }}
        onDrop={(e) => {
          if (isExt(e) && !e.defaultPrevented) {
            e.preventDefault();
            setHint(null);
            return fileInboxTo(extIds(e), null, null); // empty space: top level
          }
          if (!dnd.current || e.defaultPrevented) return;
          e.preventDefault();
          const src = dnd.current;
          dnd.current = null;
          setHint(null);
          moveNode(src, null, null); // dropped on empty space: becomes a top-level item
        }}
      >
        {list.map((it) => {
          if ('draft' in it) return draftRow(it.depth);
          const { n, depth, kids } = it.row;
          const selected = selId === n.id;
          const picked = multi.has(n.id);
          const editing = s.edit === n.id;
          const isRun = running === n.id;
          const hlIds = s.hl[n.id] ? [n.id] : kids && !n.open ? hlSubtree(s.nodes, s.hl, n.id) : [];
          const done = isDone(s.nodes, n.id);
          const h = hint?.id === n.id ? hint.zone : null;
          const pm = marks?.[n.id];
          const pk = (k: string) => pm?.kind === 'change' && k in pm.prev;
          // a proposed change hidden under a collapsed parent shows on the parent
          const propHidden = !!marks && kids && !n.open && [...subtree(s.nodes, n.id)].some((id) => id !== n.id && marks[id]);
          return (
            <div
              key={n.id}
              data-fr={n.id}
              data-sel={selected || undefined}
              style={{ ['--d' as string]: depth } as React.CSSProperties}
              className={cx('orow', depth === 0 && 'top', kids && 'has-kids', selected && 'is-sel', picked && !selected && 'is-multi', done && 'done', n.status === 'dropped' && 'dropped', isRun && 'live', hlIds.length > 0 && 'hl', (pm || propHidden) && 'prop', pm && `prop-${pm.kind}`, pk('today') && 'prop-add', dragId === n.id && 'dragging', h && `drop-${h}`)}
              onMouseMove={hlIds.length ? () => dismissHl(hlIds) : undefined}
              draggable={!editing}
              onClick={(e) => onRowClick(e, n.id)}
              onDoubleClick={() => set(() => ({ edit: n.id }))}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!picked) select(n.id);
                openMenu(picked ? { t: 'multi', ids: live } : { t: 'node', id: n.id }, e.clientX, e.clientY);
              }}
              onDragStart={(e) => {
                dnd.current = n.id;
                e.dataTransfer.setData('text/plain', n.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragId(n.id);
              }}
              onDragEnd={() => {
                dnd.current = null;
                setDragId(null);
                setHint(null);
              }}
              onDragOver={(e) => {
                if (!dnd.current && !isExt(e)) return;
                const z = zoneOf(e);
                if (!resolveDrop(dnd.current ?? '', n, z)) return;
                e.preventDefault();
                e.stopPropagation();
                setHint({ id: n.id, zone: z });
              }}
              onDrop={(e) => {
                if (isExt(e)) {
                  const r = resolveDrop('', n, zoneOf(e));
                  setHint(null);
                  if (!r) return;
                  e.preventDefault();
                  e.stopPropagation();
                  return fileInboxTo(extIds(e), r.parentId, r.beforeId);
                }
                if (!dnd.current) return;
                const r = resolveDrop(dnd.current, n, zoneOf(e));
                const src = dnd.current;
                dnd.current = null;
                setHint(null);
                if (!r) return;
                e.preventDefault();
                e.stopPropagation();
                moveNode(src, r.parentId, r.beforeId);
              }}
            >
              {kids ? (
                <button className="rchev" tabIndex={-1} aria-label={n.open ? 'Collapse' : 'Expand'} onClick={(e) => (e.stopPropagation(), toggleOpen(n.id, !n.open))}>
                  {n.open ? '▾' : '▸'}
                </button>
              ) : null}
              <button className={cx('check', kids && 'sq', done && 'on')} tabIndex={-1} aria-label={done ? 'Mark not done' : 'Mark done'} onClick={(e) => (e.stopPropagation(), toggleDoneNodes([n.id]))}>
                {done ? '✓' : ''}
              </button>
              {editing ? (
                <InlineEdit
                  initial={n.title}
                  onCommit={(t) => (editText(n.id, t), set(() => ({ edit: null })), focusArea())}
                  onCancel={() => (set(() => ({ edit: null })), focusArea())}
                />
              ) : (
                <>
                  <span className={cx('c-title ttl', pk('title') && 'pk')}>
                    {inline(n.title.split('\n')[0])}
                    {pm?.kind === 'add' && <span className="propchip">new</span>}
                    {n.title.includes('\n') && <span className="mini">⋯</span>}
                    <Chips node={n} />
                    {!wide && <DueChip node={n} />}
                  </span>
                  {isRun && <span className="pulse-dot" title="Running" />}
                  {wide ? (
                    <>
                      <span className={cx('c-m', pk('est') && 'pk')}>{fmtEst(n.est)}</span>
                      <span className={cx('c-m', pk('due') && 'pk')}>{n.due ? n.due.slice(5) : ''}</span>
                      <span className="c-m">{relTime(n.modified)}</span>
                      <span className="c-m">{n.lastRun ? relTime(n.lastRun) : '—'}</span>
                      <span className={cx('c-m', pk('today') && 'pk')}>{n.today ? '★ today' : n.later != null ? laterLabel(n.later) : ''}</span>
                    </>
                  ) : (
                    <>
                      {n.today && <span className="todaydot" title="In Next">★</span>}
                      {n.est && <span className={cx('est', pk('est') && 'pk')}>{fmtEst(n.est)}</span>}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {live.length > 1 && <div className="multibar">{live.length} selected — <kbd>Space</kbd> done · <kbd>⌘[</kbd> <kbd>⌘]</kbd> outdent / indent · <kbd>⌘↑↓</kbd> move · <kbd>⌫</kbd> delete · <kbd>/</kbd> more · <kbd>Esc</kbd> clear</div>}
      {!embedded && <div className="keys">
        <kbd>↑↓</kbd> move · <kbd>←→</kbd> fold · <kbd>−</kbd><kbd>+</kbd> all · <kbd>⏎</kbd> edit · <kbd>⇧Space</kbd> start · <kbd>Space</kbd> done · <kbd>⌘⏎</kbd> new · <kbd>A</kbd> sub-item · <kbd>⌘[</kbd><kbd>⌘]</kbd> level · <kbd>⌘↑↓</kbd> reorder · <kbd>⇧↑↓</kbd> multi-select · <kbd>T</kbd> in Next · <kbd>⌘C</kbd>/<kbd>⌘V</kbd> copy / paste · <kbd>/</kbd> commands
      </div>}
    </div>
  );
}

export { estimate, startFirst };
