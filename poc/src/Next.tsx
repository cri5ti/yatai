import { useEffect, useMemo, useRef, useState } from 'react';
import { set, useS } from './store';
import type { State } from './store';
import { effSel, fmt, fmtEst, fmtSpent, nextModel } from './model';
import type { CardM, Row } from './model';
import {
  addAction, addTaskCard, cycleEst, dropCard, dropRowInSeg, dropRowSplit, editText, moveCard, moveRow, pick,
  planToday, removeNodes, setExpanded, startCard, startFocus, toast, toggleCardOpen, toggleCheckbox, toggleDoneNodes,
  toggleStart,
} from './actions';
import { openEstMenu, openMenu } from './commands';
import { InlineEdit } from './Inline';
import { Md, bodyInfo, inline } from './md';
import { Chips, DueChip } from './Chips';
import { useFlip } from './flip';
import { cx, focusArea, isEditable, mod } from './kbd';

type Drag = { t: 'row'; id: string; owner: string; seg: string } | { t: 'card'; key: string };
type Hint = { t: 'row'; id: string; pos: 'before' | 'after' } | { t: 'card'; key: string; pos: 'before' | 'after' } | { t: 'end' };

const srcIcon: Record<string, string> = { pr: '⑂', pipeline: '⚙', workitem: '▣', ai: '✦' };

