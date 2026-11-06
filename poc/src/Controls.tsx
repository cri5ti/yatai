import { useS, set, resetAll } from './store';
import type { Flags, Layout } from './store';
import {
  addInboxSamples, jumpToNextMeeting, openCapture, setClock, setFlag, setLayout, toggleHidden,
} from './actions';
import { fmt } from './model';

const layouts: { id: Layout; label: string; hint: string }[] = [
  { id: 'dock', label: 'Dock', hint: 'thin sidebar' },
  { id: 'float', label: 'Float', hint: 'medium window' },
  { id: 'max', label: 'Large', hint: 'organizer' },
  { id: 'pill', label: 'Pill', hint: 'always-on-top' },
];

const scenarios: { k: keyof Flags; label: string; group: string }[] = [
  { k: 'prBuildFailing', label: 'PR: build fails', group: 'GitHub PR #482' },
  { k: 'prNewComments', label: 'PR: new comments', group: 'GitHub PR #482' },
  { k: 'prApproved', label: 'PR: approved', group: 'GitHub PR #482' },
  { k: 'pipelineFailed', label: 'Pipeline: deploy failed', group: 'DevOps' },
  { k: 'workItemChanged', label: 'Work item: state changed', group: 'DevOps' },
  { k: 'aiNeedsFeedback', label: 'Claude: needs feedback', group: 'AI sessions' },
  { k: 'aiDone', label: 'Claude: finished', group: 'AI sessions' },
  { k: 'meetingMoved', label: 'Design review moved 14:00 → 11:30', group: 'Outlook' },
];

export function Controls() {
  const s = useS();
  const groups = [...new Set(scenarios.map((x) => x.group))];
  return (
    <aside className="controls">
      <h2>◆ yatai · UX POC</h2>
      <p className="note">Mock desktop + mocked services. State persists in localStorage.</p>

      <section>
        <h3>Window layout</h3>
        <div className="seg">
          {layouts.map((l) => (
            <button key={l.id} className={s.layout === l.id ? 'on' : ''} onClick={() => setLayout(l.id)} title={l.hint}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="btnrow">
          <button onClick={toggleHidden}>{s.hidden ? 'Show window' : 'Hide to tray'}</button>
          <button onClick={openCapture}>Quick capture</button>
        </div>
        <p className="note">
          <kbd>Alt</kbd>+<kbd>1/2/3</kbd> tabs · <kbd>Alt</kbd>+<kbd>Y</kbd> show/hide · <kbd>Alt</kbd>+<kbd>Space</kbd> capture
        </p>
      </section>

      <section>
        <h3>Clock · {fmt(s.clock)}</h3>
        <input type="range" min={7 * 60} max={19 * 60} step={1} value={Math.round(s.clock)} onChange={(e) => setClock(+e.target.value)} />
        <div className="btnrow">
          <button onClick={() => jumpToNextMeeting(10)}>Jump: 10 min before next meeting</button>
        </div>
        <label className="inline">
          Auto-advance
          <select value={s.clockSpeed} onChange={(e) => set(() => ({ clockSpeed: +e.target.value }))}>
            <option value={0}>paused</option>
            <option value={1}>1 min / sec</option>
            <option value={5}>5 min / sec</option>
            <option value={20}>20 min / sec</option>
          </select>
        </label>
      </section>

      <section>
        <h3>Smart-item scenarios</h3>
        {groups.map((g) => (
          <div key={g} className="grp">
            <div className="gl">{g}</div>
            {scenarios
              .filter((x) => x.group === g)
              .map((x) => (
                <label key={x.k} className="check-row">
                  <input type="checkbox" checked={s.flags[x.k]} onChange={(e) => setFlag(x.k, e.target.checked)} />
                  {x.label}
                </label>
              ))}
          </div>
        ))}
      </section>

      <section>
        <h3>Focus &amp; AI</h3>
        <label className="inline">
          Focus timer speed
          <select value={s.focusSpeed} onChange={(e) => set(() => ({ focusSpeed: +e.target.value }))}>
            <option value={1}>real time</option>
            <option value={30}>30× (25 min ≈ 50 s)</option>
            <option value={150}>150× (25 min ≈ 10 s)</option>
          </select>
        </label>
        <label className="inline">
          AI latency {s.aiDelay} ms
          <input type="range" min={0} max={3000} step={100} value={s.aiDelay} onChange={(e) => set(() => ({ aiDelay: +e.target.value }))} />
        </label>
      </section>

      <section>
        <h3>Desktop &amp; data</h3>
        <label className="check-row">
          <input type="checkbox" checked={s.showApps} onChange={(e) => set(() => ({ showApps: e.target.checked }))} /> Show other apps behind
        </label>
        <label className="check-row">
          <input type="checkbox" checked={s.dark} onChange={(e) => set(() => ({ dark: e.target.checked }))} /> Dark mode
        </label>
        <div className="btnrow">
          <button onClick={addInboxSamples}>+ Inbox samples</button>
          <button onClick={() => set(() => ({ inbox: [] }))}>Clear inbox</button>
          <button className="danger" onClick={resetAll}>
            Reset all
          </button>
        </div>
      </section>
    </aside>
  );
}
