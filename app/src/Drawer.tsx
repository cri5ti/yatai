import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useS } from './store';
import type { State } from './store';
import { act } from './act';
import { allAgenda, fmt, refsOf, relTime } from './model';
import { GhIcon, PrState } from './Pr';
import { cx } from './kbd';
import { isTauri } from './platform';
import { pluginById, implFor } from './plugins/registry';
import type { Entry as PluginEntry, ListDef } from './plugins/types';

interface Row {
  id: string;
  lead: ReactNode;
  title: ReactNode;
  sub: string;
  have: boolean; // already in yatai
  dim?: boolean;
  add: (to: 'next' | 'inbox') => void;
  canInbox: boolean;
}

const TITLES: Record<string, ReactNode> = {
  outlook: <>📅 Outlook</>,
  github: (
    <>
      <GhIcon /> GitHub
    </>
  ),
  devops: <>◈ DevOps</>,
};

/** the tabs of a plugin's drawer (the mock's when only that exists, so the tabs are there before it is connected) */
function tabsOf(kind: string): ListDef[] {
  const p = pluginById(kind);
  return p?.live?.lists ?? p?.mock?.lists ?? [];
}

/** why a drawer has nothing to show yet, and what to do about it */
function blocked(s: State, kind: string): { text: string; connect?: boolean } | null {
  const p = pluginById(kind);
  if (!p || implFor(p, s)) return null;
  if (p.live && !isTauri) return { text: `${p.name} needs the desktop app.` };
  if (p.live && p.auth) {
    const st = s.accounts[kind]?.state;
    return { text: st === 'expired' ? `${p.name} rejected the token.` : `${p.name} is not connected.`, connect: true };
  }
  return { text: `The ${p.name} connector is not built yet.` };
}

const rowOf = (en: PluginEntry, s: State): Row => ({
  id: en.ref,
  lead: 'text' in en.lead ? <span className="dtime">{en.lead.text}</span> : <PrState status={en.lead.glyph as never} comments={en.lead.count} />,
  title: en.snap ? (
    <>
      <b>{en.snap.name}</b> {en.title}
    </>
  ) : (
    en.title
  ),
  sub: en.sub,
  have: en.meeting ? s.meetings.some((m) => m.id === en.meeting!.id) : s.nodes.some((n) => refsOf(n).includes(en.ref)),
  dim: en.dim,
  canInbox: en.canInbox,
  add: (to) => (en.meeting ? act.bringMeeting(en.meeting.id, en.meeting) : act.bringIn({ title: en.text, ref: en.ref, smart: en.smart, snap: en.snap }, to)),
});

function rowsFor(s: State, kind: string, tab: string): Row[] {
  const p = pluginById(kind);
  const impl = p && implFor(p, s);
  if (!p || !impl) return [];
  if (kind === 'outlook' && tab === 'today') {
    // a calendar plugin lists today's agenda
    const mine = new Map(s.meetings.map((m) => [m.id, m]));
    return (s.agenda[kind] ?? allAgenda(s))
      .filter((e) => (e.day ?? s.day) === s.day)
      .filter((e) => !e.cancelled || mine.has(e.id))
      .sort((a, b) => a.start - b.start)
      .map((e) => {
        const have = mine.get(e.id);
        const minsAway = e.start - s.clock;
        const state = minsAway > 0 ? 'upcoming' : minsAway + e.durationMin > 0 ? 'now' : 'done';
        const from = have && have.start !== e.start ? have.start : undefined;
        return {
          id: e.id,
          lead: <span className="dtime">{fmt(e.start)}</span>,
          title: (
            <>
              {e.title}
              {from != null && <span className="chip warn">moved from {fmt(from)}</span>}
            </>
          ),
          sub: `${e.durationMin} min · ${e.where}${e.cancelled ? ' · cancelled' : state === 'now' ? ' · in progress' : state === 'done' ? ' · ended' : ''}`,
          have: !!have,
          dim: state === 'done',
          canInbox: false,
          add: () => act.bringMeeting(e.id),
        };
      });
  }
  return (s.lists[`${kind}/${tab}`]?.entries ?? []).map((en) => rowOf(en, s));
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

  const tabs = tabsOf(d.kind);
  const entries = rowsFor(s, d.kind, d.tab);
  const block = blocked(s, d.kind);
  const ls = s.lists[`${d.kind}/${d.tab}`];
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
    } else if (k === 'r' || k === 'R') {
      stop();
      act.refreshDrawer();
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
        <span className="dtitle">{(TITLES[d.kind] ?? d.kind)}</span>
        <div className="dtabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={d.tab === t.id} className={d.tab === t.id ? 'on' : ''} onClick={() => act.setDrawerTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className={cx('x', 'refresh', ls?.loading && 'spin')} aria-label="Refresh" title="Refresh (R)" disabled={!!ls?.loading || !!block} onClick={() => act.refreshDrawer()}>
          ↻
        </button>
        <button className="x" aria-label="Close" title="Close (Esc)" onClick={() => act.closeDrawer()}>
          ✕
        </button>
      </div>
      <div className="dlist" tabIndex={0} ref={list} data-drawer-list>
        {block ? (
          <div className="dempty">
            {block.text}
            <br />
            {block.connect && (
              <button className="btn sm" onClick={() => act.openSettings()}>
                Connect in Settings…
              </button>
            )}{' '}
            <button className="btn sm" onClick={() => act.setDemo(true)}>
              Use demo data
            </button>
          </div>
        ) : ls?.error ? (
          <div className="dempty">{ls.error}</div>
        ) : !ls && !(d.kind === 'outlook' && d.tab === 'today') ? (
          <div className="dempty">Loading…</div>
        ) : (
          entries.length === 0 && (
            <div className="dempty">
              Nothing here.{d.kind === 'github' && s.accounts.github?.state === 'connected' && !s.demo ? ' If you expected pull requests of an organisation, the token probably cannot see its repositories (repository access, the org’s approval, SSO).' : ''}
            </div>
          )
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
        <kbd>↑↓</kbd> choose · {tabs.length > 1 && (<><kbd>←→</kbd> tab · </>)}<kbd>⏎</kbd> add to Next · <kbd>R</kbd> refresh · {d.kind !== 'outlook' && (<><kbd>I</kbd> add to Inbox · </>)}<kbd>Esc</kbd> close{ls?.at ? ` · updated ${relTime(ls.at)}` : ''}
      </div>
    </div>
  );
}
