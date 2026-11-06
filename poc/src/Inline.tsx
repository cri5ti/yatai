import { useEffect, useRef, useState } from 'react';

/**
 * Inline editor used everywhere things are created or renamed on the spot.
 *  Enter            commit (blank => cancel, so creating can be aborted)
 *  Shift+Enter      newline
 *  ⌘/Ctrl+Enter     commit and chain: create the next one right after
 *  Esc              cancel
 */
export function InlineEdit({
  initial = '',
  placeholder = 'Type…  (Enter to save · Esc to cancel)',
  multiline = true,
  onCommit,
  onCancel,
  className = '',
}: {
  initial?: string;
  placeholder?: string;
  multiline?: boolean;
  onCommit: (text: string, chain: boolean) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (initial) el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [val]);

  const finish = (chain: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = val.trim();
    if (!t) onCancel();
    else onCommit(t, chain);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      className={`inline-edit ${className}`}
      value={val}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setVal(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(false)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          if (e.shiftKey && multiline) return; // newline
          e.preventDefault();
          finish(e.metaKey || e.ctrlKey);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}
