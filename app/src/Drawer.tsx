import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CALENDAR, useS } from './store';
import type { DrawerKind, State } from './store';
import { ADO, GH } from './mock';
import { act } from './act';
import { fmt, meetingsFor, prLinks } from './model';
import { GhIcon, PrState } from './Pr';
import { cx } from './kbd';

interface Entry {
  id: string;
  lead: ReactNode;
  title: ReactNode;
  sub: string;
  have: boolean; // already in yatai
  dim?: boolean;
  add: (to: 'next' | 'inbox') => void;
  canInbox: boolean;
}

const TABS: Record<DrawerKind, { id: string; label: string }[]> = {
  outlook: [{ id: 'today', label: 'Today’s agenda' }],
  github: [
    { id: 'assigned', label: 'Assigned to me' },
    { id: 'mine', label: 'My PRs' },
    { id: 'mentions', label: 'Mentions' },
  ],
  devops: [
    { id: 'mentions', label: 'Mentions' },
    { id: 'mine', label: 'My work items' },
    { id: 'created', label: 'Created by me' },
  ],
};
const TITLES: Record<DrawerKind, ReactNode> = {
  outlook: <>📅 Outlook</>,
  github: (
    <>
      <GhIcon /> GitHub
    </>
  ),
  devops: <>◈ DevOps</>,
};

/** what the real connector will need (design.md §4) — until then the drawer says so instead of showing made-up data */
const PENDING: Record<DrawerKind, string> = {
  outlook: 'The Outlook calendar connector (Microsoft Graph, read-only) is not built yet.',
  github: 'The GitHub connector is not built yet. Pasting a pull-request link into any item already shows it as a PR.',
  devops: 'The Azure DevOps connector is not built yet.',
};

function entriesFor(s: State, kind: DrawerKind, tab: string): Entry[] {
  if (!s.demo) return [];
  if (kind === 'outlook') {
    return meetingsFor({ meetings: CALENDAR, flags: s.flags, clock: s.clock }).map((m) => ({
      id: m.id,
      lead: <span className="dtime">{fmt(m.eff)}</span>,
      title: (
        <>
          {m.title}
          {m.movedFrom != null && <span className="chip warn">moved from {fmt(m.movedFrom)}</span>}
        </>
      ),
      sub: `${m.durationMin} min · ${m.where}${m.state === 'now' ? ' · in progress' : m.state === 'done' ? ' · ended' : ''}`,
      have: s.meetings.some((x) => x.id === m.id),
      dim: m.state === 'done',
      canInbox: false,
      add: () => act.bringMeeting(m.id),
    }));
  }
  if (kind === 'github') {
    return (GH[tab] ?? []).map((g) => {
      const key = `${g.org}/${g.repo}#${g.num}`;
      const url = `https://github.com/${g.org}/${g.repo}/pull/${g.num}`;
      return {
        id: key,
        lead: <PrState status={s.prs[key] ?? g.status} comments={s.prc[key] ?? g.comments} />,
        title: (
          <>
            <b>
              {g.repo}#{g.num}
            </b>{' '}
            {g.title}
          </>
        ),
        sub: `${g.org} · ${g.note}`,
        have: s.nodes.some((n) => prLinks(n.title).some((l) => l.key === key)),
        canInbox: true,
        add: (to) => act.bringIn({ title: `${url} ${g.title}`, pr: { key, status: g.status, comments: g.comments } }, to),
      };
    });
  }
  return (ADO[tab] ?? []).map((w) => ({
    id: w.id,
    lead: <span className="dtime">WI {w.id}</span>,
    title: w.title,
    sub: `${w.type} · ${w.state} · ${w.note}`,
    have: s.nodes.some((n) => n.title.includes(`WI ${w.id}`)),
    canInbox: true,
    add: (to) => act.bringIn({ title: `WI ${w.id} — ${w.title}`, smart: { source: 'workitem' } }, to),
  }));
}

/** a pop-up over the bottom of the window: browse a source, bring things in (⏎ → Next, I → Inbox) */
export function Drawer() {
  const s = useS();
  const d = s.drawer;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (d) list.current?.focus({ preventScroll: true });
  }, [d?.kind, d?.tab]);
  useEffect(() => {
    list.current?.querySelector('.drow.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [d?.sel]);
  if (!d) return null;

  const tabs = TABS[d.kind];
  const entries = entriesFor(s, d.kind, d.tab);
  const sel = Math.min(d.sel, Math.max(0, entries.length - 1));
  const cur = entries[sel];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    const k = e.key;
    if (k === 'Escape') (stop(), act.closeDrawer());
    else if (k === 'ArrowDown') (stop(), act.setDrawerSel(Math.min(entries.length - 1, sel + 1)));
    else if (k === 'ArrowUp') (stop(), act.setDrawerSel(Math.max(0, sel - 1)));
    else if ((k === 'ArrowRight' || k === 'ArrowLeft') && tabs.length > 1) {
      stop();
      const i = tabs.findIndex((t) => t.id === d.tab);
      act.setDrawerTab(tabs[(i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id);
    } else if (k === 'Enter' && cur) {
      stop();
      cur.have ? act.toast('Already in yatai') : cur.add('next');
    } else if ((k === 'i' || k === 'I') && cur?.canInbox) {
      stop();
      cur.have ? act.toast('Already in yatai') : cur.add('inbox');
    }
  };

  return (
    <div className={`drawer drawer-${d.kind}`} role="dialog" aria-label={`${d.kind} — bring things in`} onKeyDown={onKey}>
      <div className="dhead">
        <span className="dtitle">{TITLES[d.kind]}</span>
        <div className="dtabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={d.tab === t.id} className={d.tab === t.id ? 'on' : ''} onClick={() => act.setDrawerTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="x" aria-label="Close" title="Close (Esc)" onClick={() => act.closeDrawer()}>
          ✕
        </button>
      </div>
      <div className="dlist" tabIndex={0} ref={list} data-drawer-list>
        {!s.demo ? (
          <div className="dempty">
            {PENDING[d.kind]}
            <br />
            <button className="btn sm" onClick={() => act.setDemo(true)}>
              Use demo data
            </button>
          </div>
        ) : (
          entries.length === 0 && <div className="dempty">Nothing here.</div>
        )}
        {entries.map((en, i) => (
          <div key={en.id} className={cx('drow', i === sel && 'is-sel', en.have && 'have', en.dim && 'dim')} onClick={() => act.setDrawerSel(i)} onDoubleClick={() => !en.have && en.add('next')}>
            {en.lead}
            <div className="dmain">
              <div className="dt">{en.title}</div>
              <div className="ds">{en.sub}</div>
            </div>
            {en.have ? (
              <span className="dhave">✓ in yatai</span>
            ) : (
              <span className="dgo">
                <button className="btn sm" tabIndex={-1} title="Add to Next (⏎)" onClick={(e) => (e.stopPropagation(), en.add('next'))}>
                  ＋ Next
                </button>
                {en.canInbox && (
                  <button className="btn sm" tabIndex={-1} title="Add to the Inbox (I)" onClick={(e) => (e.stopPropagation(), en.add('inbox'))}>
                    Inbox
                  </button>
                )}
              </span>
            )}
            {en.have && <span className="dgo" />}
          </div>
        ))}
      </div>
      <div className="dfoot">
        <kbd>↑↓</kbd> choose · {tabs.length > 1 && (<><kbd>←→</kbd> tab · </>)}<kbd>⏎</kbd> add to Next · {d.kind !== 'outlook' && (<><kbd>I</kbd> add to Inbox · </>)}<kbd>Esc</kbd> close
      </div>
    </div>
  );
}
