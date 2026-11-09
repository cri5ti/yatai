import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useS } from './store';
import type { State } from './store';
import { act } from './act';
import { allAgenda, fmt, refsOf, relTime } from './model';
import { BuildState, GhIcon, PrState } from './Pr';
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
  repo?: string; // 'org/repo' of a pull request, for the filter
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
  lead: 'text' in en.lead ? <span className="dtime">{en.lead.text}</span> : en.lead.kind === 'build' ? <BuildState status={en.lead.glyph as never} /> : <PrState status={en.lead.glyph as never} comments={en.lead.count} />,
  title: en.snap ? (
    <>
      <b>{en.snap.name}</b> {en.title}
    </>
  ) : (
    en.title
  ),
  sub: en.sub,
  repo: /([\w.-]+\/[\w.-]+)#\d+/.exec(en.ref)?.[1] ?? (en.sub.includes(' · ') ? en.sub.split(' · ')[0] : undefined),
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
  const find = useRef<HTMLInputElement>(null);
  const [bar, setBar] = useState(false); // the filter bar
  const [picked, setPicked] = useState<string[]>([]); // …the repositories it lets through (none picked = all)
  const [menu, setMenu] = useState(false); // the repository drop-down is open
  const [mq, setMq] = useState(''); // search inside the drop-down
  const [mi, setMi] = useState(0); // highlighted row of the drop-down
  useEffect(() => {
    if (d) list.current?.focus({ preventScroll: true });
  }, [d?.kind, d?.tab]);
  useEffect(() => {
    list.current?.querySelector('.drow.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [d?.sel]);
  if (!d) return null;

  const tabs = tabsOf(d.kind);
  const all = rowsFor(s, d.kind, d.tab);
  const repos = [...new Set(all.flatMap((e) => (e.repo ? [e.repo] : [])))].sort();
  const canFilter = repos.length > 0 || picked.length > 0;
  const entries = picked.length ? all.filter((e) => e.repo && picked.includes(e.repo)) : all;
  const shown = repos.filter((r) => r.toLowerCase().includes(mq.trim().toLowerCase()));
  const count = (r: string) => all.filter((e) => e.repo === r).length;
  const toggle = (r: string) => (setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r])), act.setDrawerSel(0));
  const openMenu = () => (setMenu(true), setMq(''), setMi(0), requestAnimationFrame(() => find.current?.focus()));
  const closeMenu = () => (setMenu(false), list.current?.focus({ preventScroll: true }));
  const openBar = () => (setBar(true), openMenu());
  const closeBar = () => (setBar(false), setMenu(false), setPicked([]), list.current?.focus({ preventScroll: true }));
  const block = blocked(s, d.kind);
  const ls = s.lists[`${d.kind}/${d.tab}`];
  const sel = Math.min(d.sel, Math.max(0, entries.length - 1));
  const cur = entries[sel];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    const k = e.key;
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      // in the drop-down's search box: ↑↓ move, ⏎ ticks, Esc closes the drop-down (then the bar)
      if (k === 'Escape') return stop(), mq ? setMq('') : menu ? closeMenu() : closeBar();
      if (k === 'ArrowDown') return stop(), setMi(Math.min(shown.length - 1, mi + 1));
      if (k === 'ArrowUp') return stop(), setMi(Math.max(0, mi - 1));
      if (k === 'Enter' && shown[mi]) return stop(), toggle(shown[mi]);
      return;
    }
    if ((k === 'f' || k === 'F' || k === '/') && canFilter) return stop(), openBar();
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
        {canFilter && (
          <button className={cx('x', 'filter', (bar || picked.length > 0) && 'on')} aria-label="Filter by repository" aria-pressed={bar} title="Filter by repository (F)" onClick={() => (bar ? closeBar() : openBar())}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill={picked.length ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
              <path d="M2 3h12l-4.6 5.4V13l-2.8-1.4V8.4z" />
            </svg>
          </button>
        )}
        <button className={cx('x', 'refresh', ls?.loading && 'spin')} aria-label="Refresh" title="Refresh (R)" disabled={!!ls?.loading || !!block} onClick={() => act.refreshDrawer()}>
          ↻
        </button>
        <button className="x" aria-label="Close" title="Close (Esc)" onClick={() => act.closeDrawer()}>
          ✕
        </button>
      </div>
      {bar && canFilter && (
        <div className="dfilter" role="search">
          <button className="dsel" aria-haspopup="listbox" aria-expanded={menu} onClick={() => (menu ? closeMenu() : openMenu())}>
            <span>{picked.length === 0 ? 'All repositories' : picked.length === 1 ? picked[0] : `${picked.length} repositories`}</span>
            <i aria-hidden>▾</i>
          </button>
          {picked.length > 0 && (
            <button className="btn sm" onClick={() => (setPicked([]), act.setDrawerSel(0))}>
              Clear
            </button>
          )}
          {menu && (
            <div className="dmenu" role="listbox" aria-multiselectable="true">
              <input ref={find} value={mq} spellCheck={false} placeholder="Search repositories…" aria-label="Search repositories" onChange={(e) => (setMq(e.target.value), setMi(0))} />
              <div className="dopts">
                {shown.map((r, i) => (
                  <label key={r} role="option" aria-selected={picked.includes(r)} className={cx('dopt', i === mi && 'hi')} onMouseMove={() => setMi(i)}>
                    <input type="checkbox" checked={picked.includes(r)} onChange={() => toggle(r)} />
                    <span>{r}</span>
                    <small>{count(r)}</small>
                  </label>
                ))}
                {!shown.length && <div className="dnone">No repository matches.</div>}
              </div>
            </div>
          )}
        </div>
      )}
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
              {picked.length ? 'Nothing in the selected repositories.' : 'Nothing here.'}{!picked.length &&d.kind === 'github' && s.accounts.github?.state === 'connected' && !s.demo && ' If you expected pull requests of an organisation, the token probably cannot see its repositories (repository access, the org’s approval, SSO).'}
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
        <kbd>↑↓</kbd> choose · {tabs.length > 1 && (<><kbd>←→</kbd> tab · </>)}<kbd>⏎</kbd> add to Next · <kbd>R</kbd> refresh · {canFilter && (<><kbd>F</kbd> filter · </>)}{d.kind !== 'outlook' && (<><kbd>I</kbd> add to Inbox · </>)}<kbd>Esc</kbd> close{ls?.at ? ` · updated ${relTime(ls.at)}` : ''}
      </div>
    </div>
  );
}
