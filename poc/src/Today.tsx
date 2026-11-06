import { useS } from './store';
import type { Node } from './store';
import { alertsFor, fmt, fmtEst, todayModel } from './model';
import type { Card, EffMeeting } from './model';
import { planToday, startFocus, toast, toggleDone, setTab } from './actions';

export function Chips({ node }: { node: Node }) {
  const s = useS();
  return (
    <>
      {alertsFor(node, s.flags).map((a, i) => (
        <span key={i} className={`chip ${a.tone}`}>
          {a.text}
        </span>
      ))}
    </>
  );
}

const srcIcon: Record<string, string> = { pr: '⑂', pipeline: '⚙', workitem: '▣', ai: '✦' };

function ActionRow({ n, big }: { n: Node; big?: boolean }) {
  return (
    <div className={`arow ${n.status === 'done' ? 'done' : ''} ${big ? 'big' : ''}`}>
      <button className={`check ${n.status === 'done' ? 'on' : ''}`} onClick={() => toggleDone(n.id)} aria-label="toggle done">
        {n.status === 'done' ? '✓' : ''}
      </button>
      <div className="atitle">
        {n.smart && <span className="src">{srcIcon[n.smart.source]}</span>}
        {n.title}
        <Chips node={n} />
      </div>
      {n.est ? <span className="est">{fmtEst(n.est)}</span> : null}
      {n.status !== 'done' && !n.smart && (
        <button className="play" title="Start focus" onClick={() => startFocus(n.id)}>
          ▶
        </button>
      )}
    </div>
  );
}

function PathHeader({ path }: { path: string[] }) {
  const head = path.slice(0, -1);
  const last = path[path.length - 1];
  return (
    <div className="path">
      {head.map((p, i) => (
        <span key={i} className="muted">
          {p} ›{' '}
        </span>
      ))}
      <span className="accent">{last}</span>
    </div>
  );
}

function MeetingCard({ m }: { m: EffMeeting }) {
  const now = m.state === 'now';
  const mins = Math.ceil(m.minsAway);
  return (
    <div className={`card meeting ${now ? 'now' : m.minsAway <= 10 ? 'soon' : ''}`}>
      <div className="mtime">
        <b>{fmt(m.eff)}</b>
        <span>{m.durationMin}m</span>
      </div>
      <div className="mbody">
        <div className="mtitle">{m.title}</div>
        <div className="msub">
          <span className="src">▦</span> {m.where}
          {m.movedFrom != null && <span className="chip warn">moved from {fmt(m.movedFrom)}</span>}
          <span className={`chip ${now ? 'good' : m.minsAway <= 10 ? 'bad' : 'info'}`}>{now ? 'in progress' : `in ${mins} min`}</span>
        </div>
      </div>
      <button className="btn" onClick={() => toast(`(mock) joining ${m.title}`)}>
        Join
      </button>
    </div>
  );
}

function AttentionCard({ c }: { c: Extract<Card, { kind: 'attention' }> }) {
  const s = useS();
  const alerts = alertsFor(c.node, s.flags);
  const worst = alerts.find((a) => a.tone === 'bad') ? 'bad' : 'warn';
  return (
    <div className={`card attention ${worst}`}>
      <PathHeader path={c.path} />
      <ActionRow n={c.node} />
      <div className="cardfoot">
        <button className="btn" onClick={() => toast(`(mock) opening ${c.node.title} in browser`)}>
          Open
        </button>
        <button className="btn ghost" onClick={() => toast('(mock) snoozed for 1h')}>
          Snooze
        </button>
        {c.node.smart?.source === 'ai' && (
          <button className="btn ghost" onClick={() => toast('(mock) opening session terminal')}>
            Reply
          </button>
        )}
      </div>
    </div>
  );
}

export function Today() {
  const s = useS();
  const { cards, later, done, total } = todayModel(s);
  const firstTask = cards.find((c) => c.kind === 'task');
  const dock = s.layout === 'dock';

  return (
    <div className="today">
      <div className="thead">
        <div>
          <div className="h1">Today</div>
          <div className="sub">
            {fmt(s.clock)} · {done}/{total} done
          </div>
        </div>
        <button className="btn ai" disabled={!!s.aiBusy} onClick={planToday} title="AI: plan today">
          ✨ Plan
        </button>
      </div>

      {total > 0 && (
        <div className="progress">
          <i style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}

      {cards.length === 0 && (
        <div className="empty">
          <div className="big">All clear 🎉</div>
          <p>Nothing queued for today. Use ✨ Plan, pick from the Organizer, or triage your Inbox.</p>
          <button className="btn" onClick={() => setTab('inbox')}>
            Open inbox ({s.inbox.length})
          </button>
        </div>
      )}

      <div className="cards">
        {cards.map((c) => {
          if (c.kind === 'meeting') return <MeetingCard key={c.key} m={c.meeting} />;
          if (c.kind === 'attention') return <AttentionCard key={c.key} c={c} />;
          return (
            <div key={c.key} className={`card task ${c === firstTask ? 'next' : ''}`}>
              {c === firstTask && <div className="nextlabel">Next up</div>}
              <PathHeader path={c.path.length ? c.path : ['—']} />
              {c.items.map((n, i) => (
                <ActionRow key={n.id} n={n} big={c === firstTask && i === c.items.findIndex((x) => x.status !== 'done')} />
              ))}
            </div>
          );
        })}
      </div>

      {later.length > 0 && (
        <div className="later">
          <div className="lh">Later today</div>
          {later.map((m) => (
            <div key={m.id} className="lrow">
              <b>{fmt(m.eff)}</b> {m.title}
              {m.movedFrom != null && <span className="chip warn">moved</span>}
              {!dock && <span className="muted"> · {m.where}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
