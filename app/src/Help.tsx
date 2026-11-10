import { useS } from './store';
import { act } from './act';

const HELP: [string, [string, string][]][] = [
  [
    'Everywhere',
    [
      ['⌥Space', 'Quick capture into the Inbox — from any app'],
      ['⌥Y', 'Show / hide yatai — from any app (or click the tray icon)'],
      ['⌘1 ⌘2 ⌘3', 'Next · Inbox · Organizer (Windows: Alt+1 Alt+2 Alt+3)'],
      ['⌘,', 'Settings (AI, accounts, database backups)'],
      ['⌘E  ·  ⌘⇧E', 'Edit everything in view (Next: its items; Organizer: the tree) as markdown text — or only the items you multi-selected; only what you change is changed'],
      ['↑ ↓ ← →', 'Navigate everything'],
      ['⏎  ·  ⇧⏎', 'Add a new item below · above the selection (⏎ again keeps adding; ⏎ or Esc on a blank field stops)'],
      ['⌘↑ ⌘↓', 'Reorder (animated) — or drag'],
      ['Ctrl+1 … 5  ·  Ctrl+0', 'Quick priority (1 = highest) · the same again or Ctrl+0 clears; a collapsed item shows the highest inside; click the square to pick'],
      ['1 … 5  ·  0', 'Show only priorities up to that one (⌥2 = 1 and 2, with their parents) · show everything'],
      ['⇧← ⇧→', 'Scroll the estimate (5m · 15m · 30m · 1h · 2h · 4h · 8h)'],
      ['/  or right-click', 'Commands: /consolidate /abandon /due /reschedule /tomorrow /estimate /duplicate /ai'],
      ['−  +', 'Collapse / expand everything'],
      ['⌘Z  ⌘⇧Z', 'Undo / redo — every change goes through the undo manager'],
      ['⌘/', 'Ask AI — its changes come back as a purple proposal'],
      ['⌘⏎  ·  ⌘⌫', 'Accept · reject the AI proposal'],
      ['?', 'This sheet'],
    ],
  ],
  [
    'Next',
    [
      ['↑ ↓', 'Move across tasks · → goes into its actions · ← back to the task'],
      ['⇧Space', 'Start / pause the action (on a task: its first action) — stopwatch, moves it to the top'],
      ['F2  or R', 'Edit (⇧⏎ inside the editor for a new line)'],
      ['Space', 'Complete just this item — its children keep their own state'],
      ['↑ / ↓', 'Always the next item you can see — children included'],
      ['⇧↑ ⇧↓ · ⇧click · ⌘click', 'Multi-select, then Space / ⌘[ ⌘] / ⌘↑↓ / ⌫ act on all of them'],
      ['⌘⇧⏎  or F', 'Start in focus mode'],
      ['Space', 'Toggle done (just a marker — nothing disappears)'],
      ['→ / ←', 'On an action: expand / collapse its notes · on a task: expand / collapse the task'],
      ['⌘↑ ⌘↓ on an action', 'Reorder inside the task; past the edge it splits out into its own card'],
      ['Drag a sub-item out', 'Splits it into its own card, its parent repeated as the header — drag it back onto the parent (or /consolidate) to merge'],
      ['E', 'Estimate picker: 1=5m 2=15m 3=30m 4=1h 5=2h 6=4h 8=8h'],
    ],
  ],
  [
    'Organizer · Inbox',
    [
      ['A  N  ⇧N', 'Organizer: add child · sibling · project'],
      ['T', 'Organizer: put in / take out of Next'],
      ['F · A · S', 'Inbox: file into… · accept AI suggestion · suggest (⇧S all)'],
    ],
  ],
];

/** ? — every keyboard shortcut */
export function Help() {
  const s = useS();
  if (!s.help) return null;
  return (
    <div className="ai-veil" onMouseDown={() => act.toggleHelp()}>
      <div
        className="help"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') (e.preventDefault(), e.stopPropagation(), act.toggleHelp());
        }}
      >
        <h3>Keyboard shortcuts</h3>
        {HELP.map(([group, rows]) => (
          <div key={group}>
            <div className="lh">{group}</div>
            {rows.map(([k, d]) => (
              <div key={k} className="hrow">
                <kbd>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
