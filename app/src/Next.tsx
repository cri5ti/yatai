import { useEffect, useMemo, useRef, useState } from 'react';
import { set } from './store';
import type { State } from './store';
import { useView } from './proposal';
import type { Mark, Marks } from './proposal';
import { ROOT, effSel, isLoose, isUnder, fmt, fmtEst, fmtSpent, hasKids, hlForCard, hlForRow, nextModel, navList, prLinks, whenLabel, inLabel } from './model';
import type { CardM, Row } from './model';
import {
  addAction, cycleEst, dismissHl, removeMeeting, dropCard, dropOnRow, dropRowSplit, editText, focusItem, indentItems, isDone, moveCard, moveRow,
  moveRows, openAllNext, outdentItems, pasteItems, pick, removeNodes, unplan, setExpanded, setMulti, startCard, toast, toggleCardOpen, toggleCheckbox,
  toggleDoneNodes, toggleOpen, toggleStart, toggleStartItem,
} from './actions';
import { openEstMenu, openMenu } from './commands';
import { InlineEdit } from './Inline';
import { countItems, parseMarkdown, toMarkdown, treeOf } from './clip';
import { Md, bodyInfo, inline } from './md';
import { Chips, DueChip } from './Chips';
import { useFlip } from './flip';
import { useDragEnd } from './drag';
import { cx, focusArea, isEditable, mod } from './kbd';

/** whole: the row is its card's top row, so dragging it between cards moves the whole card */
type Drag = { t: 'row'; id: string; seg: string; whole: boolean } | { t: 'card'; key: string };
/** on a row: before / after it (its sibling) or into it (its child) — a tree move, anywhere; between cards: a plan move */
type Hint = { t: 'row'; id: string; card: string; pos: 'before' | 'after' | 'into' } | { t: 'card'; key: string; pos: 'before' | 'after' } | { t: 'end' };
const sameHint = (a: Hint | null, b: Hint | null) => JSON.stringify(a) === JSON.stringify(b);

const srcIcon: Record<string, string> = { pr: '⑂', pipeline: '⚙', workitem: '▣', ai: '✦' };

/* ---------- stopwatch for the running item ---------- */
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
    <span className="sw" title="Time on this item">
      <i className="pulse-dot" />
      {hms(spent + Date.now() - since)}
    </span>
  );
}

