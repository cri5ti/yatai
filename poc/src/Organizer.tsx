import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import type { Node } from './store';
import {
  addNode, breakDown, estimate, patch, removeNode, reorder, startFocus, toggleDone, toggleOpen, toggleToday,
} from './actions';
import { childrenOf, fmt, fmtEst, relTime } from './model';
import { set } from './store';
import { Chips } from './Today';

const icon = { project: '▣', task: '◧', action: '•' } as const;

function visibleRows(nodes: Node[]) {
  const out: { n: Node; depth: number }[] = [];
  const walk = (pid: string | null, d: number) => {
    for (const n of childrenOf(nodes, pid)) {
      out.push({ n, depth: d });
      if (n.open) walk(n.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function Organizer() {
  const s = useS();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const rows = visibleRows(s.nodes);
  const selNode = s.nodes.find((n) => n.id === s.sel) ?? null;
  const wide = s.layout === 'max';

  useEffect(() => {
    box.current?.focus();
  }, []);
  useEffect(() => {
    box.current?.querySelector('.orow.sel')?.scrollIntoView({ block: 'nearest' });
  }, [s.sel, rows.length]);

  const select = (id: string | null) => set(() => ({ sel: id }));
  const startEdit = (n: Node) => {
    setEditing(n.id);
    setDraft(n.title);
  };
  const commit = () => {
    if (!editing) return;
    const n = s.nodes.find((x) => x.id === editing);
    if (draft.trim()) patch(editing, { title: draft.trim() });
    else if (n && !n.title) removeNode(editing);
    setEditing(null);
    box.current?.focus();
  };
  const cancel = () => {
    const n = s.nodes.find((x) => x.id === editing);
    if (n && !n.title) removeNode(editing!);
    setEditing(null);
    box.current?.focus();
  };

  const newChild = (n: Node) => {
    if (n.kind === 'action') return newSibling(n);
    const id = addNode(n.kind === 'project' ? 'task' : 'action', n.id, '', lastChildOrSelf(n));
    setEditing(id);
    setDraft('');
  };
  const lastChildOrSelf = (n: Node) => {
    const kids = childrenOf(s.nodes, n.id);
    return kids.length ? kids[kids.length - 1].id : n.id;
  };
  const newSibling = (n: Node) => {
    const id = addNode(n.kind, n.parentId, '', n.id);
    setEditing(id);
    setDraft('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const i = rows.findIndex((r) => r.n.id === s.sel);
    const cur = i >= 0 ? rows[i] : null;
    const k = e.key;
    const stop = () => (e.preventDefault(), e.stopPropagation());

    if (k === 'ArrowDown' || k === 'ArrowUp') {
      stop();
      if (e.altKey && cur) return reorder(cur.n.id, k === 'ArrowUp' ? -1 : 1);
      const j = Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)));
      select(rows[j]?.n.id ?? null);
    } else if (k === 'ArrowRight' && cur) {
      stop();
      const kids = childrenOf(s.nodes, cur.n.id);
      if (kids.length && !cur.n.open) toggleOpen(cur.n.id, true);
      else if (kids.length) select(kids[0].id);
    } else if (k === 'ArrowLeft' && cur) {
      stop();
      const kids = childrenOf(s.nodes, cur.n.id);
      if (kids.length && cur.n.open) toggleOpen(cur.n.id, false);
      else if (cur.n.parentId) select(cur.n.parentId);
    } else if (k === 'Home') (stop(), select(rows[0]?.n.id ?? null));
    else if (k === 'End') (stop(), select(rows[rows.length - 1]?.n.id ?? null));
    else if (!cur && k !== 'N') return;
    else if (k === 'Enter' && cur) (stop(), startEdit(cur.n));
    else if (k === ' ' && cur) (stop(), cur.n.kind !== 'project' && toggleDone(cur.n.id));
    else if (k === 't' && cur) (stop(), cur.n.kind !== 'project' && toggleToday(cur.n.id));
    else if (k === 'f' && cur) (stop(), cur.n.kind === 'action' && startFocus(cur.n.id));
    else if (k === 'a' && cur) (stop(), newChild(cur.n));
    else if (k === 'n' && cur) (stop(), newSibling(cur.n));
    else if (k === 'N') {
      stop();
      const id = addNode('project', null, '');
      setEditing(id);
      setDraft('');
    } else if (k === 'b' && cur) (stop(), cur.n.kind !== 'project' && breakDown(cur.n.id));
    else if (k === 'e' && cur) (stop(), estimate(cur.n.id));
    else if ((k === 'Delete' || k === 'Backspace') && cur) {
      stop();
      const next = rows[i + 1]?.n.id ?? rows[i - 1]?.n.id ?? null;
      removeNode(cur.n.id);
      select(next);
    }
  };

  return (
    <div className="organizer">
      <div className="thead">
        <div>
          <div className="h1">Organizer</div>
          <div className="sub">{s.nodes.filter((n) => n.kind === 'action' && n.status !== 'done').length} open actions</div>
        </div>
        <button
          className="btn"
          onClick={() => {
            const id = addNode('project', null, '');
            setEditing(id);
            setDraft('');
          }}
        >
          + Project
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

      <div className="tree" tabIndex={0} ref={box} onKeyDown={onKey}>
        {rows.map(({ n, depth }) => {
          const kids = childrenOf(s.nodes, n.id).length > 0;
          return (
            <div
              key={n.id}
              className={`orow k-${n.kind} ${s.sel === n.id ? 'sel' : ''} ${n.status === 'done' ? 'done' : ''}`}
              style={{ paddingLeft: 8 + depth * 18 }}
              onClick={() => select(n.id)}
              onDoubleClick={() => startEdit(n)}
            >
              <span
                className={`chev ${kids ? '' : 'empty'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  kids && toggleOpen(n.id, !n.open);
                }}
              >
                {kids ? (n.open ? '▾' : '▸') : ''}
              </span>
              <span className="kind">{icon[n.kind]}</span>
              {editing === n.id ? (
                <input
                  className="edit"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') cancel();
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span className="c-title ttl">
                  {n.title}
                  <Chips node={n} />
                </span>
              )}
              {n.today && <span className="todaydot" title="In today">★</span>}
              {wide ? (
                <>
                  <span className="c-m">{fmtEst(n.est)}</span>
                  <span className="c-m">{relTime(n.modified)}</span>
                  <span className="c-m">{n.lastRun ? relTime(n.lastRun) : '—'}</span>
                  <span className="c-m">{n.scheduled != null ? fmt(n.scheduled) : n.today ? 'today' : '—'}</span>
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
            ★ Today
          </button>
          <button className="btn sm" disabled={selNode?.kind !== 'action'} onClick={() => selNode && startFocus(selNode.id)}>
            ▶ Focus
          </button>
          <button className="btn sm ai" disabled={!selNode || selNode.kind === 'project' || !!s.aiBusy} onClick={() => selNode && breakDown(selNode.id)}>
            ✨ Break down
          </button>
          <button className="btn sm ai" disabled={!selNode || !!s.aiBusy} onClick={() => selNode && estimate(selNode.id)}>
            ✨ Estimate
          </button>
        </div>
        <div className="keys">
          <kbd>↑↓</kbd> move <kbd>←→</kbd> fold <kbd>Enter</kbd> rename <kbd>a</kbd> add child <kbd>n</kbd> sibling <kbd>Space</kbd> done <kbd>t</kbd> today{' '}
          <kbd>f</kbd> focus <kbd>b</kbd> breakdown <kbd>e</kbd> est <kbd>Alt+↑↓</kbd> reorder <kbd>Del</kbd>
        </div>
      </div>
    </div>
  );
}
