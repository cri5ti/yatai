import { useEffect, useRef, useState } from 'react';
import { useS } from './store';
import { acceptAi, askAi, closeAi, openAi, rejectAi } from './actions';
import { AI_CFG } from './ai';
import { describe, useView } from './proposal';
import { inline } from './md';
import { cx } from './kbd';

/** Accept / reject for a pending AI proposal — in the popup, and in the window when the popup is closed */
export function ProposalBar({ inPop = false }: { inPop?: boolean }) {
  const { s, marks } = useView();
  if (!s.proposal?.ops.length || !marks) return null;
  return (
    <div className={cx('propbar', inPop && 'in-pop')} role="region" aria-label="AI proposal">
      <span className="pb-dot" aria-hidden />
      <span className="pb-text">
        <b>AI proposes</b> {describe(marks)}
      </span>
      <span className="grow" />
      {!inPop && (
        <button className="btn sm ghost" onClick={() => openAi()} title="Back to the conversation (⌘/)">
          Chat
        </button>
      )}
      <button className="btn sm ghost" onClick={rejectAi} title="Reject (⌘⌫)">
        Reject <kbd>⌘⌫</kbd>
      </button>
      <button className="btn sm prop" onClick={acceptAi} title="Accept (⌘⏎)">
        Accept <kbd>⌘⏎</kbd>
      </button>
    </div>
  );
}

/** before anything has been said: a few useful openers, about the selected item when there is one */
function starters(ctx?: string): string[] {
  const c = ctx && (ctx.length > 28 ? ctx.slice(0, 27) + '…' : ctx);
  return c
    ? [`Break down “${c}”`, `Estimate “${c}”`, "Estimate today's items", 'What should I do next?']
    : ["Estimate today's items", 'What should I do next?', 'Plan my day around my meetings', 'What is overdue or due soon?'];
}

/** ⌘/ — the AI conversation. While a proposal is pending the popup docks out of the way so the purple changes stay visible. */
export function AiPop() {
  const s = useS();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const ai = s.ai;
  const docked = !!s.proposal?.ops.length;
  const sugg = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ai) input.current?.focus();
    else setQ('');
  }, [!!ai]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [ai?.msgs.length, ai?.busy, ai?.status]);
  if (!ai) return null;

  const send = () => {
    if (!q.trim() || ai.busy) return;
    askAi(q);
    setQ('');
  };
  // clickable next steps: what the AI suggested in its latest answer, or openers before the first one
  const last = [...ai.msgs].reverse().find((m) => m.role === 'ai');
  const next = ai.busy ? [] : ai.msgs.length ? last?.suggest ?? [] : starters(ai.ctx);
  const chipKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const all = [...(sugg.current?.querySelectorAll('button') ?? [])];
    const i = all.indexOf(e.currentTarget);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') (e.preventDefault(), all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]?.focus());
    else if (e.key === 'ArrowDown' || e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), input.current?.focus());
  };

  return (
    <div className={cx('ai-veil', docked && 'docked')} onMouseDown={docked ? undefined : closeAi}>
      <div className="ai-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ask AI">
        <div className="ai-head">
          <span>✨ Ask AI</span>
          {ai.ctx && <span className="ai-ctx">about “{ai.ctx}”</span>}
          <span className="grow" />
          <span className="ai-model" title={AI_CFG.configured ? 'OpenAI model (OPENAI_MODEL in poc/.env)' : 'No OPENAI_API_KEY in poc/.env — replies are mocked'}>
            {AI_CFG.configured ? AI_CFG.model : 'mock'}
          </span>
          <kbd>Esc</kbd>
        </div>
        {(ai.msgs.length > 0 || ai.busy) && (
          <div className="ai-log" ref={log}>
            {ai.msgs.map((m) => (
              <div key={m.id} className={cx('ai-msg', m.role, m.error && 'error')}>
                {m.text.split('\n').map((l, i) => (
                  <div key={i}>{l ? inline(l, `a${m.id}${i}`) : ' '}</div>
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
            {ai.busy && (
              <div className="ai-msg ai typing">
                <i />
                <i />
                <i />
                {ai.status && <span className="ai-status">{ai.status}</span>}
              </div>
            )}
          </div>
        )}
        <ProposalBar inPop />
        {next.length > 0 && (
          <div className="ai-sugg" ref={sugg} role="group" aria-label="Suggested next steps (↑ from the input)">
            {next.map((t) => (
              <button key={t} className="ai-chip" onClick={() => (askAi(t), input.current?.focus())} onKeyDown={chipKey} title="Send this">
                {t}
              </button>
            ))}
          </div>
        )}
        <input
          ref={input}
          className="ai-input"
          value={q}
          placeholder={docked ? 'Refine the proposal…' : AI_CFG.configured ? "e.g. estimate today's items" : 'Ask something (mocked)'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey) return; // ⌘⏎ / ⌘⌫ are handled globally while a proposal is pending
            e.stopPropagation();
            if (e.key === 'Escape') (e.preventDefault(), closeAi());
            else if (e.key === 'Enter') (e.preventDefault(), send());
            else if (e.key === 'ArrowUp' && !q) (e.preventDefault(), (sugg.current?.querySelector('button') as HTMLElement | null)?.focus());
          }}
        />
      </div>
    </div>
  );
}