/* ---------- drag helpers ---------- */
/** between cards: before / after this one (a card's own top row cannot go next to its own card) */
function cardHint(e: React.DragEvent, card: CardM, d: Drag): Hint | null {
  if (!card.seg || card.pinned) return null;
  if (d.t === 'card' && d.key === card.key) return null;
  if (d.t === 'row' && d.whole && d.seg === card.key) return null;
  const el = (e.currentTarget as HTMLElement).closest('[data-fc]') as HTMLElement;
  const r = el.getBoundingClientRect();
  return { t: 'card', key: card.key, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
}
/** on a row: top edge = before it, bottom edge = after it, middle = into it. 'no' = not here (into itself) */
function rowHint(e: React.DragEvent, card: CardM, ri: number, d: Drag, nodes: State['nodes']): Hint | 'no' | null {
  const row = card.rows[ri];
  if (d.t !== 'row' || !row.node || !card.seg) return null;
  if (isUnder(nodes, row.node.id, d.id)) return 'no';
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const edge = Math.min(r.height * 0.3, 14);
  const pos = e.clientY < r.top + edge ? 'before' : e.clientY > r.bottom - edge ? 'after' : 'into';
  // above / below a card's item that is not in Next itself: next to the card
  if (row.head && pos !== 'into') return cardHint(e, card, d);
  // just below an open item: its first child
  const below = card.rows[ri + 1];
  if (pos === 'after' && row.kids && row.node.open !== false && below && below.depth > row.depth) return isUnder(nodes, below.id, d.id) ? 'no' : { t: 'row', id: below.id, card: card.key, pos: 'before' };
  return { t: 'row', id: row.id, card: card.key, pos };
}
/** a drop between cards: the whole card moves, or a row splits out into a card of its own there */
function dropBetween(d: Drag, key: string | null, pos: 'before' | 'after', last: string | null) {
  if (d.t === 'card') return dropCard(d.key, key, pos);
  if (d.whole) return dropCard(d.seg, key, pos);
  if (key ?? last) dropRowSplit(d.id, (key ?? last)!, key ? pos : 'after');
}

/** purple: what a pending AI proposal adds / changes / removes */
const propCls = (m?: Mark) => m && `prop prop-${m.kind}`;
const propTip = (m?: Mark) =>
  m &&
  (m.kind === 'add'
    ? 'Proposed by AI: new'
    : m.kind === 'remove'
      ? 'Proposed by AI: remove'
      : `Proposed by AI: ${Object.keys(m.prev).map((k) => (k === 'today' ? 'Next' : k === 'parent' ? 'moved here' : k)).join(', ')}`);

interface Shared {
  s: State;
  marks: Marks | null;
  sel: { card: string | null; row: string | null };
  multi: Set<string>;
  hint: Hint | null;
  setHint: (h: Hint | null) => void;
  dnd: React.MutableRefObject<Drag | null>;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  endDrag: () => void;
  onSelect: (e: React.MouseEvent, card: CardM, row: string | null) => void;
}

/* ---------- one row ---------- */
function RowView({ x, card, ri }: { x: Shared; card: CardM; ri: number }) {
  const row = card.rows[ri];
  const { s, sel, hint, dnd } = x;
  const n = row.node;
  const selected = sel.row === row.id;
  const picked = !!n && x.multi.has(n.id);
  const running = !!n && s.current?.id === n.id;
  const editing = s.edit === row.id;
  const style = { ['--d' as string]: row.depth } as React.CSSProperties;

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!(n && x.multi.has(n.id) && x.multi.size > 1)) pick(card.key, row.id);
    openMenu(n && x.multi.has(n.id) && x.multi.size > 1 ? { t: 'multi', ids: [...x.multi] } : { t: 'row', id: row.id }, e.clientX, e.clientY);
  };
  const dnh =
    n
      ? {
          draggable: !editing,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            const whole = ri === 0 && (!!row.head || card.ownerId === ROOT);
            dnd.current = { t: 'row', id: row.id, seg: card.key, whole };
            e.dataTransfer.setData('text/plain', row.id);
            e.dataTransfer.effectAllowed = 'move';
            x.setDragId(whole ? card.key : row.id);
          },
          onDragEnd: x.endDrag,
        }
      : {};
  const over = {
    onDragOver: (e: React.DragEvent) => {
      const d = dnd.current;
      if (!d) return;
      const h = rowHint(e, card, ri, d, s.nodes);
      if (!h) return;
      e.stopPropagation();
      if (h === 'no') return x.setHint(null);
      e.preventDefault();
      x.setHint(h);
    },
    onDrop: (e: React.DragEvent) => {
      const d = dnd.current;
      if (!d) return;
      const h = rowHint(e, card, ri, d, s.nodes);
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      x.endDrag();
      if (h === 'no' || d.t !== 'row') return;
      if (h.t === 'row') dropOnRow(d.id, h.id, h.pos, card.seg?.id ?? null);
      else if (h.t === 'card') dropBetween(d, h.key, h.pos, null);
    },
  };
  const hcls = hint?.t === 'row' && hint.id === row.id && hint.card === card.key ? `drop-${hint.pos}` : '';

  /* fixed calendar row of a meeting */
  if (row.fx) {
    const m = row.fx;
    return (
      <div
        className={cx('arow fixed', selected && 'is-sel', hcls)}
        style={style}
        data-fr={row.id}
        data-sel={selected || undefined}
        onClick={(e) => x.onSelect(e, card, row.id)}
        onContextMenu={onContext}
        {...over}
      >
        <span className="cal" title="Calendar item — fixed">
          📅
        </span>
        <div className="meta">
          <span className={`chip ${m.state === 'now' ? 'good' : m.minsAway <= 10 ? 'bad' : 'info'}`}>
            {m.state === 'now' ? 'in progress' : m.state === 'done' ? 'ended' : inLabel(m)}
          </span>
          <button className="btn sm" tabIndex={-1} onClick={(e) => (e.stopPropagation(), toast(`(mock) joining ${m.title}`))}>
            Join
          </button>
        </div>
        <div className="abody">
          <div className="first">
            {whenLabel(m)}–{fmt(m.eff + m.durationMin)} · {m.where}
            {m.movedFrom != null && <span className="chip warn">moved from {fmt(m.movedFrom)}</span>}
          </div>
        </div>
      </div>
    );
  }

  const node = n!;
  const info = bodyInfo(node.title);
  const open = !!s.expanded[node.id];
  const hasBody = info.rest.some((l) => l.trim());
  const container = hasKids(s.nodes, node.id); // "task": has children → square check, derived done
  const hlIds = hlForRow(s.nodes, s.hl, row);
  const isPr = prLinks(info.first).length > 0;
  const done = isDone(s.nodes, node.id);
  const pm = x.marks?.[node.id];
  const pk = (k: string) => pm?.kind === 'change' && k in pm.prev;

  return (
    <div
      className={cx('arow', done && 'done', node.status === 'dropped' && 'dropped', running && 'live', selected && 'is-sel', picked && !selected && 'is-multi', editing && 'editing', hlIds.length > 0 && 'hl', propCls(pm), pk('today') && 'prop-add', hcls, x.dragId === row.id && 'dragging')}
      title={propTip(pm)}
      onMouseMove={hlIds.length ? () => dismissHl(hlIds) : undefined}
      style={style}
      data-fr={row.id}
      data-sel={selected || undefined}
      onClick={(e) => x.onSelect(e, card, row.id)}
      onDoubleClick={() => set(() => ({ edit: row.id }))}
      onContextMenu={onContext}
      {...dnh}
      {...over}
    >
      {row.kids && (
        <button className="rchev" tabIndex={-1} aria-label={node.open === false ? 'Expand' : 'Collapse'} onClick={(e) => (e.stopPropagation(), toggleOpen(node.id, node.open === false))}>
          {node.open === false ? '▸' : '▾'}
        </button>
      )}
      <button
        className={cx('check', container && 'sq', done && 'on', pk('status') && 'pk')}
        tabIndex={-1}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        onClick={(e) => (e.stopPropagation(), toggleDoneNodes([node.id]))}
      >
        {done ? '✓' : ''}
      </button>
      {editing ? (
        /* the editor sits exactly where the text is, and runs to the right edge — nothing reserved for the details */
        <div className="abody">
          <InlineEdit
            initial={node.title}
            onCommit={(t) => (editText(node.id, t), set(() => ({ edit: null })), focusArea())}
            onCancel={() => (set(() => ({ edit: null })), focusArea())}
          />
        </div>
      ) : (
        <>
          {/* floats right: the first line wraps around it, later lines use the full width */}
          <div className="meta">
            {row.head && card.part && card.part.i > 1 && (
              <span className="part" title={`This item is split across the schedule: part ${card.part.i} of ${card.part.n}. /consolidate brings everything together.`}>
                ⑂ {card.part.i}/{card.part.n}
              </span>
            )}
            {row.head && node.open === false && card.total > 0 && (
              <span className="csum">
                {card.done}/{card.total}
                {card.est > 0 && ` · ${fmtEst(card.est)}`}
              </span>
            )}
            {running ? (
              <Stopwatch spent={node.spent ?? 0} since={s.current!.since} />
            ) : node.spent ? (
              <span className="spent" title="Time spent so far">
                {fmtSpent(node.spent)}
              </span>
            ) : null}
            {node.notify && (
              <span className="bell" title="Notifies you when it changes (/notify to stop)">
                🔔
              </span>
            )}
            <DueChip node={node} />
            {pk('est') && pm!.prev.est ? <s className="est-chip was">{fmtEst(pm!.prev.est as number)}</s> : null}
            {node.est ? (
              <button
                className={cx('est-chip', pk('est') && 'pk')}
                tabIndex={-1}
                title="Estimate (E) — shift+←/→ to scroll"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  openEstMenu([node.id], r.left, r.bottom + 4);
                }}
              >
                {fmtEst(node.est)}
              </button>
            ) : null}
            <button
              className="kebab"
              tabIndex={-1}
              aria-label="Actions"
              title="Actions (/)"
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                openMenu({ t: 'row', id: node.id }, r.left - 180, r.bottom + 4);
              }}
            >
              ⋮
            </button>
            {!done && node.status !== 'dropped' && !node.smart && (
              <button className="play" tabIndex={-1} title={running ? 'Pause (⇧Space)' : 'Start (⇧Space)'} onClick={(e) => (e.stopPropagation(), toggleStartItem(node.id))}>
                {running ? '❚❚' : '▶'}
              </button>
            )}
          </div>
          <div className="abody">
            <div className={cx('first', pk('title') && 'pk')}>
              {row.head && card.path.length > 1 && <span className="muted crumbs">{card.path.slice(0, -1).join(' › ')} › </span>}
              {node.smart && !isPr && <span className="src">{srcIcon[node.smart.source]}</span>}
              {inline(info.first)}
              {pm?.kind === 'add' && <span className="propchip">new</span>}
              <Chips node={node} />
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
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- one card (an item with its Next rows, a meeting, or an alert) ---------- */
function CardView({ x, card }: { x: Shared; card: CardM }) {
  const { s, sel, hint, dnd } = x;
  const ref = useRef<HTMLElement>(null);
  useFlip(ref, 'data-fr');
  const cardSel = sel.card === card.key && !sel.row;
  const hasSel = sel.card === card.key;
  const picked = !!card.task && x.multi.has(card.task.id);
  // a change the user did not make: highlight the card when it is a meeting, or when the item is hidden inside it
  const hlIds = hlForCard(s.nodes, s.hl, card);
  // purple header: the owner itself is touched, or a proposed change hides inside the collapsed card
  const pm = card.task ? x.marks?.[card.task.id] : undefined;
  const propHidden = !!x.marks && card.collapsed && card.rows.some((r) => r.node && x.marks![r.node.id]);
  const live = card.rows.some((r) => r.node && s.current?.id === r.node.id);
  const movable = !!card.seg && !card.pinned;
  const ins = s.ins?.kind === 'action' ? s.ins : null;

  /** where the new-item editor shows: above its anchor row, or after the anchor's whole subtree, or at the top */
  const draftSlot = (): { before?: string; after?: string; top?: boolean; depth: number } | null => {
    if (!ins) return null;
    if (ins.before) {
      const r = card.rows.find((q) => q.id === ins.before);
      return r ? { before: r.id, depth: r.depth } : null;
    }
    if (ins.after) {
      const i = card.rows.findIndex((q) => q.id === ins.after);
      if (i < 0) return null;
      let j = i;
      while (card.rows[j + 1] && card.rows[j + 1].depth > card.rows[i].depth) j++;
      return { after: card.rows[j].id, depth: card.rows[i].depth };
    }
    if (ins.seg !== card.key) return null;
    if (card.rows[0]?.head) return card.rows[1] ? { before: card.rows[1].id, depth: 1 } : { after: card.rows[0].id, depth: 1 };
    return { top: true, depth: 0 };
  };
  const slot = draftSlot();
  const draft = (depth: number) =>
    ins && (
      <div className="arow draft" style={{ ['--d' as string]: depth } as React.CSSProperties}>
        <span className="check ghost" />
        <div className="abody">
          <InlineEdit
            key={`${ins.after}|${ins.before}`}
            chain
            onCommit={(t, chain) => {
              const id = addAction(ins.owner, ins.seg, ins.after, t, ins.before);
              // keep adding: the next one goes right below the one just created
              set(() => ({ ins: chain ? { kind: 'action' as const, owner: ins.owner, seg: ins.seg, after: id } : null }));
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
      className={cx('card', card.kind, card.meeting?.state === 'now' && card.meeting.dayOffset === 0 && 'inprogress', isLoose(card) && 'loose', card.collapsed && 'collapsed', cardSel && 'is-sel', hasSel && 'has-sel', picked && !cardSel && 'is-multi', live && 'has-live', hlIds.length > 0 && 'hl', hcls, x.dragId === card.key && 'dragging')}
      data-fc={card.key}
      data-sel={cardSel || undefined}
      onMouseMove={hlIds.length ? () => dismissHl(hlIds) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!(picked && x.multi.size > 1)) pick(card.key, null);
        openMenu(picked && x.multi.size > 1 ? { t: 'multi', ids: [...x.multi] } : { t: 'card', key: card.key }, e.clientX, e.clientY);
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
        if (!h || h.t !== 'card') return;
        e.preventDefault();
        x.endDrag();
        dropBetween(d, h.key, h.pos, null);
      }}
    >
      {!isLoose(card) && <header
        className={cx('chead', (pm || propHidden) && 'prop', pm && `prop-${pm.kind}`)}
        title={propTip(pm) ?? (propHidden ? 'Proposed AI changes inside' : undefined)}
        draggable={movable}
        onClick={(e) => x.onSelect(e, card, null)}
        onDragStart={(e) => {
          dnd.current = { t: 'card', key: card.key };
          e.dataTransfer.setData('text/plain', card.key);
          e.dataTransfer.effectAllowed = 'move';
          x.setDragId(card.key);
        }}
        onDragEnd={x.endDrag}
      >
        <button className="fold" tabIndex={-1} aria-label={card.collapsed ? 'Expand' : 'Collapse'} onClick={(e) => (e.stopPropagation(), toggleCardOpen(card, card.collapsed))} disabled={card.kind === 'attention'}>
          {card.collapsed ? '▸' : '▾'}
        </button>
        {card.kind === 'meeting' ? (
          <>
            <div className="mtime">
              <b>{whenLabel(card.meeting!)}</b>
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
            <span className="accent">{title![title!.length - 1] ?? '—'}</span>
          </div>
        )}
        <span className="grow" />
        {card.pinned && card.kind === 'meeting' && <span className="pin" title="Pinned by time — rises as it approaches">⏶</span>}
        <span className="csum">
          {card.total > 0 && `${card.done}/${card.total}`}
          {card.est > 0 && ` · ${fmtEst(card.est)}`}
        </span>
      </header>}

      <div className="collapse" data-open={!card.collapsed}>
        <div className="collapse-in">
          <div className="rows">
            {slot?.top && draft(0)}
            {card.rows.map((r, ri) => (
              <div key={r.id} className="rowwrap">
                {slot?.before === r.id && draft(slot.depth)}
                <RowView x={x} card={card} ri={ri} />
                {slot?.after === r.id && draft(slot.depth)}
              </div>
            ))}
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
const keyOf = (card: string | null, row: string | null) => `${card}|${row ?? ''}`;

export function Next() {
  const { s, marks } = useView();
  const m = useMemo(() => nextModel(s), [s.nodes, s.plan, s.meetings, s.clock, s.snaps]);
  const nav = useMemo(() => navList(m.cards), [m]);
  const sel = effSel(m.cards, s.nsel);
  const card = m.cards.find((c) => c.key === sel.card) ?? null;
  const area = useRef<HTMLDivElement>(null);
  const dnd = useRef<Drag | null>(null);
  const [hint, setHintRaw] = useState<Hint | null>(null);
  const setHint = (h: Hint | null) => setHintRaw((p) => (sameHint(p, h) ? p : h));
  const [dragId, setDragId] = useState<string | null>(null);
  useFlip(area, 'data-fc');
  const endDrag = () => {
    dnd.current = null;
    setHintRaw(null);
    setDragId(null);
  };
  useDragEnd(!!dragId, endDrag);

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    area.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel.card, sel.row]);

  // moving the keyboard cursor onto a yellow highlight counts as having seen it
  const lastSel = useRef<string | null>(null);
  useEffect(() => {
    const k = keyOf(sel.card, sel.row);
    if (lastSel.current !== null && lastSel.current !== k && card) {
      const row = sel.row ? card.rows.find((r) => r.id === sel.row) : undefined;
      dismissHl(row ? hlForRow(s.nodes, s.hl, row) : hlForCard(s.nodes, s.hl, card));
    }
    lastSel.current = k;
  }, [sel.card, sel.row]);

  const live = useMemo(() => s.multi.filter((id) => s.nodes.some((n) => n.id === id)), [s.multi, s.nodes]);
  const multi = useMemo(() => new Set(live.length > 1 ? live : []), [live]);

  const movable = m.cards.filter((c) => c.seg && !c.pinned);
  const lastMovable = movable[movable.length - 1];

  /* ---- selection: click, ⌘/ctrl-click, shift-click, shift+↑/↓ ---- */
  const itemAt = (c: CardM | null, row: string | null) => (!c ? null : row ? c.rows.find((r) => r.id === row)?.node?.id ?? null : c.task?.id ?? null);
  const extendTo = (cardKey: string, row: string | null) => {
    const a = s.anchor ?? keyOf(sel.card, sel.row);
    const ai = nav.findIndex((e) => keyOf(e.card, e.row) === a);
    const bi = nav.findIndex((e) => e.card === cardKey && e.row === row);
    if (ai < 0 || bi < 0) return;
    const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
    const ids = [...new Set(nav.slice(lo, hi + 1).map((e) => e.item).filter((v): v is string => !!v))];
    set(() => ({ multi: ids, anchor: a, nsel: { card: cardKey, row } }));
  };
  const onSelect = (e: React.MouseEvent, c: CardM, row: string | null) => {
    if (e.shiftKey) return extendTo(c.key, row);
    if (e.metaKey || e.ctrlKey) {
      const it = itemAt(c, row);
      if (!it) return;
      const base = live.length > 1 ? live : ([itemAt(card, sel.row)].filter(Boolean) as string[]);
      const next = base.includes(it) ? base.filter((v) => v !== it) : [...base, it];
      return set(() => ({ multi: next, anchor: keyOf(c.key, row), nsel: { card: c.key, row } }));
    }
    pick(c.key, row);
  };
  const x: Shared = { s, marks, sel, multi, hint, setHint, dnd, dragId, setDragId, endDrag, onSelect };

  /** what a command applies to: the multi-selection, or the one selected item */
  const targets = (): string[] => {
    if (live.length > 1) return live;
    const it = itemAt(card, sel.row);
    return it ? [it] : [];
  };

  const newTaskParent = (afterSeg: string | null) => {
    const base = m.cards.find((c) => c.key === afterSeg)?.task ?? m.cards.find((c) => c.task)?.task;
    return base ? base.parentId : s.nodes.find((n) => !n.parentId)?.id ?? null;
  };

  /** on a card header, "below" / "above" both mean: the first item inside it (after the calendar row of a meeting) */
  const insideHeader = () =>
    set(() => ({ ins: { kind: 'action', owner: card!.ownerId, seg: card!.seg?.id, after: card!.kind === 'meeting' ? card!.rows.find((r) => r.fx)?.id ?? null : null } }));
  /** on an open item with children (or a card's item), new items go in as its first child */
  const firstChild = () => {
    if (!card || !sel.row) return false;
    const ri = card.rows.findIndex((r) => r.id === sel.row);
    const r = card.rows[ri];
    if (!r?.node || !(r.head || (r.kids && r.node.open !== false))) return false;
    const below = card.rows[ri + 1];
    if (below && below.depth > r.depth) set(() => ({ ins: { kind: 'action', owner: card.ownerId, seg: card.seg?.id, after: null, before: below.id } }));
    else set(() => ({ ins: { kind: 'action', owner: r.node!.id, seg: card.seg?.id, after: null } }));
    return true;
  };
  /** Enter: a new item below the selection */
  const insertHere = () => {
    if (!card) return set(() => ({ ins: { kind: 'task', afterSeg: null } }));
    if (firstChild()) return;
    if (sel.row) return set(() => ({ ins: { kind: 'action', owner: card.ownerId, seg: card.seg?.id, after: sel.row } }));
    insideHeader();
  };
  /** ⇧Enter: a new item above it */
  const insertAbove = () => {
    if (!card) return set(() => ({ ins: { kind: 'task', afterSeg: null } }));
    if (card.rows.find((r) => r.id === sel.row)?.head) return void firstChild();
    if (sel.row) return set(() => ({ ins: { kind: 'action', owner: card.ownerId, seg: card.seg?.id, after: null, before: sel.row! } }));
    insideHeader();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target)) return;
    const k = e.key;
    if (e.altKey && !e.metaKey && !e.ctrlKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      // ⌥↑↓ = skip sub-items: only card headers and top-level rows (⇧⌥ extends the selection)
      e.preventDefault(); e.stopPropagation();
      const top = (q: { card: string; row: string | null }) => !q.row || m.cards.find((c) => c.key === q.card)?.rows.find((r) => r.id === q.row)?.depth === 0;
      const dir = k === 'ArrowDown' ? 1 : -1;
      let j = nav.findIndex((q) => q.card === sel.card && q.row === sel.row) + dir;
      while (j >= 0 && j < nav.length && !top(nav[j])) j += dir;
      const nx = nav[j];
      if (nx) (e.shiftKey ? extendTo(nx.card, nx.row) : pick(nx.card, nx.row));
      return;
    }
    if (e.altKey) return;
    const M = mod(e);
    const stop = () => (e.preventDefault(), e.stopPropagation());
    const ci = card ? m.cards.indexOf(card) : -1;
    const ri = card && sel.row ? card.rows.findIndex((r) => r.id === sel.row) : -1;
    const row = ri >= 0 ? card!.rows[ri] : undefined;
    const rowNode = row?.node;
    const rowFx = row?.fx;
    const bulk = live.length > 1;
    const ids = targets();
    const rowsOnly = !!sel.row;

    if (k === 'Enter') {
      // Enter adds below, ⇧Enter adds above, ⌘⇧Enter starts focus mode
      stop();
      if (M && e.shiftKey) {
        if (rowNode) focusItem(rowNode.id);
        else if (card) {
          const r = card.rows.find((q) => q.node && q.node.status !== 'done' && !q.node.smart);
          r ? focusItem(r.id) : toast('No open items to focus on');
        }
        return;
      }
      return e.shiftKey ? insertAbove() : insertHere();
    }
    if (M && k === ']') return (stop(), indentItems(ids, rowsOnly));
    if (M && k === '[') return (stop(), outdentItems(ids));
    if (M && (k === 'ArrowUp' || k === 'ArrowDown')) {
      stop();
      const dir = k === 'ArrowUp' ? -1 : 1;
      if (bulk) moveRows(live, dir);
      else if (row?.head) moveCard(card!.key, dir);
      else if (sel.row) moveRow(sel.row, dir);
      else if (card?.pinned) toast(card.kind === 'meeting' ? 'Pinned by time — it rises as the meeting approaches' : 'Pinned: needs your attention', 'info');
      else if (card?.seg) moveCard(card.key, dir);
      return;
    }
    if (M && k.toLowerCase() === 'a' && card) {
      // ⌘A: everything in this card
      stop();
      const all = card.rows.map((r) => r.node?.id).filter((v): v is string => !!v);
      return set(() => ({ multi: all, anchor: keyOf(card.key, card.rows[0]?.id ?? null) }));
    }
    if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      stop();
      const cur = nav.findIndex((q) => q.card === sel.card && q.row === sel.row);
      const nx = nav[Math.max(0, Math.min(nav.length - 1, cur + (k === 'ArrowDown' ? 1 : -1)))];
      if (nx) extendTo(nx.card, nx.row);
      return;
    }
    if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight') && ids.length) {
      stop();
      return cycleEst(ids, k === 'ArrowRight' ? 1 : -1);
    }
    if (e.shiftKey && k === ' ') {
      // ⇧Space = start / pause
      stop();
      if (rowFx) toast(`(mock) joining ${rowFx.title}`);
      else if (rowNode) rowNode.smart ? toast(`(mock) opening ${rowNode.title.split('\n')[0]} in browser`) : toggleStartItem(rowNode.id);
      else if (card) startCard(card);
      return;
    }
    // − / + : collapse / expand everything
    if (!M && (k === '-' || k === '_')) return (stop(), openAllNext(false));
    if (!M && (k === '+' || k === '=')) return (stop(), openAllNext(true));
    if (M || (e.shiftKey && k !== 'Delete' && k !== 'Backspace')) return;

    switch (k) {
      case 'ArrowDown':
      case 'ArrowUp': {
        stop();
        // always the next thing you can see: header → its rows (children too) → next header …
        const cur = nav.findIndex((q) => q.card === sel.card && q.row === sel.row);
        const nx = nav[Math.max(0, Math.min(nav.length - 1, cur + (k === 'ArrowDown' ? 1 : -1)))];
        if (nx) pick(nx.card, nx.row);
        return;
      }
      case 'ArrowRight': {
        stop();
        if (!card) return;
        if (!sel.row) {
          if (card.collapsed) toggleCardOpen(card, true);
          else if (card.rows.length) pick(card.key, card.rows[0].id);
          else set(() => ({ ins: { kind: 'action', owner: card.ownerId, seg: card.seg?.id, after: null } }));
        } else if (rowNode) {
          if (bodyInfo(rowNode.title).rest.some((l) => l.trim()) && !s.expanded[rowNode.id]) setExpanded(rowNode.id, true);
          else if (row!.kids && rowNode.open === false) toggleOpen(rowNode.id, true);
          else if (row!.kids) pick(card.key, card.rows[ri + 1].id);
        }
        return;
      }
      case 'ArrowLeft': {
        stop();
        if (!card) return;
        if (sel.row) {
          if (rowNode && s.expanded[rowNode.id]) setExpanded(rowNode.id, false);
          else if (row!.kids && rowNode!.open !== false) toggleOpen(rowNode!.id, false);
          else if (row!.depth > 0) {
            // back to the parent row
            for (let j = ri - 1; j >= 0; j--) if (card.rows[j].depth < row!.depth) return pick(card.key, card.rows[j].id);
          } else if (!isLoose(card)) pick(card.key, null);
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
        if (bulk) return (stop(), set(() => ({ multi: [], anchor: null })));
        if (sel.row && card) (stop(), pick(card.key, null));
        return;
      case 'r':
      case 'F2': {
        // edit
        stop();
        if (rowNode) set(() => ({ edit: rowNode.id }));
        else if (rowFx) toast('Calendar items are fixed — add items around them instead');
        else if (card?.task) set(() => ({ edit: 'card:' + card.key }));
        return;
      }
      case ' ': {
        stop();
        if (bulk) return toggleDoneNodes(live);
        if (rowNode) toggleDoneNodes([rowNode.id]);
        else if (card && !sel.row) {
          // on a card: complete just the item itself — what is inside keeps its own state
          if (card.task) toggleDoneNodes([card.task.id]);
        }
        return;
      }
      case 'e':
        if (ids.length) (stop(), openEstMenu(ids));
        return;
      case 'f':
        if (rowNode) (stop(), focusItem(rowNode.id));
        return;
      case 'Delete':
      case 'Backspace': {
        stop();
        // Delete takes items out of Next (they stay in the Organizer); ⇧Delete removes them for good
        const out = (ids: string[], label?: string) => (e.shiftKey ? removeNodes(ids, label) : (unplan(ids), toast(ids.length > 1 ? `${ids.length} items taken out of Next — still in the Organizer` : 'Taken out of Next — still in the Organizer (⇧⌫ deletes for good)', 'info')));
        if (!card) return;
        if (bulk) {
          out(live);
          return pick(m.cards[0]?.key ?? null, null);
        }
        if (rowNode) {
          const nxt = card.rows[ri + 1]?.id ?? card.rows[ri - 1]?.id ?? null;
          out([rowNode.id]);
          pick(card.key, nxt);
        } else if (rowFx) removeMeeting(rowFx.id);
        else if (card.task && !sel.row) {
          const nxt = (m.cards[ci + 1] ?? m.cards[ci - 1])?.key ?? null;
          out([card.task.id], 'Delete');
          pick(nxt, null);
        } else if (card.kind === 'meeting') removeMeeting(card.meeting!.id);
        return;
      }
      case '/':
        stop();
        if (bulk) return openMenu({ t: 'multi', ids: live }, undefined, undefined, { slash: true });
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
  /** nothing to anchor to: a new top-level item (no header, no card of its own) */
  const taskDraft = draftTask && (
    <div className="card loose draft" key="draft-task">
      <div className="arow draft">
        <span className="check ghost" />
        <div className="abody">
          <InlineEdit
            chain
            onCommit={(t, chain) => {
              const loose = [...m.cards].reverse().find((c) => isLoose(c) && c.ownerId === ROOT);
              const last = loose?.rows.filter((r) => r.depth === 0).pop()?.id ?? null;
              const id = addAction(ROOT, loose?.seg?.id, last, t);
              set(() => ({ ins: chain ? { kind: 'action', owner: ROOT, seg: loose?.seg?.id ?? 's_' + ROOT, after: id } : null }));
              if (!chain) focusArea();
            }}
            onCancel={() => (set(() => ({ ins: null })), focusArea())}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="next view">
      <div
        className="cards kbd-area"
        data-kbd-area
        tabIndex={0}
        ref={area}
        onKeyDown={onKey}
        onMouseDown={(e) => (e.shiftKey || e.metaKey || e.ctrlKey) && !isEditable(e.target) && e.preventDefault()}
        onCopy={(e) => {
          const ids = targets();
          if (isEditable(e.target) || !ids.length) return;
          const tree = treeOf(s.nodes, ids, (id) => isDone(s.nodes, id));
          e.preventDefault();
          e.clipboardData.setData('text/plain', toMarkdown(tree));
          toast(`Copied ${countItems(tree)} item${countItems(tree) > 1 ? 's' : ''} as markdown`, 'info');
        }}
        onPaste={(e) => {
          if (isEditable(e.target)) return;
          const tree = parseMarkdown(e.clipboardData.getData('text/plain'));
          if (!tree.length) return;
          e.preventDefault();
          const next = { owner: card?.ownerId ?? ROOT, seg: card?.seg?.id };
          const node = card && sel.row ? card.rows.find((r) => r.id === sel.row)?.node : undefined;
          // below the selected item; on a header or the calendar row: into that card
          const head = !!card?.rows.find((r) => r.id === sel.row)?.head;
          pasteItems(tree, node && !head ? { parentId: node.parentId, afterId: node.id, next } : { parentId: !card || card.ownerId === ROOT ? null : card.ownerId, afterId: null, next });
        }}
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
          endDrag();
          dropBetween(d, null, 'after', lastMovable.key);
        }}
      >
        {/* the columns live on an inner box of natural height: on the scroller itself they would overflow sideways */}
        <div className="cols">
        {m.cards.length === 0 && !draftTask && (
          <div className="empty">
            <div className="big">All clear 🎉</div>
            <p>Nothing queued. Press <kbd>⏎</kbd> to add an item, or ask AI to plan with <kbd>⌘/</kbd>.</p>
          </div>
        )}
        {draftAt === -1 && taskDraft}
        {m.cards.map((c, i) => (
          <div key={c.key} className="cardwrap">
            <CardView x={x} card={c} />
            {draftAt === i && taskDraft}
          </div>
        ))}
        </div>
        <div className={cx('endzone', hint?.t === 'end' && 'over')} />
      </div>

      {live.length > 1 && <div className="multibar">{live.length} selected — <kbd>Space</kbd> done · <kbd>⌘[</kbd> <kbd>⌘]</kbd> outdent / indent · <kbd>⌘↑↓</kbd> move · <kbd>⌫</kbd> delete · <kbd>/</kbd> more · <kbd>Esc</kbd> clear</div>}
    </div>
  );
}
