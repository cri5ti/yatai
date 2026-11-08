import { useEffect, useMemo, useRef, useState } from 'react';
import { set, useS } from './store';
import { captureAt, captureMany, clearSuggestion, dropInboxMany, editInbox, fileInbox, reorderInboxMany, suggestInbox, toast } from './actions';
import { openFileMenu, openMenu } from './commands';
import { breadcrumb } from './mock';
import { relTime } from './model';
import { InlineEdit } from './Inline';
import { INBOX_MIME, Organizer } from './Organizer';
import { countItems, flatten, parseMarkdown, toMarkdown } from './clip';
import { Md, bodyInfo, inline } from './md';
import { useFlip } from './flip';
import { cx, focusArea, isEditable, mod } from './kbd';

const SPLIT_AT = 720; // px: wider than this the Organizer appears on the right, to drag inbox items onto

/** Same editor and mechanics as Next: Enter adds below, ⇧Enter above, F2 edits, ⇧↑↓ / ⌘click multi-select.
 *  Resize the window wide enough and the Organizer shows up beside it: drag items across to file them. */
export function Inbox() {
  const s = useS();
  const root = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<string[] | null>(null);
  const [ins, setIns] = useState<{ after: string | null; before?: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const split = width >= SPLIT_AT;
  useFlip(area, 'data-fr');

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const selId = useMemo(() => (s.inbox.some((i) => i.id === s.isel) ? s.isel : s.inbox[0]?.id ?? null), [s.isel, s.inbox]);
  const live = picked.filter((id) => s.inbox.some((i) => i.id === id));
  const multi = new Set(live.length > 1 ? live : []);
  const sel = (id: string | null) => (set(() => ({ isel: id })), setPicked([]), setAnchor(id));
  const i = s.inbox.findIndex((x) => x.id === selId);
  const cur = i >= 0 ? s.inbox[i] : null;
  const ids = live.length > 1 ? live : cur ? [cur.id] : [];

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    area.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selId]);

  const extendTo = (id: string) => {
    const a = anchor ?? selId;
    const ai = s.inbox.findIndex((x) => x.id === a);
    const bi = s.inbox.findIndex((x) => x.id === id);
    if (ai < 0 || bi < 0) return;
    const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
    setPicked(s.inbox.slice(lo, hi + 1).map((x) => x.id));
    setAnchor(a);
    set(() => ({ isel: id }));
  };
  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey) return extendTo(id);
    if (e.metaKey || e.ctrlKey) {
      const base = live.length > 1 ? live : selId ? [selId] : [];
      setPicked(base.includes(id) ? base.filter((v) => v !== id) : [...base, id]);
      setAnchor(id);
      return set(() => ({ isel: id }));
    }
    sel(id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target) || e.altKey) return;
    const k = e.key;
    const M = mod(e);
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (k === 'Enter') {
      // Enter adds below, ⇧Enter adds above
      stop();
      if (!cur) return setIns({ after: null });
      return setIns(e.shiftKey ? { after: null, before: cur.id } : { after: cur.id });
    }
    if (M && (k === 'ArrowUp' || k === 'ArrowDown')) return (stop(), reorderInboxMany(ids, k === 'ArrowUp' ? -1 : 1));
    if (M && k.toLowerCase() === 'a') return (stop(), setPicked(s.inbox.map((x) => x.id)));
    if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      stop();
      const nx = s.inbox[Math.max(0, Math.min(s.inbox.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)))];
      return nx && extendTo(nx.id);
    }
    if (k === 'Escape' && live.length > 1) return (stop(), setPicked([]));
    if (M || (e.shiftKey && k !== 'S')) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      stop();
      sel(s.inbox[Math.max(0, Math.min(s.inbox.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)))]?.id ?? null);
    } else if (k === 'Home') (stop(), sel(s.inbox[0]?.id ?? null));
    else if (k === 'End') (stop(), sel(s.inbox[s.inbox.length - 1]?.id ?? null));
    else if (k === '/') (stop(), openMenu(cur ? { t: 'inbox', id: cur.id } : null, undefined, undefined, { slash: true }));
    else if (!cur) return;
    else if (k === 'f') (stop(), openFileMenu(cur.id));
    else if (k === 'r' || k === 'F2') (stop(), set(() => ({ edit: cur.id })));
    else if (k === 'a') (stop(), cur.suggestion ? fileInbox(cur.id, cur.suggestion.parentId) : toast('No suggestion yet — press S to ask AI'));
    else if (k === 's') (stop(), suggestInbox(ids));
    else if (k === 'S') (stop(), suggestInbox());
    else if (k === 'Delete' || k === 'Backspace') {
      stop();
      const gone = new Set(ids);
      const nxt = s.inbox.find((x, j) => j > i && !gone.has(x.id))?.id ?? [...s.inbox].reverse().find((x) => !gone.has(x.id))?.id ?? null;
      dropInboxMany(ids);
      sel(nxt);
    }
  };

  /** the new-item editor sits where the item will land, exactly like in Next */
  const draftRow = (
    <div key="draft" className="irow draft">
      <div className="ibody">
        <InlineEdit
          key={`${ins?.after}|${ins?.before}`}
          chain
          onCommit={(t, chain) => {
            const id = captureAt(t, ins!.after, ins!.before);
            setPicked([]);
            setIns(chain ? { after: id } : null);
            if (!chain) focusArea();
          }}
          onCancel={() => (setIns(null), focusArea())}
        />
      </div>
    </div>
  );
  const list: (string | 'draft')[] = s.inbox.map((x) => x.id);
  if (ins) {
    const at = ins.before ? list.indexOf(ins.before) : ins.after ? list.indexOf(ins.after) + 1 : 0;
    list.splice(Math.max(0, at), 0, 'draft');
  }

  return (
    <div className={cx('inbox view', split && 'is-split')} ref={root}>
      <div className="inbox-body">
        <div
          className="ilist kbd-area"
          data-kbd-area
          tabIndex={0}
          ref={area}
          onKeyDown={onKey}
          onMouseDown={(e) => (e.shiftKey || e.metaKey || e.ctrlKey) && !isEditable(e.target) && e.preventDefault()}
          onCopy={(e) => {
            if (isEditable(e.target) || !ids.length) return;
            const tree = parseMarkdown(ids.map((id) => s.inbox.find((x) => x.id === id)!.text).map((t) => `- ${t.split('\n').join('\n  ')}`).join('\n'));
            e.preventDefault();
            e.clipboardData.setData('text/plain', toMarkdown(tree));
            toast(`Copied ${countItems(tree)} item${countItems(tree) > 1 ? 's' : ''} as markdown`, 'info');
          }}
          onPaste={(e) => {
            if (isEditable(e.target)) return;
            const tree = parseMarkdown(e.clipboardData.getData('text/plain'));
            if (!tree.length) return;
            e.preventDefault();
            captureMany(tree.map(flatten), cur?.id ?? null);
          }}
          aria-label="Inbox — arrows to navigate, Enter to add"
        >
          {s.inbox.length === 0 && !ins && (
            <div className="empty small">
              Inbox zero. Nice. Press <kbd>⏎</kbd> to capture something.
            </div>
          )}
          {list.map((id) => {
            if (id === 'draft') return draftRow;
            const it = s.inbox.find((x) => x.id === id)!;
            const selected = selId === it.id;
            const info = bodyInfo(it.text);
            const editing = s.edit === it.id;
            return (
              <div
                key={it.id}
                data-fr={it.id}
                data-sel={selected || undefined}
                className={cx('irow', selected && 'is-sel', multi.has(it.id) && !selected && 'is-multi', drag?.includes(it.id) && 'dragging')}
                draggable={!editing}
                onClick={(e) => onRowClick(e, it.id)}
                onDoubleClick={() => set(() => ({ edit: it.id }))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!multi.has(it.id)) sel(it.id);
                  openMenu({ t: 'inbox', id: it.id }, e.clientX, e.clientY);
                }}
                onDragStart={(e) => {
                  const d = multi.has(it.id) ? live : [it.id];
                  e.dataTransfer.setData(INBOX_MIME, JSON.stringify(d));
                  e.dataTransfer.setData('text/plain', d.map((x) => s.inbox.find((y) => y.id === x)?.text ?? '').join('\n'));
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag(d);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <div className="ibody">
                  {editing ? (
                    <InlineEdit
                      initial={it.text}
                      onCommit={(t) => (editInbox(it.id, t), set(() => ({ edit: null })), focusArea())}
                      onCancel={() => (set(() => ({ edit: null })), focusArea())}
                    />
                  ) : (
                    <>
                      <div className="first">
                        <span className="isub">{relTime(it.created)}</span>
                        {inline(info.first)}
                      </div>
                      {info.rest.some((l) => l.trim()) && (
                        <div className="body">
                          <Md lines={info.rest} offset={1} />
                        </div>
                      )}
                    </>
                  )}
                  {it.suggesting && <div className="shimmer">✨ thinking…</div>}
                  {it.suggestion && (
                    <div className="suggest">
                      <span>
                        ✨ → <b>{breadcrumb(s.nodes, it.suggestion.parentId)}</b>
                        <em>{it.suggestion.reason}</em>
                      </span>
                      <span className="sbtns">
                        <button className="btn sm" tabIndex={-1} onClick={() => fileInbox(it.id, it.suggestion!.parentId)}>
                          Accept
                        </button>
                        <button className="btn sm ghost" tabIndex={-1} onClick={() => clearSuggestion(it.id)}>
                          ✕
                        </button>
                      </span>
                    </div>
                  )}
                </div>
                {!editing && (
                  <button
                    className="btn sm fileto"
                    tabIndex={-1}
                    title="File into… (F)"
                    onClick={(e) => {
                      e.stopPropagation();
                      sel(it.id);
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      openFileMenu(it.id, r.left - 200, r.bottom + 4);
                    }}
                  >
                    File ▾
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {split && (
          <div className="inbox-org">
            <div className="dropnote">Drag inbox items onto the tree to file them</div>
            <Organizer embedded />
          </div>
        )}
      </div>

      {multi.size > 1 && (
        <div className="multibar">
          {multi.size} selected — <kbd>⌫</kbd> discard · <kbd>⌘↑↓</kbd> move · <kbd>⌘C</kbd> copy · drag to file · <kbd>Esc</kbd> clear
        </div>
      )}
      <div className="keys">
        <kbd>↑↓</kbd> move · <kbd>⏎</kbd> add below · <kbd>⇧⏎</kbd> above · <kbd>F2</kbd> edit · <kbd>F</kbd> file into… · <kbd>A</kbd> accept AI · <kbd>S</kbd> suggest · <kbd>⌘↑↓</kbd> reorder · <kbd>⌘C</kbd>/<kbd>⌘V</kbd> copy / paste · <kbd>⌫</kbd> discard · <kbd>/</kbd> commands
      </div>
    </div>
  );
}