/* ---------- stopwatch for the running action ---------- */
const hms = (ms: number) => {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(t % 60)}` : `${p(m)}:${p(t % 60)}`;
};
function Stopwatch({ spent, since }: { spent: number; since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="sw" title="Time on this action">
      <i className="pulse-dot" />
      {hms(spent + Date.now() - since)}
    </span>
  );
}

/* ---------- drag helpers ---------- */
function cardHint(e: React.DragEvent, card: CardM, d: Drag): Hint | null {
  if (!card.seg || card.pinned) return null;
  if (d.t === 'card' && d.key === card.key) return null;
  if (d.t === 'row' && d.seg === card.key) return null;
  const el = (e.currentTarget as HTMLElement).closest('[data-fc]') as HTMLElement;
  const r = el.getBoundingClientRect();
  return { t: 'card', key: card.key, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
}
function rowHint(e: React.DragEvent, card: CardM, row: Row, d: Drag): Hint | null {
  if (d.t !== 'row' || !card.seg) return null;
  if (card.seg.owner === d.owner) {
    if (d.id === row.id) return null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { t: 'row', id: row.id, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
  }
  return cardHint(e, card, d);
}

interface Shared {
  s: State;
  sel: { card: string | null; row: string | null };
  hint: Hint | null;
  setHint: (h: Hint | null) => void;
  dnd: React.MutableRefObject<Drag | null>;
  dragId: string | null;
  setDragId: (id: string | null) => void;
}

/* ---------- one action row ---------- */
function RowView({ x, card, row }: { x: Shared; card: CardM; row: Row }) {
  const { s, sel, hint, dnd } = x;
  const n = row.node;
  const selected = sel.row === row.id;
  const running = !!n && s.current?.id === n.id;
  const editing = s.edit === row.id;

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pick(card.key, row.id);
    openMenu({ t: 'row', id: row.id }, e.clientX, e.clientY);
  };
  const dnh = n
    ? {
        draggable: !editing,
        onDragStart: (e: React.DragEvent) => {
          e.stopPropagation();
          dnd.current = { t: 'row', id: row.id, owner: card.ownerId, seg: card.key };
          e.dataTransfer.setData('text/plain', row.id);
          e.dataTransfer.effectAllowed = 'move';
          x.setDragId(row.id);
        },
        onDragEnd: () => {
          dnd.current = null;
          x.setHint(null);
          x.setDragId(null);
        },
      }
    : {};
  const over = {
    onDragOver: (e: React.DragEvent) => {
      const d = dnd.current;
      if (!d) return;
      const h = rowHint(e, card, row, d);
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      x.setHint(h);
    },
    onDrop: (e: React.DragEvent) => {
      const d = dnd.current;
      if (!d || d.t !== 'row') return;
      const h = rowHint(e, card, row, d);
      x.setHint(null);
      dnd.current = null;
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      if (h.t === 'row') dropRowInSeg(d.id, h.id, h.pos);
      else if (h.t === 'card') dropRowSplit(d.id, h.key, h.pos);
    },
  };
  const hcls = hint?.t === 'row' && hint.id === row.id ? `drop-${hint.pos}` : '';

  /* fixed calendar row of a meeting */
  if (row.fx) {
    const m = row.fx;
    return (
      <div
        className={cx('arow fixed', selected && 'is-sel', hcls)}
        data-fr={row.id}
        data-sel={selected || undefined}
        onClick={() => pick(card.key, row.id)}
        onContextMenu={onContext}
        {...over}
      >
        <span className="cal" title="Calendar item — fixed">
          📅
        </span>
        <div className="abody">
          <div className="first">
            {fmt(m.eff)}–{fmt(m.eff + m.durationMin)} · {m.where}
            {m.movedFrom != null && <span className="chip warn">moved from {fmt(m.movedFrom)}</span>}
          </div>
        </div>
        <div className="meta">
          <span className={`chip ${m.state === 'now' ? 'good' : m.minsAway <= 10 ? 'bad' : 'info'}`}>
            {m.state === 'now' ? 'in progress' : m.state === 'done' ? 'ended' : `in ${Math.ceil(m.minsAway)} min`}
          </span>
          <button className="btn sm" tabIndex={-1} onClick={(e) => (e.stopPropagation(), toast(`(mock) joining ${m.title}`))}>
            Join
          </button>
        </div>
      </div>
    );
  }

  const node = n!;
  const info = bodyInfo(node.title);
  const open = !!s.expanded[node.id];
  const hasBody = info.rest.some((l) => l.trim());

  return (
    <div
      className={cx('arow', node.status === 'done' && 'done', node.status === 'dropped' && 'dropped', running && 'live', selected && 'is-sel', hcls, x.dragId === row.id && 'dragging')}
      data-fr={row.id}
      data-sel={selected || undefined}
      onClick={() => pick(card.key, row.id)}
      onDoubleClick={() => set(() => ({ edit: row.id }))}
      onContextMenu={onContext}
      {...dnh}
      {...over}
    >
      <button
        className={cx('check', node.status === 'done' && 'on')}
        tabIndex={-1}
        aria-label={node.status === 'done' ? 'Mark not done' : 'Mark done'}
        onClick={(e) => (e.stopPropagation(), toggleDoneNodes([node.id]))}
      >
        {node.status === 'done' ? '✓' : ''}
      </button>
      <div className="abody">
        {editing ? (
          <InlineEdit
            initial={node.title}
            onCommit={(t) => (editText(node.id, t), set(() => ({ edit: null })), focusArea())}
            onCancel={() => (set(() => ({ edit: null })), focusArea())}
          />
        ) : (
          <>
            <div className="first">
              {node.smart && <span className="src">{srcIcon[node.smart.source]}</span>}
              {inline(info.first)}
              <Chips node={node} />
              <DueChip node={node} />
              {node.status === 'dropped' && <span className="chip info">abandoned</span>}
              {!open && info.checks.total > 0 && (
                <span className="mini" title="Checklist">
                  ☑ {info.checks.done}/{info.checks.total}
                </span>
              )}
              {!open && hasBody && <span className="mini" title="Press → to expand">⋯</span>}
            </div>
            {hasBody && (
              <div className="expand" data-open={open}>
                <div className="expand-in">
                  <Md lines={info.rest} offset={1} onToggle={(i) => toggleCheckbox(node.id, i)} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="meta">
        {running ? (
          <Stopwatch spent={node.spent ?? 0} since={s.current!.since} />
        ) : node.spent ? (
          <span className="spent" title="Time spent so far">
            {fmtSpent(node.spent)}
          </span>
        ) : null}
        <button
          className={cx('est-chip', !node.est && 'empty')}
          tabIndex={-1}
          title="Estimate (E) — shift+←/→ to scroll"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openEstMenu([node.id], r.left, r.bottom + 4);
          }}
        >
          {node.est ? fmtEst(node.est) : '＋est'}
        </button>
        {node.status !== 'done' && node.status !== 'dropped' && !node.smart && (
          <button className="play" tabIndex={-1} title={running ? 'Pause (Enter)' : 'Start (Enter)'} onClick={(e) => (e.stopPropagation(), toggleStart(node.id))}>
            {running ? '❚❚' : '▶'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- one card (a task segment, a meeting, or an alert) ---------- */
function CardView({ x, card, first }: { x: Shared; card: CardM; first: boolean }) {
  const { s, sel, hint, dnd } = x;
  const ref = useRef<HTMLElement>(null);
  useFlip(ref, 'data-fr');
  const cardSel = sel.card === card.key && !sel.row;
  const hasSel = sel.card === card.key;
  const live = card.rows.some((r) => r.node && s.current?.id === r.node.id);
  const titleEdit = s.edit === 'card:' + card.key;
  const movable = !!card.seg && !card.pinned;
  const ins = s.ins?.kind === 'action' ? s.ins : null;
  const draftHere = ins && ((ins.after && card.rows.some((r) => r.id === ins.after)) || (ins.after === null && ins.seg === card.key));

  const draft = ins && (
    <div className="arow draft">
      <span className="check" />
      <div className="abody">
        <InlineEdit
          placeholder={card.kind === 'meeting' ? 'New prep action…' : 'New action…  (⌘⏎ to keep adding)'}
          onCommit={(t, chain) => {
            const id = addAction(ins.owner, ins.seg, ins.after, t);
            set(() => ({ ins: chain ? { ...ins, after: id } : null }));
            if (!chain) focusArea();
          }}
          onCancel={() => (set(() => ({ ins: null })), focusArea())}
        />
      </div>
    </div>
  );

  const hcls = hint?.t === 'card' && hint.key === card.key ? `drop-${hint.pos}` : '';
  const title = card.kind === 'meeting' ? null : card.path;

  return (
    <section
      ref={ref}
      className={cx('card', card.kind, card.collapsed && 'collapsed', cardSel && 'is-sel', hasSel && 'has-sel', live && 'has-live', first && 'first', hcls, x.dragId === card.key && 'dragging')}
      data-fc={card.key}
      data-sel={cardSel || undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        pick(card.key, null);
        openMenu({ t: 'card', key: card.key }, e.clientX, e.clientY);
      }}
      onDragOver={(e) => {
        const d = dnd.current;
        if (!d) return;
        const h = cardHint(e, card, d);
        if (!h) return;
        e.preventDefault();
        x.setHint(h);
      }}
      onDrop={(e) => {
        const d = dnd.current;
        if (!d) return;
        const h = cardHint(e, card, d);
        x.setHint(null);
        dnd.current = null;
        if (!h || h.t !== 'card') return;
        e.preventDefault();
        if (d.t === 'card') dropCard(d.key, h.key, h.pos);
        else dropRowSplit(d.id, h.key, h.pos);
      }}
    >
      {first && <div className="nextlabel">Next up</div>}
      <header
        className="chead"
        draggable={movable && !titleEdit}
        onClick={() => pick(card.key, null)}
        onDoubleClick={() => card.kind === 'task' && toggleCardOpen(card, card.collapsed)}
        onDragStart={(e) => {
          dnd.current = { t: 'card', key: card.key };
          e.dataTransfer.setData('text/plain', card.key);
          e.dataTransfer.effectAllowed = 'move';
          x.setDragId(card.key);
        }}
        onDragEnd={() => {
          dnd.current = null;
          x.setHint(null);
          x.setDragId(null);
        }}
      >
        <button className="fold" tabIndex={-1} aria-label={card.collapsed ? 'Expand' : 'Collapse'} onClick={(e) => (e.stopPropagation(), toggleCardOpen(card, card.collapsed))} disabled={card.kind === 'attention'}>
          {card.collapsed ? '▸' : '▾'}
        </button>
        {card.kind === 'meeting' ? (
          <>
            <div className="mtime">
              <b>{fmt(card.meeting!.eff)}</b>
              <span>{card.meeting!.durationMin}m</span>
            </div>
            <div className="mtitle">{card.meeting!.title}</div>
          </>
        ) : (
          <div className="path">
            {title!.slice(0, -1).map((p, i) => (
              <span key={i} className="muted">
                {p} ›{' '}
              </span>
            ))}
            {titleEdit && card.task ? (
              <InlineEdit
                multiline={false}
                initial={card.task.title}
                onCommit={(t) => (editText(card.task!.id, t), set(() => ({ edit: null })), focusArea())}
                onCancel={() => (set(() => ({ edit: null })), focusArea())}
              />
            ) : (
              <span className="accent">{title![title!.length - 1] ?? '—'}</span>
            )}
          </div>
        )}
        <span className="grow" />
        {card.part && card.part.i > 1 && (
          <span className="part" title={`This task is split across the schedule: part ${card.part.i} of ${card.part.n}. /consolidate brings all actions together.`}>
            ⑂ {card.part.i}/{card.part.n}
          </span>
        )}
        {card.pinned && card.kind === 'meeting' && <span className="pin" title="Pinned by time — rises as it approaches">⏶</span>}
        <span className="csum">
          {card.total > 0 && `${card.done}/${card.total}`}
          {card.est > 0 && ` · ${fmtEst(card.est)}`}
        </span>
      </header>

      <div className="collapse" data-open={!card.collapsed}>
        <div className="collapse-in">
          <div className="rows">
            {ins && ins.after === null && draftHere && draft}
            {card.rows.map((r) => (
              <div key={r.id} className="rowwrap">
                <RowView x={x} card={card} row={r} />
                {ins && ins.after === r.id && draft}
              </div>
            ))}
            {card.rows.length === 0 && !draftHere && <div className="norows">No actions yet — press <kbd>→</kbd> to add one</div>}
          </div>
          {card.kind === 'attention' && (
            <div className="cardfoot">
              <button className="btn" tabIndex={-1} onClick={() => toast(`(mock) opening ${card.rows[0].node!.title.split('\n')[0]} in browser`)}>
                Open
              </button>
              <button className="btn ghost" tabIndex={-1} onClick={() => toast('(mock) snoozed for 1h')}>
                Snooze
              </button>
              {card.rows[0].node!.smart?.source === 'ai' && (
                <button className="btn ghost" tabIndex={-1} onClick={() => toast('(mock) opening session terminal')}>
                  Reply
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- the view ---------- */
export function Next() {
  const s = useS();
  const m = useMemo(() => nextModel(s), [s.nodes, s.plan, s.meetings, s.flags, s.clock]);
  const sel = effSel(m.cards, s.nsel);
  const card = m.cards.find((c) => c.key === sel.card) ?? null;
  const area = useRef<HTMLDivElement>(null);
  const dnd = useRef<Drag | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  useFlip(area, 'data-fc');

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    area.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel.card, sel.row]);

  const movable = m.cards.filter((c) => c.seg && !c.pinned);
  const lastMovable = movable[movable.length - 1];
  const x: Shared = { s, sel, hint, setHint, dnd, dragId, setDragId };

  const newTaskParent = (afterSeg: string | null) => {
    const base = m.cards.find((c) => c.key === afterSeg)?.task ?? m.cards.find((c) => c.task)?.task;
    return base?.parentId ?? s.nodes.find((n) => n.kind === 'project')?.id ?? null;
  };

  const insertHere = () => {
    if (!card) return set(() => ({ ins: { kind: 'task', afterSeg: null } }));
    if (sel.row) return set(() => ({ ins: { kind: 'action', owner: card.ownerId, seg: card.seg?.id, after: sel.row } }));
    set(() => ({ ins: { kind: 'task', afterSeg: card.seg?.id ?? null } }));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target) || e.altKey) return;
    const k = e.key;
    const M = mod(e);
    const stop = () => (e.preventDefault(), e.stopPropagation());
    const ci = card ? m.cards.indexOf(card) : -1;
    const ri = card && sel.row ? card.rows.findIndex((r) => r.id === sel.row) : -1;
    const rowNode = ri >= 0 ? card!.rows[ri].node : undefined;
    const rowFx = ri >= 0 ? card!.rows[ri].fx : undefined;

    if (M && k === 'Enter') {
      stop();
      if (e.shiftKey) {
        if (rowNode) startFocus(rowNode.id);
        else if (card) {
          const r = card.rows.find((q) => q.node && q.node.status !== 'done' && !q.node.smart);
          r ? startFocus(r.id) : toast('No open actions to focus on');
        }
        return;
      }
      return insertHere();
    }
    if (M && (k === 'ArrowUp' || k === 'ArrowDown')) {
      stop();
      const dir = k === 'ArrowUp' ? -1 : 1;
      if (sel.row) moveRow(sel.row, dir);
      else if (card?.pinned) toast(card.kind === 'meeting' ? 'Pinned by time — it rises as the meeting approaches' : 'Pinned: needs your attention', 'info');
      else if (card?.seg) moveCard(card.key, dir);
      return;
    }
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight') && rowNode) {
      stop();
      return cycleEst([rowNode.id], k === 'ArrowRight' ? 1 : -1);
    }
    if (M || e.shiftKey) return;

    switch (k) {
      case 'ArrowDown':
      case 'ArrowUp': {
        stop();
        const d = k === 'ArrowDown' ? 1 : -1;
        if (sel.row && card) pick(card.key, card.rows[Math.max(0, Math.min(card.rows.length - 1, ri + d))].id);
        else {
          const c = m.cards[Math.max(0, Math.min(m.cards.length - 1, ci + d))];
          if (c) pick(c.key, null);
        }
        return;
      }
      case 'ArrowRight': {
        stop();
        if (!card) return;
        if (!sel.row) {
          if (card.collapsed) toggleCardOpen(card, true);
          else if (card.rows.length) pick(card.key, card.rows[0].id);
          else set(() => ({ ins: { kind: 'action', owner: card.ownerId, seg: card.seg?.id, after: null } }));
        } else if (rowNode && bodyInfo(rowNode.title).rest.some((l) => l.trim()) && !s.expanded[rowNode.id]) setExpanded(rowNode.id, true);
        return;
      }
      case 'ArrowLeft': {
        stop();
        if (!card) return;
        if (sel.row) {
          if (rowNode && s.expanded[rowNode.id]) setExpanded(rowNode.id, false);
          else pick(card.key, null);
        } else if (!card.collapsed && card.kind !== 'attention') toggleCardOpen(card, false);
        return;
      }
      case 'Home':
      case 'End': {
        stop();
        const list = sel.row && card ? card.rows.map((r) => r.id) : m.cards.map((c) => c.key);
        const id = list[k === 'Home' ? 0 : list.length - 1];
        if (id) (sel.row ? pick(card!.key, id) : pick(id, null));
        return;
      }
      case 'Escape':
        if (sel.row && card) (stop(), pick(card.key, null));
        return;
      case 'Enter': {
        stop();
        if (!card) return;
        if (rowFx) return toast(`(mock) joining ${rowFx.title}`);
        if (rowNode) return rowNode.smart ? toast(`(mock) opening ${rowNode.title.split('\n')[0]} in browser`) : toggleStart(rowNode.id);
        return startCard(card);
      }
      case ' ': {
        stop();
        if (rowNode) toggleDoneNodes([rowNode.id]);
        else if (card && !sel.row) toggleDoneNodes(card.rows.filter((r) => r.node).map((r) => r.id));
        return;
      }
      case 'r':
      case 'F2': {
        stop();
        if (rowNode) set(() => ({ edit: rowNode.id }));
        else if (rowFx) toast('Calendar items are fixed — add actions around them instead');
        else if (card?.task && !sel.row) set(() => ({ edit: 'card:' + card.key }));
        return;
      }
      case 'e':
        if (rowNode) (stop(), openEstMenu([rowNode.id]));
        return;
      case 'f':
        if (rowNode) (stop(), startFocus(rowNode.id));
        return;
      case 'Delete':
      case 'Backspace': {
        stop();
        if (!card) return;
        if (rowNode) {
          const nxt = card.rows[ri + 1]?.id ?? card.rows[ri - 1]?.id ?? null;
          removeNodes([rowNode.id]);
          pick(card.key, nxt);
        } else if (rowFx) toast('The calendar item itself is managed in Outlook');
        else if (card.task && !sel.row) {
          const nxt = (m.cards[ci + 1] ?? m.cards[ci - 1])?.key ?? null;
          removeNodes([card.task.id], 'Delete task');
          pick(nxt, null);
        } else if (card.kind === 'meeting') toast('Calendar items are managed in Outlook');
        return;
      }
      case '/':
        stop();
        return openMenu(sel.row ? { t: 'row', id: sel.row } : card ? { t: 'card', key: card.key } : null, undefined, undefined, { slash: true });
    }
  };

  const draftTask = s.ins?.kind === 'task' ? s.ins : null;
  const draftAt = !draftTask
    ? null
    : draftTask.afterSeg === null
      ? -1
      : (() => {
          const i = m.cards.findIndex((c) => c.key === draftTask.afterSeg);
          return i >= 0 ? i : m.cards.length - 1;
        })();
  const taskDraft = draftTask && (
    <div className="card draft" key="draft-task">
      <header className="chead">
        <div className="path">
          <InlineEdit
            multiline={false}
            placeholder="New task…  (Enter, then add its first action)"
            onCommit={(t) => {
              const r = addTaskCard(newTaskParent(draftTask.afterSeg), t, draftTask.afterSeg);
              set(() => ({ ins: { kind: 'action', owner: r.id, seg: r.seg, after: null } }));
            }}
            onCancel={() => (set(() => ({ ins: null })), focusArea())}
          />
        </div>
      </header>
    </div>
  );

  return (
    <div className="next view">
      <div className="thead">
        <div>
          <div className="h1">Next</div>
          <div className="sub">
            {fmt(s.clock)} · {m.done}/{m.total} done
          </div>
        </div>
        <div className="hbtns">
          <button className="btn" title="New task (⌘⏎)" onClick={() => (set(() => ({ ins: { kind: 'task', afterSeg: card?.seg?.id ?? null } })), area.current?.focus())}>
            ＋ Task
          </button>
          <button className="btn ai" disabled={!!s.aiBusy} onClick={planToday} title="AI: plan today">
            ✨ Plan
          </button>
        </div>
      </div>
      {m.total > 0 && (
        <div className="progress">
          <i style={{ width: `${(m.done / m.total) * 100}%` }} />
        </div>
      )}

      <div
        className="cards kbd-area"
        data-kbd-area
        tabIndex={0}
        ref={area}
        onKeyDown={onKey}
        aria-label="Next — arrows to navigate, ? for shortcuts"
        onDragOver={(e) => {
          if (dnd.current && lastMovable && !e.defaultPrevented) {
            e.preventDefault();
            setHint({ t: 'end' });
          }
        }}
        onDrop={(e) => {
          const d = dnd.current;
          if (!d || !lastMovable || e.defaultPrevented) return;
          e.preventDefault();
          dnd.current = null;
          setHint(null);
          if (d.t === 'card') dropCard(d.key, null, 'after');
          else dropRowSplit(d.id, lastMovable.key, 'after');
        }}
      >
        {m.cards.length === 0 && !draftTask && (
          <div className="empty">
            <div className="big">All clear 🎉</div>
            <p>Nothing queued. Press <kbd>⌘⏎</kbd> to add a task, ✨ Plan, or pick from the Organizer.</p>
          </div>
        )}
        {draftAt === -1 && taskDraft}
        {m.cards.map((c, i) => (
          <div key={c.key} className="cardwrap">
            <CardView x={x} card={c} first={i === 0} />
            {draftAt === i && taskDraft}
          </div>
        ))}
        <div className={cx('endzone', hint?.t === 'end' && 'over')} />
      </div>

      <div className="keys">
        <kbd>↑↓</kbd> cards · <kbd>→</kbd> actions · <kbd>←</kbd> back · <kbd>⏎</kbd> start · <kbd>Space</kbd> done · <kbd>⌘⏎</kbd> new · <kbd>⌘↑↓</kbd> reorder · <kbd>⇧←→</kbd> estimate · <kbd>/</kbd> commands · <kbd>?</kbd> all
      </div>
    </div>
  );
}
