# yatai — interaction model

How yatai is meant to feel to use. This is the part of the original idea notes and the POC that is not a screen or a data structure: the rules every view follows. Screens and status rules are in [design.md](design.md) and [ux.md](ux.md). If a view behaves differently from what is written here, that is a bug in the view.

## 1. Principles

- **Keyboard first.** Everything reachable by arrows with a clear focus ring, and every action has a reasonable shortcut. The mouse is a convenience, never a requirement.
- **Create on the spot.** In every list you can add a new item in place (⏎ below, ⇧⏎ above, ⌘⏎ new). ⏎ or Esc in a blank new field cancels the creation.
- **Everything is undoable.** Every data change goes through one undo/redo manager (⌘Z / ⌘⇧Z). Purely visual state (selection, collapsed, highlights) is not part of undo.
- **Nothing disappears silently.** Done is only a visual marker; finished items stay where they are. Removing from Next keeps the item in the Organizer. Deleting is explicit and undoable.
- **Calm window.** No logo, thin chrome, tabs at the top (⌘1 Next, ⌘2 Inbox, ⌘3 Organizer; Alt+1–3 on Windows, where Ctrl+digit sets the priority). One consistent set of design tokens (`app/src/tokens.css` is the only place raw colours, sizes and durations live).
- **Motion explains, never decorates.** Reordering animates (FLIP) so you can follow what moved; starting an action expands its text with a short animation.

## 2. Items

- **One kind of thing.** Project, task and action are all *items*; "task" just means "has children". An action is a leaf. Items nest to any depth.
- **Multi-line text.** Only the first line is the headline; lines 2+ are notes in a smaller font. Basic markdown is supported in notes and titles: bold, italic, links, lists, checkboxes. A link to something yatai understands (a GitHub PR) renders as a compact reference.
- **Quick priority.** Ctrl+1–5 on the selection (Next, Organizer; the real Ctrl key, on macOS too) sets a priority, 1 the highest; the same again, or Ctrl+0, clears it. It shows as a small coloured square with a light bold digit on the right of the row, on a three-point ramp (red 1 → amber 3 → blue 5). A collapsed item shows the highest priority found inside it. With the mouse: click the square (a faint one appears on hover when there is none), or `/priority`, for a little 1–5 picker. Copy / ⌘E carry it as `@p:N`.
- **Priority filter.** Plain 1–5 (or the funnel in the title bar) shows only the items of that priority or higher and their parents (⌥2 = priorities 1 and 2), unfolded, in Next and the Organizer; 0 or the same key again shows everything.
- **Estimates and due dates.** In the E menu, estimate with 1=5 min, 2=15 min, 3=30 min, 4=1 h, 5=2 h, 6=4 h, 8=8 h, 0=none; ⇧←/→ steps through them. Due dates come from `/due` (with a date picker that also understands `fri`, `+3`, `tom`, `nov 20`).
- **Reminders.** `/remind` comes back to an item later (waiting on something): 1–6 = in 5 min / 15 min / 30 min / 1 h / 2 h / 4 h, 7 = tomorrow and 8 = next Monday (at the start of the working day), 9 = a typed time, 0 clears. The item does not move meanwhile; it shows `⏰ in 25 min` (or `14:30`, `Mon 09:00`). When the time comes it is brought into Next, gets the yellow highlight and a toast, and a system notification unless yatai is in front. One that came while yatai was closed fires when it opens; a done item just loses its reminder.
- **Meetings are items too.** They sit in the plan at their time, can be moved and can hold items inside (typically "prep"). They carry one fixed, uneditable calendar row. Removing a meeting only removes it from yatai.

## 3. Navigating and editing

- **↑↓** move between rows. **→** goes into an item (expands its note / sub-items), **←** goes back out and collapses. A whole task can be collapsed; `−` / `+` collapse or expand everything.
- **⏎** on an action starts it; on a task starts its first action. **⇧Space** starts or pauses; **Space** toggles done (only the item itself: finishing every sub-item never completes the parent, you do); **⌘⏎** starts in focus mode.
- **F2** edits in place. **⌘[ / ⌘]** outdent / indent. **⌘↑ / ⌘↓** reorder (or drag). **⇧↑ / ⇧↓** multi-select. **⌘C / ⌘V** copy and paste as a markdown list.
- **⌘/** opens the AI chat. **?** lists every shortcut.

## 4. Starting, the stack and the schedule

- **Starting an action** moves it (and its task) to the top of the stack and shows a running stopwatch; it is the "current" item. Finishing asks what next.
- **Next is a plan, not a query.** It is an ordered list of cards; a card is a task (or a meeting) and the actions of it that are scheduled for today. Order is the user's, except that meetings rise to the top as their time approaches and smart items needing attention are promoted. **Add to Next** (T, or the menu) on a parent puts the parent itself and everything open under it in Next, and clears any "tomorrow" in it; T on something that is all in Next takes the whole hierarchy out. When only part of it is in Next, the menu offers both (*Add all of it to Next* on T, and *Remove from Next*).
- **Splitting the schedule.** Dragging an action into the gap between cards (dropping it on a row moves it in the tree instead) splits the task across the plan: same task, its actions in different places, a small marker (⑂ 2/2) on each part. `/consolidate` brings them back together.

## 5. Context menu and commands

A right-click menu at every level lists the actions that apply there. The same menu opens with **/**, with an input box that filters as you type, so everything is also a typed command: `/due`, `/tomorrow`, `/reschedule`, `/estimate`, `/plan` and `/unplan` (in / out of Next), `/duplicate`, `/consolidate` ("Consolidate all your actions here"), `/abandon`, `/delete`, `/ai`, `/breakdown`. The menu is the discoverability surface for features that do not deserve a dedicated key.

## 6. Focus mode

Hides everything except the current action and a timer (a small always-on-top pill). At the end: done / not done / +15 min, and a short list of what to do next, which is useful when switching context. Time spent feeds the item's stopwatch total and, later, AI estimates.

## 7. AI

A small chat popup (⌘/) and one-shot commands. The AI only ever *proposes*: changes are shown in place and accepted or rejected as a whole (see [ux.md](ux.md) §11). Provider and model are configurable; the API key never enters the page.
