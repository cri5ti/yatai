import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { get, useS } from './store';
import type { State } from './store';
import { act } from './act';
import { allAgenda, fmt, refsOf, relTime } from './model';
import { BuildState, ClaudeState, GhIcon, PrState } from './Pr';
import type { ClaudeGlyph } from './plugins/claude/map';
import { cx } from './kbd';
import { isTauri } from './platform';
import { pluginById, implFor } from './plugins/registry';
import { enabled } from './plugins/config';
import { clashes, range } from './plugins/outlook/days';
import { Schedule } from './Schedule';
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
  details?: [string, string][]; // the little popup behind the arrow
  repo?: string; // 'org/repo' of a pull request, for the filter
  clash?: boolean; // a double-booked meeting
  at?: { start: number; dur: number }; // a meeting's time (the schedule view plots it)
  /** where "now" is: a line inside this row (0–1 of the way through it), or just above / below it */
  now?: number | 'before' | 'after';
}


/** the tabs of a plugin's drawer (the mock's when only that exists, so the tabs are there before it is connected) */
function tabsOf(s: State, kind: string): ListDef[] {
  const p = pluginById(kind);
  return (p && implFor(p, s)?.lists) ?? p?.live?.lists ?? p?.mock?.lists ?? [];
}

/** why a drawer has nothing to show yet, and what to do about it */
function blocked(s: State, kind: string): { text: string; connect?: boolean } | null {
  const p = pluginById(kind);
  if (!p || implFor(p, s)) return null;
  if (!enabled(s.settings, kind)) return { text: `${p.name} is switched off: turn it on in Settings → Sources.` };
  if (p.live && !isTauri) return { text: `${p.name} needs the desktop app.` };
  if (p.live && p.auth) {
    const st = s.accounts[kind]?.state;
    return { text: st === 'expired' ? `${p.name} rejected the token.` : `${p.name} is not connected.`, connect: true };
  }
  return { text: `The ${p.name} connector is not built yet.` };
}

const rowOf = (en: PluginEntry, s: State): Row => ({
  id: en.ref,
  lead: 'text' in en.lead ? <span className="dtime">{en.lead.text}</span> : en.lead.kind === 'build' ? <BuildState status={en.lead.glyph as never} /> : en.lead.kind === 'claude' || en.lead.kind === 'copilot' || en.lead.kind === 'codex' ? <ClaudeState status={en.lead.glyph as ClaudeGlyph} who={en.lead.kind === 'claude' ? 'Claude' : en.lead.kind === 'codex' ? 'Codex' : 'Copilot'} /> : <PrState status={en.lead.glyph as never} comments={en.lead.count} turn={en.lead.turn} />,
  details: en.details,
  title: en.snap || en.label ? (
    <>
      <b>{en.label ?? en.snap!.name}</b> {en.title}
    </>
  ) : (
    en.title
  ),
  sub: en.sub,
  repo: /([\w.-]+\/[\w.-]+)#\d+/.exec(en.ref)?.[1] ?? (en.sub.includes(' · ') ? en.sub.split(' · ')[0] : undefined),
  have: en.meeting ? s.meetings.some((m) => m.id === en.meeting!.id) : s.nodes.some((n) => refsOf(n).includes(en.ref)),
  dim: en.dim,
  clash: en.clash,
  at: en.meeting ? { start: en.meeting.start, dur: en.meeting.durationMin } : undefined,
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
    const evs = (s.agenda[kind] ?? allAgenda(s))
      .filter((e) => (e.day ?? s.day) === s.day)
      .filter((e) => !e.cancelled || mine.has(e.id))
      .sort((a, b) => a.start - b.start);
    const clash = clashes(evs.filter((e) => !e.cancelled));
    const rows: Row[] = evs.map((e) => {
      const have = mine.get(e.id);
      const minsAway = e.start - s.clock;
      const state = minsAway > 0 ? 'upcoming' : minsAway + e.durationMin > 0 ? 'now' : 'done';
      const from = have && have.start !== e.start ? have.start : undefined;
      return {
        id: e.id,
        lead: <span className="dtime">{range(e)}</span>,
        title: (
          <>
            {e.title}
            {from != null && <span className="chip warn">moved from {fmt(from)}</span>}
            {e.cancelled && <span className="chip info">cancelled</span>}
          </>
        ),
        sub: '',
        have: !!have,
        dim: state === 'done' || e.cancelled,
        clash: clash.has(e.id),
        at: { start: e.start, dur: e.durationMin },
        // in a meeting: the line runs through it, as far as it has got; between meetings: above the next one
        now: state === 'now' ? (s.clock - e.start) / e.durationMin : undefined,
        canInbox: false,
        add: () => act.bringMeeting(e.id),
      };
    });
    if (!rows.some((r) => typeof r.now === 'number')) {
      const next = evs.findIndex((e) => e.start > s.clock);
      if (next >= 0) rows[next].now = 'before';
      else if (rows.length) rows[rows.length - 1].now = 'after';
    }
    return rows;
  }
  return (s.lists[`${kind}/${tab}`]?.entries ?? []).map((en) => rowOf(en, s));
}

