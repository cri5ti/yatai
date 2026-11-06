import { useEffect, useMemo, useRef, useState } from 'react';
import { set, useS } from './store';
import {
  capture, clearSuggestion, dropInbox, editInbox, fileInbox, reorderInbox, suggestInbox, toast,
} from './actions';
import { openFileMenu, openMenu } from './commands';
import { breadcrumb } from './mock';
import { relTime } from './model';
import { InlineEdit } from './Inline';
import { useFlip } from './flip';
import { cx, focusArea, isEditable, mod } from './kbd';

export function Inbox() {
  const s = useS();
  const [text, setText] = useState('');
  const [over, setOver] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const cap = useRef<HTMLInputElement>(null);
  const targets = s.nodes.filter((n) => n.kind !== 'action');
  const unsuggested = s.inbox.some((i) => !i.suggestion);
  useFlip(area, 'data-fr');

  const selId = useMemo(() => (s.inbox.some((i) => i.id === s.isel) ? s.isel : s.inbox[0]?.id ?? null), [s.isel, s.inbox]);
  const sel = (id: string | null) => set(() => ({ isel: id }));
  const i = s.inbox.findIndex((x) => x.id === selId);
  const cur = i >= 0 ? s.inbox[i] : null;

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    area.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (isEditable(e.target) || e.altKey) return;
    const k = e.key;
    const M = mod(e);
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (M && k === 'Enter') return (stop(), cap.current?.focus());
    if (M && (k === 'ArrowUp' || k === 'ArrowDown')) return (stop(), cur && reorderInbox(cur.id, k === 'ArrowUp' ? -1 : 1));
    if (M || e.shiftKey) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      stop();
      sel(s.inbox[Math.max(0, Math.min(s.inbox.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)))]?.id ?? null);
    } else if (k === 'Home') (stop(), sel(s.inbox[0]?.id ?? null));
    else if (k === 'End') (stop(), sel(s.inbox[s.inbox.length - 1]?.id ?? null));
    else if (k === '/') (stop(), openMenu(cur ? { t: 'inbox', id: cur.id } : null, undefined, undefined, { slash: true }));
    else if (!cur) return;
    else if (k === 'Enter') (stop(), openFileMenu(cur.id));
    else if (k === 'r' || k === 'F2') (stop(), set(() => ({ edit: cur.id })));
    else if (k === 'a') (stop(), cur.suggestion ? fileInbox(cur.id, cur.suggestion.parentId) : toast('No suggestion yet — press S to ask AI'));
    else if (k === 's') (stop(), suggestInbox([cur.id]));
    else if (k === 'Delete' || k === 'Backspace') {
      stop();
      const nxt = s.inbox[i + 1]?.id ?? s.inbox[i - 1]?.id ?? null;
      dropInbox(cur.id);
      sel(nxt);
    }
  };

  return (
    <div className="inbox view">
      <div className="thead">
        <div>
          <div className="h1">Inbox</div>
          <div className="sub">{s.inbox.length} to triage</div>
        </div>
        <button className="btn ai" disabled={!!s.aiBusy || !unsuggested} onClick={() => suggestInbox()}>
          ✨ Organize
        </button>
      </div>

      <input
        ref={cap}
        className="capture"
        placeholder="Dump an idea…  (Enter to add · Esc to leave)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text.trim()) {
              capture(text);
              setText('');
              sel(null);
            } else {
              focusArea(); // blank Enter cancels
              area.current?.focus();
            }
          } else if (e.key === 'Escape') {
            setText('');
            area.current?.focus();
          }
        }}
      />

      <div className="inbox-body">
        <div className="ilist kbd-area" data-kbd-area tabIndex={0} ref={area} onKeyDown={onKey} aria-label="Inbox — arrows to navigate, Enter to file">
          {s.inbox.length === 0 && <div className="empty small">Inbox zero. Nice. Press <kbd>⌘⏎</kbd> to capture something.</div>}
          {s.inbox.map((it) => {
            const selected = selId === it.id;
            return (
              <div
                key={it.id}
                data-fr={it.id}
                data-sel={selected || undefined}
                className={cx('irow', selected && 'is-sel', drag === it.id && 'dragging')}
                draggable={s.edit !== it.id}
                onClick={() => sel(it.id)}
                onDoubleClick={() => set(() => ({ edit: it.id }))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  sel(it.id);
                  openMenu({ t: 'inbox', id: it.id }, e.clientX, e.clientY);
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', it.id);
                  setDrag(it.id);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <span className="grip">⋮⋮</span>
                <div className="ibody">
                  {s.edit === it.id ? (
                    <InlineEdit
                      initial={it.text}
                      onCommit={(t) => (editInbox(it.id, t), set(() => ({ edit: null })), focusArea())}
                      onCancel={() => (set(() => ({ edit: null })), focusArea())}
                    />
                  ) : (
                    <div>{it.text}</div>
                  )}
                  <div className="isub">{relTime(it.created)}</div>
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
                <button
                  className="btn sm fileto"
                  tabIndex={-1}
                  title="File into… (Enter)"
                  onClick={(e) => {
                    e.stopPropagation();
                    sel(it.id);
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    openFileMenu(it.id, r.left - 200, r.bottom + 4);
                  }}
                >
                  File ▾
                </button>
                <button className="x" tabIndex={-1} title="Discard" onClick={(e) => (e.stopPropagation(), dropInbox(it.id))}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div className="targets">
          <div className="lh">Drop onto…</div>
          {targets.map((t) => (
            <div
              key={t.id}
              className={cx('target', t.kind, over === t.id && 'over', drag && 'armed')}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(t.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                setDrag(null);
                fileInbox(e.dataTransfer.getData('text/plain'), t.id);
              }}
            >
              {t.kind === 'task' && <span className="muted">└ </span>}
              {t.title}
              <span className="tk">{t.kind === 'project' ? '→ task' : '→ action'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="keys">
        <kbd>↑↓</kbd> move · <kbd>⏎</kbd> file into… · <kbd>A</kbd> accept AI suggestion · <kbd>S</kbd> suggest · <kbd>R</kbd> edit · <kbd>⌘⏎</kbd> capture · <kbd>⌘↑↓</kbd> reorder · <kbd>⌫</kbd> discard · <kbd>/</kbd> commands
      </div>
    </div>
  );
}
