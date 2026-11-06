import { useState } from 'react';
import { useS } from './store';
import { capture, clearSuggestion, dropInbox, fileInbox, suggestInbox } from './actions';
import { breadcrumb } from './mock';
import { relTime } from './model';

export function Inbox() {
  const s = useS();
  const [text, setText] = useState('');
  const [over, setOver] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const targets = s.nodes.filter((n) => n.kind !== 'action');
  const unsuggested = s.inbox.some((i) => !i.suggestion);

  const submit = () => {
    capture(text);
    setText('');
  };

  return (
    <div className="inbox">
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
        className="capture"
        placeholder="Dump an idea…  (Enter)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      <div className="inbox-body">
        <div className="ilist">
          {s.inbox.length === 0 && <div className="empty small">Inbox zero. Nice.</div>}
          {s.inbox.map((i) => (
            <div
              key={i.id}
              className={`irow ${drag === i.id ? 'dragging' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', i.id);
                setDrag(i.id);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <span className="grip">⋮⋮</span>
              <div className="ibody">
                <div>{i.text}</div>
                <div className="isub">{relTime(i.created)}</div>
                {i.suggesting && <div className="shimmer">✨ thinking…</div>}
                {i.suggestion && (
                  <div className="suggest">
                    <span>
                      ✨ → <b>{breadcrumb(s.nodes, i.suggestion.parentId)}</b>
                      <em>{i.suggestion.reason}</em>
                    </span>
                    <span className="sbtns">
                      <button className="btn sm" onClick={() => fileInbox(i.id, i.suggestion!.parentId)}>
                        Accept
                      </button>
                      <button className="btn sm ghost" onClick={() => clearSuggestion(i.id)}>
                        ✕
                      </button>
                    </span>
                  </div>
                )}
              </div>
              <select
                className="fileto"
                value=""
                title="File into…"
                onChange={(e) => e.target.value && fileInbox(i.id, e.target.value)}
              >
                <option value="">File…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {breadcrumb(s.nodes, t.id)}
                  </option>
                ))}
              </select>
              <button className="x" title="Discard" onClick={() => dropInbox(i.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="targets">
          <div className="lh">Drop onto…</div>
          {targets.map((t) => (
            <div
              key={t.id}
              className={`target ${t.kind} ${over === t.id ? 'over' : ''} ${drag ? 'armed' : ''}`}
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
    </div>
  );
}