/** a tiny "requests: 12" (in the last hour), and what is left of the quota when the source says */
function ReqCount({ r }: { r?: State['reqs'][string] }) {
  const n = r?.at.filter((t) => t > Date.now() - 3_600_000).length ?? 0;
  const q = r?.quota;
  const tip = `${n} request${n === 1 ? '' : 's'} in the last hour, ${r?.total ?? 0} since yatai started${q ? ` · ${q.left} of ${q.limit} GitHub points left, resets ${new Date(q.reset).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  return (
    <span className={cx('dreq', q && q.left < q.limit * 0.1 && 'low')} title={tip}>
      requests: {n}
      {q ? ` · ${q.left.toLocaleString()} left` : ''}
    </span>
  );
}

/**
 * placeholder rows: nothing loaded yet for this tab, or a refresh the user asked for (R / ↻) is running. The background
 * refreshes keep showing what is there; an error or a source that is not on shows its message instead.
 */
export function showSkeleton(s: Pick<State, 'lists' | 'agenda'>, d: { kind: string; tab: string }, blocked: boolean, manual: boolean): boolean {
  const ls = s.lists[`${d.kind}/${d.tab}`];
  if (blocked || ls?.error) return false;
  if (d.kind === 'outlook' && d.tab === 'today') return !s.agenda[d.kind];
  return !ls || (!!ls.loading && (!ls.entries.length || manual));
}

/** placeholder rows while a list loads: the shape of the real ones (a round state icon, or a time / number on the left) */
function Skeleton({ round }: { round: boolean }) {
  const widths = [[72, 46], [58, 64], [80, 38], [64, 52], [50, 60], [76, 44]];
  return (
    <div className="dskel" aria-busy="true" aria-label="Loading">
      {widths.map(([a, b], i) => (
        <div key={i} className="drow skel" style={{ ['--i' as string]: i } as React.CSSProperties}>
          <span className={round ? 'sk sk-dot' : 'sk sk-lead'} />
          <div className="dmain">
            <span className="sk sk-line" style={{ width: `${a}%` }} />
            <span className="sk sk-line sm" style={{ width: `${b}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
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
  const [more, setMore] = useState<string | null>(null); // the row whose details popup is open
  const [manual, setManual] = useState(false); // a refresh the user asked for is running: show placeholders
  const [listH, setListH] = useState(400); // the list's height: the schedule fits the working hours on 80% of it
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListH(el.clientHeight || 400));
    ro.observe(el);
    return () => ro.disconnect();
  }, [d?.kind]);
  const refresh = () => (setManual(true), act.refreshDrawer());
  useEffect(() => {
    if (d) list.current?.focus({ preventScroll: true });
  }, [d?.kind, d?.tab]);
  useEffect(() => setMore(null), [d?.kind, d?.tab, d?.sel]);
  useEffect(() => {
    list.current?.querySelector('.drow.is-sel, .sblock.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [d?.sel]);
  // the schedule opens at the start of the working day (today: a little before now, if that is later)
  const plotKey = d && d.kind === 'outlook' && (d.tab === 'today' || d.tab === 'tomorrow') && s.outlookView === 'day' ? d.tab : '';
  useEffect(() => {
    if (!plotKey) return;
    requestAnimationFrame(() => {
      const el = list.current;
      const sc = el?.querySelector<HTMLElement>('.sched');
      if (!el || !sc) return;
      const from = Number(sc.dataset.schedFrom);
      const ppm = Number(sc.dataset.schedPpm);
      const st = get().settings;
      const at = plotKey === 'today' ? Math.max(st.workStart, get().clock - 45) : st.workStart;
      el.scrollTop = Math.max(0, (at - from) * ppm - 0.05 * el.clientHeight);
    });
  }, [plotKey, listH]);
  // a manual refresh's placeholders go once that list stops loading (hooks stay above the early return)
  const busy = !!(d && s.lists[`${d.kind}/${d.tab}`]?.loading);
  const seenBusy = useRef(false);
  useEffect(() => {
    if (busy) seenBusy.current = true;
    else if (seenBusy.current) ((seenBusy.current = false), setManual(false));
  }, [busy]);
  useEffect(() => {
    // asked for, but nothing started loading (blocked, or already fresh): do not keep placeholders up
    if (!manual) return;
    const t = setTimeout(() => !seenBusy.current && setManual(false), 2500);
    return () => clearTimeout(t);
  }, [manual]);
  if (!d) return null;

  const tabs = tabsOf(s, d.kind);
  // groups of tabs (DevOps: Builds · Work items): a first row, the tabs of the group the open one is in below it
  const groups = [...new Set(tabs.flatMap((t) => (t.group ? [t.group] : [])))];
  const group = tabs.find((t) => t.id === d.tab)?.group ?? groups[0];
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
  const skeleton = showSkeleton(s, d, !!block, manual);
  // the day schedule: Outlook's single-day tabs, when chosen (V or the header button)
  const canPlot = d.kind === 'outlook' && (d.tab === 'today' || d.tab === 'tomorrow');
  const dayView = canPlot && s.outlookView === 'day';
  const sel = Math.min(d.sel, Math.max(0, entries.length - 1));
  const cur = entries[sel];

  const onKey = (e: React.KeyboardEvent) => {
    if (canPlot && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v' && !(e.target as HTMLElement).closest('input')) {
      e.preventDefault();
      return act.setOutlookView(dayView ? 'list' : 'day');
    }
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
    if (k === 'Escape') (stop(), more ? setMore(null) : act.closeDrawer());
    else if ((k === 'd' || k === 'D' || k === ' ') && cur?.details) (stop(), setMore(more === cur.id ? null : cur.id));
    else if (k === 'ArrowDown') (stop(), act.setDrawerSel(Math.min(entries.length - 1, sel + 1)));
    else if (k === 'ArrowUp') (stop(), act.setDrawerSel(Math.max(0, sel - 1)));
    else if ((k === 'ArrowRight' || k === 'ArrowLeft') && tabs.length > 1) {
      stop();
      const i = tabs.findIndex((t) => t.id === d.tab);
      act.setDrawerTab(tabs[(i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id);
    } else if (k === 'r' || k === 'R') {
      stop();
      refresh();
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
      <div className="dtitlebar">
        <span className="dgrip" aria-hidden="true">⋯</span>
        <button className="x" aria-label="Close" title="Close (Esc)" onClick={() => act.closeDrawer()}>
          ✕
        </button>
      </div>
      {groups.length > 1 && (
        <div className="dgroups" role="tablist" aria-label="Kinds">
          {groups.map((g) => (
            <button key={g} role="tab" aria-selected={g === group} className={g === group ? 'on' : ''} onClick={() => act.setDrawerTab(tabs.find((t) => t.group === g)!.id)}>
              {g}
            </button>
          ))}
        </div>
      )}
      <div className="dhead">
        <div className="dtabs" role="tablist">
          {tabs.filter((t) => !group || t.group === group).map((t) => (
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
        {canPlot && (
          <button
            className={cx('x', 'viewtoggle', dayView && 'on')}
            aria-label={dayView ? 'Show as a list' : 'Show as a schedule'}
            aria-pressed={dayView}
            title={dayView ? 'List (V)' : 'Schedule by the hour (V)'}
            onClick={() => act.setOutlookView(dayView ? 'list' : 'day')}
          >
            {dayView ? (
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 4h10M3 8h10M3 12h10" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <path d="M2.5 6h11M6 6v7.5" />
                <rect x="7.5" y="7.5" width="4.5" height="3" rx=".6" fill="currentColor" stroke="none" />
              </svg>
            )}
          </button>
        )}
        <button className={cx('x', 'refresh', ls?.loading && 'spin')} aria-label="Refresh" title="Refresh (R)" disabled={!!ls?.loading || !!block} onClick={refresh}>
          ↻
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
        ) : skeleton ? (
          <Skeleton round={d.kind === 'github' || (d.kind === 'devops' && ['pending', 'running', 'recent'].includes(d.tab))} />
        ) : (
          entries.length === 0 && (
            <div className="dempty">
              {picked.length ? 'Nothing in the selected repositories.' : d.kind === 'claude' ? 'No Claude Code sessions are running (they show up here while a CLI or VS Code session is open).' : d.kind === 'codex' ? 'No recent Codex activity. Sessions appear here from local activity logs; quiet or closed sessions may remain for up to two days.' : d.kind === 'copilot' ? 'No Copilot sessions are open (CLI, VS Code or JetBrains); ones idle for days are left out.' : d.kind === 'mail' && !s.demo && !s.settings.mailFolders?.length ? 'No folders picked: choose them in Settings → Emails.' : 'Nothing here.'}{!picked.length &&d.kind === 'github' && s.accounts.github?.state === 'connected' && !s.demo && ' If you expected pull requests of an organisation, the token probably cannot see its repositories (repository access, the org’s approval, SSO).'}
            </div>
          )
        )}
        {!skeleton && dayView && (
          <Schedule
            rows={entries.filter((en): en is Row & { at: { start: number; dur: number } } => !!en.at)}
            sel={sel}
            height={listH}
            work={{ start: s.settings.workStart, end: s.settings.workEnd }}
            now={d.tab === 'today' ? s.clock : null}
            onSelect={(i) => act.setDrawerSel(i)}
            onAdd={(i) => entries[i]?.add('next')}
          />
        )}
        {!skeleton && !dayView && entries.map((en, i) => (
          <div
            key={en.id}
            className={cx('drow', i === sel && 'is-sel', en.have && 'have', en.dim && 'dim', en.clash && 'clash', en.now != null && `now-${typeof en.now === 'number' ? 'in' : en.now}`)}
            style={typeof en.now === 'number' ? ({ ['--now' as string]: `${Math.round(en.now * 100)}%` } as React.CSSProperties) : undefined}
            title={en.clash ? 'Double booked: overlaps another meeting' : undefined}
            onClick={() => (act.setDrawerSel(i), more && more !== en.id && setMore(null))}
            onDoubleClick={() => !en.have && en.add('next')}
          >
            {(s.fresh[en.id] || s.fresh[`${d.kind}:${en.id}`]) && <i className="td me" title="New for you" />}
            {en.lead}
            <div className="dmain">
              <div className={cx('dt', en.details && 'one')}>{en.title}</div>
              {en.sub && <div className="ds">{en.sub}</div>}
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
            {en.details && (
              <button className={cx('dmore', more === en.id && 'on')} tabIndex={-1} aria-label="Details" aria-expanded={more === en.id} title="Details (D)" onClick={(e) => (e.stopPropagation(), act.setDrawerSel(i), setMore(more === en.id ? null : en.id))}>
                ▾
              </button>
            )}
            {en.details && more === en.id && (
              <dl className="dpop" role="dialog" aria-label="Details" onClick={(e) => e.stopPropagation()}>
                {en.details.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
      <div className="dfoot">
        <kbd>↑↓</kbd> choose · {tabs.length > 1 && (<><kbd>←→</kbd> tab · </>)}<kbd>⏎</kbd> add to Next · <kbd>R</kbd> refresh · {cur?.details && (<><kbd>D</kbd> details · </>)}{canFilter && (<><kbd>F</kbd> filter · </>)}{d.kind !== 'outlook' && (<><kbd>I</kbd> add to Inbox · </>)}<kbd>Esc</kbd> close{ls?.at ? ` · updated ${relTime(ls.at)}` : ''}
        {d.kind !== 'claude' && d.kind !== 'copilot' && d.kind !== 'codex' && <ReqCount r={s.reqs[d.kind]} />}
      </div>
    </div>
  );
}
