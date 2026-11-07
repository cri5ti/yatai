import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import { askAi, closeAi } from './actions';
import { inline } from './md';

/** ⌘/ — tiny AI popup: type, get a (mocked) reply, Esc closes. */
export function AiPop() {
  const s = useS();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const ai = s.ai;
  useEffect(() => {
    if (ai) input.current?.focus();
    else setQ('');
  }, [!!ai]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [ai?.msgs.length, ai?.busy]);
  if (!ai) return null;

  const send = () => {
    if (!q.trim()) return;
    askAi(q);
    setQ('');
  };

  return (
    <div className="ai-veil" onMouseDown={closeAi}>
      <div className="ai-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ask AI">
        <div className="ai-head">
          <span>✨ Ask AI</span>
          {ai.ctx && <span className="ai-ctx">about “{ai.ctx}”</span>}
          <span className="grow" />
          <kbd>Esc</kbd>
        </div>
        {(ai.msgs.length > 0 || ai.busy) && (
          <div className="ai-log" ref={log}>
            {ai.msgs.map((m) => (
              <div key={m.id} className={`ai-msg ${m.role}`}>
                {m.text.split('\n').map((l, i) => (
                  <div key={i}>{inline(l, `a${m.id}${i}`)}</div>
                ))}
                {m.chips && (
                  <div className="ai-chips">
                    {m.chips.map((c) => (
                      <button key={c.label} className="btn sm ai" onClick={c.run}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {ai.busy && <div className="ai-msg ai typing"><i /><i /><i /></div>}
          </div>
        )}
        <input
          ref={input}
          className="ai-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') (e.preventDefault(), closeAi());
            else if (e.key === 'Enter') (e.preventDefault(), send());
          }}
        />
      </div>
    </div>
  );
}
