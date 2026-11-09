import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { useS } from './store';
import { act } from './act';
import { isDone } from './actions';
import { exportScope, planEdit } from './mdedit';

/** the editor's look: the app's own colours, so light / dark follow the theme */
const look = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', background: 'var(--surface-2)', fontSize: 'var(--fs-md)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', padding: '8px 0' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '0 12px' },
  '.cm-activeLine': { background: 'var(--hover)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--accent-soft)' },
  '.cm-placeholder': { color: 'var(--text-muted)' },
});
const colours = HighlightStyle.define([
  { tag: [t.processingInstruction, t.list], color: 'var(--text-muted)' }, // - bullets and [ ] boxes
  { tag: t.heading, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: 'var(--accent-text, var(--accent))' },
  { tag: t.quote, color: 'var(--text-muted)' },
]);

/** ⌘E: the items as markdown text (the copy / paste format) in a real editor; Apply changes only what differs */
export function MdEditor() {
  const s = useS();
  return s.mdEdit ? <Editor roots={s.mdEdit.ids} today={s.mdEdit.today} /> : null;
}

function Editor({ roots, today }: { roots: string[]; today: boolean }) {
  const s = useS();
  const initial = useMemo(() => exportScope(s.nodes, roots, (id) => isDone(s.nodes, id)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState(initial);
  const [armed, setArmed] = useState(false); // Esc on unsaved edits asks once more
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ text, initial, roots, armed });
  latest.current = { text, initial, roots, armed };

  const plan = useMemo(() => planEdit(s.nodes, roots, text, (id) => isDone(s.nodes, id), today, () => '·'), [s.nodes, roots, text]);
  const dirty = text !== initial;
  const apply = () => act.applyMarkdown(latest.current.roots, latest.current.text, today);
  const cancel = () => {
    const l = latest.current;
    if (l.text !== l.initial && !l.armed) return setArmed(true);
    act.closeMdEdit();
  };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          indentUnit.of('  '),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(colours),
          placeholder('One item per line: - [ ] Title @est:1h @due:2026-11-12'),
          look,
          keymap.of([
            { key: 'Mod-Enter', run: () => (apply(), true) },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            setText(u.state.doc.toString());
            setArmed(false);
          }),
        ],
      }),
    });
    view.current = v;
    v.focus();
    return () => v.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { added, removed, changed, moved } = plan.stats;
  const parts = [changed && `${changed} changed`, added && `${added} added`, moved && `${moved} moved`, removed && `${removed} removed`].filter(Boolean);
  const scope = `${roots.length} item${roots.length === 1 ? '' : 's'}`;

  return (
    <div className="ai-veil" onMouseDown={() => cancel()}>
      <div className="help mdedit" role="dialog" aria-label="Edit as markdown" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Escape' && (e.preventDefault(), cancel()))}>
        <h3>
          Edit as markdown <small>{scope}</small>
        </h3>
        <div className="md-host" ref={host} />
        <div className="md-hint">
          <code>- [ ] Title @est:1h30m @due:2026-11-12</code> · <code>[x]</code> done · <code>[-]</code> dropped · indent = sub-item · #tags stay in the title. Everything else on an item (today, timers, links) is kept.
        </div>
        <div className="md-foot">
          <span className={`md-stat${removed ? ' warn' : ''}`}>{armed ? 'Discard your edits? Esc again to discard.' : parts.length ? parts.join(' · ') : dirty ? 'No difference yet' : 'No changes'}</span>
          <button className="btn" onClick={() => act.closeMdEdit()}>
            Cancel
          </button>
          <button className="btn primary" disabled={plan.same} onClick={apply}>
            Apply <kbd>⌘⏎</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
