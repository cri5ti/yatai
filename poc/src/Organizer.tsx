import { useEffect, useMemo, useRef, useState } from 'react';
import { set, useS } from './store';
import type { Kind, Node } from './store';
import {
  addNode, breakDown, canParent, cycleEst, editText, estimate, leafIds, moveNode, removeNodes, reorder, startFirst,
  startFocus, toast, toggleDoneNodes, toggleOpen, toggleStart, toggleToday,
} from './actions';
import { openEstMenu, openMenu } from './commands';
import { childrenOf, fmt, fmtEst, laterLabel, relTime } from './model';
import { InlineEdit } from './Inline';
import { inline } from './md';
import { Chips, DueChip } from './Chips';
import { useFlip } from './flip';
import { cx, focusArea, isEditable, mod } from './kbd';

const icon = { project: '▣', task: '◧', action: '•' } as const;

interface RowItem {
  n: Node;
  depth: number;
}
function visibleRows(nodes: Node[]): RowItem[] {
  const out: RowItem[] = [];
  const walk = (pid: string | null, d: number) => {
    for (const n of childrenOf(nodes, pid)) {
      out.push({ n, depth: d });
      if (n.open) walk(n.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

type Hint = { id: string; zone: 'before' | 'inside' | 'after' };

export function Organizer() {
  const s = useS();
  const rows = useMemo(() => visibleRows(s.nodes), [s.nodes]);
  const area = useRef<HTMLDivElement>(null);
  const dnd = useRef<string | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const wide = s.layout === 'max';
  useFlip(area, 'data-fr');

  // selection always resolves to something visible (a collapsed parent stands in for hidden children)
  const selId = useMemo(() => {
    let cur: Node | undefined = s.nodes.find((n) => n.id === s.sel);
    const vis = new Set(rows.map((r) => r.n.id));
    while (cur && !vis.has(cur.id)) cur = s.nodes.find((n) => n.id === cur!.parentId);
    return cur?.id ?? rows[0]?.n.id ?? null;
  }, [s.sel, s.nodes, rows]);
  const selNode = s.nodes.find((n) => n.id === selId) ?? null;

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    area.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selId, rows.length]);

  const select = (id: string | null) => set(() => ({ sel: id }));
  const insertSibling = (n: Node) => set(() => ({ ins: { kind: 'node', nodeKind: n.kind, parentId: n.parentId, afterId: n.id } }));
  const insertChild = (n: Node) => {
    if (n.kind === 'action') return insertSibling(n);
    set(() => ({ ins: { kind: 'node', nodeKind: n.kind === 'project' ? 'task' : 'action', parentId: n.id, afterId: n.id } }));
    toggleOpen(n.id, true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target) || e.altKey) return;
    const k = e.key;
    const M = mod(e);
    const stop = () => (e.preventDefault(), e.stopPropagation());
    const i = rows.findIndex((r) => r.n.id === selId);
    const cur = i >= 0 ? rows[i].n : null;

    if (M && k === 'Enter') {
      stop();
      if (e.shiftKey) {
        if (cur?.kind === 'action') startFocus(cur.id);
        else if (cur) (startFirst(cur.id), s.current && startFocus(s.current.id));
        return;
      }
      if (cur) insertSibling(cur);
      else set(() => ({ ins: { kind: 'node', nodeKind: 'project', parentId: null, afterId: null } }));
      return;
    }
    if (M && (k === 'ArrowUp' || k === 'ArrowDown')) {
      stop();
      if (cur) reorder(cur.id, k === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight') && cur && cur.kind !== 'project') {
      stop();
      return cycleEst([cur.id], k === 'ArrowRight' ? 1 : -1);
    }
    if (M || e.shiftKey) {
      if (!(e.shiftKey && k === 'N')) return;
    }

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
    else if (k === 'N') {
      stop();
      set(() => ({ ins: { kind: 'node', nodeKind: 'project', parentId: null, afterId: null } }));
    } else if (k === '/' ) (stop(), openMenu(cur ? { t: 'node', id: cur.id } : null, undefined, undefined, { slash: true }));
    else if (!cur) return;
    else if (k === 'Enter') {
      stop();
      cur.kind === 'action' ? (cur.smart ? toast(`(mock) opening ${cur.title.split('\n')[0]} in browser`) : toggleStart(cur.id)) : startFirst(cur.id);
    } else if (k === 'r' || k === 'F2') (stop(), set(() => ({ edit: cur.id })));
    else if (k === ' ') (stop(), toggleDoneNodes(leafIds(s.nodes, cur.id)));
    else if (k === 't') (stop(), cur.kind !== 'project' && toggleToday(cur.id));
    else if (k === 'f') (stop(), cur.kind === 'action' && startFocus(cur.id));
    else if (k === 'a') (stop(), insertChild(cur));
    else if (k === 'n') (stop(), insertSibling(cur));
    else if (k === 'b') (stop(), cur.kind !== 'project' && breakDown(cur.id));
    else if (k === 'e') (stop(), cur.kind === 'action' ? openEstMenu([cur.id]) : estimate(cur.id));
    else if (k === 'Delete' || k === 'Backspace') {
      stop();
      const next = rows[i + 1]?.n.id ?? rows[i - 1]?.n.id ?? null;
      removeNodes([cur.id]);
      select(next);
    }
  };

  /* ---- drag & drop: before / inside / after a row ---- */
  const zoneOf = (e: React.DragEvent): Hint['zone'] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    return f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside';
  };
  const resolveDrop = (srcId: string, target: Node, zone: Hint['zone']) => {
    const src = s.nodes.find((n) => n.id === srcId);
    if (!src || src.id === target.id) return null;
    if (zone === 'inside') return canParent(src.kind, target) ? { parentId: target.id, beforeId: null as string | null } : null;
    const parent = s.nodes.find((n) => n.id === target.parentId) ?? null;
    if (!canParent(src.kind, parent)) return null;
    if (zone === 'before') return { parentId: target.parentId, beforeId: target.id };
    const sibs = childrenOf(s.nodes, target.parentId).filter((n) => n.id !== srcId);
    const nxt = sibs[sibs.findIndex((n) => n.id === target.id) + 1];
    return { parentId: target.parentId, beforeId: nxt?.id ?? null };
  };

  /* ---- inline creation draft goes after the subtree of its anchor ---- */
  const ins = s.ins?.kind === 'node' ? s.ins : null;
  const list: ({ row: RowItem } | { draft: true; depth: number })[] = rows.map((row) => ({ row }));
  if (ins) {
    const ai = ins.afterId ? rows.findIndex((r) => r.n.id === ins.afterId) : -1;
    let at = rows.length;
    let depth = 0;
    if (ai >= 0) {
      const base = rows[ai].depth;
      at = ai + 1;
      while (at < rows.length && rows[at].depth > base) at++;
      depth = ins.parentId === ins.afterId ? base + 1 : base;
    }
    list.splice(at, 0, { draft: true, depth });
  }

  const draftRow = (depth: number) => (
    <div key="draft" className="orow draft" style={{ paddingLeft: 8 + depth * 18 }}>
      <span className="chev empty" />
      <span className="kind">{icon[ins!.nodeKind]}</span>
      <InlineEdit
        multiline={ins!.nodeKind === 'action'}
        placeholder={`New ${ins!.nodeKind}…  (⌘⏎ to keep adding)`}
        onCommit={(t, chain) => {
          const id = addNode(ins!.nodeKind, ins!.parentId, t, ins!.afterId);
          const sibling = { kind: 'node' as const, nodeKind: ins!.nodeKind as Kind, parentId: ins!.parentId, afterId: id };
          set(() => ({ ins: chain ? sibling : null }));
          if (!chain) focusArea();
        }}
        onCancel={() => (set(() => ({ ins: null })), focusArea())}
      />
    </div>
  );

  const running = s.current?.id;

  return (
    <div className="organizer view">
      <div className="thead">
        <div>
          <div className="h1">Organizer</div>
          <div className="sub">{s.nodes.filter((n) => n.kind === 'action' && n.status !== 'done' && n.status !== 'dropped').length} open actions</div>
        </div>
        <button className="btn" title="New project (⇧N)" onClick={() => set(() => ({ ins: { kind: 'node', nodeKind: 'project', parentId: null, afterId: null } }))}>
          ＋ Project
        </button>
      </div>

      {wide && (
        <div className="ohead">
          <span className="c-title">Title</span>
          <span className="c-m">Est</span>
          <span className="c-m">Modified</span>
          <span className="c-m">Last run</span>
          <span className="c-m">Scheduled</span>
        </div>
      )}

      <div
        className="tree kbd-area"
        data-kbd-area
        tabIndex={0}
        ref={area}
        onKeyDown={onKey}
        aria-label="Organizer — arrows to navigate, ? for shortcuts"
        onDragOver={(e) => {
          if (dnd.current && !e.defaultPrevented) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!dnd.current || e.defaultPrevented) return;
          e.preventDefault();
          const src = s.nodes.find((n) => n.id === dnd.current);
          dnd.current = null;
          setHint(null);
          if (src?.kind === 'project') moveNode(src.id, null, null);
        }}
      >
        {list.map((it) => {
          if ('draft' in it) return draftRow(it.depth);
          const { n, depth } = it.row;
          const kids = childrenOf(s.nodes, n.id).length > 0;
          const selected = selId === n.id;
          const editing = s.edit === n.id;
          const isRun = running === n.id;
          const h = hint?.id === n.id ? hint.zone : null;
          return (
            <div
              key={n.id}
              data-fr={n.id}
              data-sel={selected || undefined}
              className={cx('orow', `k-${n.kind}`, selected && 'is-sel', n.status === 'done' && 'done', n.status === 'dropped' && 'dropped', isRun && 'live', dragId === n.id && 'dragging', h && `drop-${h}`)}
              style={{ paddingLeft: 8 + depth * 18 }}
              draggable={!editing}
              onClick={() => select(n.id)}
              onDoubleClick={() => set(() => ({ edit: n.id }))}
              onContextMenu={(e) => {
                e.preventDefault();
                select(n.id);
                openMenu({ t: 'node', id: n.id }, e.clientX, e.clientY);
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
                if (!dnd.current) return;
                const z = zoneOf(e);
                if (!resolveDrop(dnd.current, n, z)) return;
                e.preventDefault();
                e.stopPropagation();
                setHint({ id: n.id, zone: z });
              }}
              onDrop={(e) => {
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
              <span className={cx('chev', !kids && 'empty')} onClick={(e) => (e.stopPropagation(), kids && toggleOpen(n.id, !n.open))}>
                {kids ? (n.open ? '▾' : '▸') : ''}
              </span>
              <span className="kind">{icon[n.kind]}</span>
              {editing ? (
                <InlineEdit
                  multiline={n.kind === 'action'}
                  initial={n.title}
                  onCommit={(t) => (editText(n.id, t), set(() => ({ edit: null })), focusArea())}
                  onCancel={() => (set(() => ({ edit: null })), focusArea())}
                />
              ) : (
                <span className="c-title ttl">
                  {inline(n.title.split('\n')[0])}
                  {n.title.includes('\n') && <span className="mini">⋯</span>}
                  <Chips node={n} />
                  <DueChip node={n} />
                </span>
              )}
              {isRun && <span className="pulse-dot" title="Running" />}
              {n.today && <span className="todaydot" title="In Next">★</span>}
              {wide ? (
                <>
                  <span className="c-m">{fmtEst(n.est)}</span>
                  <span className="c-m">{relTime(n.modified)}</span>
                  <span className="c-m">{n.lastRun ? relTime(n.lastRun) : '—'}</span>
                  <span className="c-m">{n.scheduled != null ? fmt(n.scheduled) : n.today ? 'today' : n.later != null ? laterLabel(n.later) : n.due ? `due ${n.due.slice(5)}` : '—'}</span>
                </>
              ) : (
                n.est && <span className="est">{fmtEst(n.est)}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="obar">
        <div className="obtns">
          <button className="btn sm" disabled={!selNode || selNode.kind === 'project'} onClick={() => selNode && toggleToday(selNode.id)}>
            ★ Next
          </button>
          <button className="btn sm" disabled={!selNode || selNode.kind === 'project'} onClick={() => selNode && (selNode.kind === 'action' ? startFocus(selNode.id) : startFirst(selNode.id))}>
            ▶ Start
          </button>
          <button className="btn sm ai" disabled={!selNode || selNode.kind === 'project' || !!s.aiBusy} onClick={() => selNode && breakDown(selNode.id)}>
            ✨ Break down
          </button>
          <button className="btn sm ai" disabled={!selNode || !!s.aiBusy} onClick={() => selNode && estimate(selNode.id)}>
            ✨ Estimate
          </button>
        </div>
        <div className="keys">
          <kbd>↑↓</kbd> move · <kbd>←→</kbd> fold · <kbd>⏎</kbd> start · <kbd>R</kbd> rename · <kbd>Space</kbd> done · <kbd>⌘⏎</kbd> new · <kbd>A</kbd> child · <kbd>⌘↑↓</kbd> reorder · <kbd>T</kbd> in Next · <kbd>/</kbd> commands
        </div>
      </div>
    </div>
  );
}
