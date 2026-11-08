# yatai — UX concepts

Cross-cutting interaction ideas that apply to every view. Concrete screens live in [design/design.md](design/design.md); this file records the *principles* so new features behave consistently.

## 1. Highlights: surfacing changes the user didn't make

**Principle.** If something changes somewhere the user might not be looking, mark it **yellow** so it can be found, and keep it marked until the user has actually *seen* it.

**Why.** The app is a thin window that is usually glanced at, not stared at. A toast disappears after a few seconds; a status that flipped while you were in another app, or an item that popped back into a collapsed card, would otherwise be missed. The highlight is the durable half of the pair: *toast = "something happened", highlight = "here is where"*.

### What triggers one

A highlight is added when a change did not come from a deliberate edit the user made *to that very thing*:

| Source | What is highlighted |
|---|---|
| External status change (GitHub PR changed state or unresolved-comment count, pipeline failed, work item moved, AI session needs feedback / finished) | The item(s) bound to it |
| Calendar change (a meeting moved) | The meeting card |
| **Undo / redo that brings an item back** | The items that reappeared |
| AI that adds or reorganises things (plan today, break down — the mocked one-shot actions) | The items it added |

**Undo is the odd one out, on purpose.** It *is* a user action, but its effect lands somewhere the user is probably not looking — the restored item may sit in another card, a collapsed parent, or another tab. It contradicts "only changes the user didn't make", yet the reasoning is the same: the change shows up away from the user's attention, so it gets marked.

What does **not** highlight: anything the user did directly to the thing in front of them (typing, completing, reordering, indenting, deleting, bringing something in from a drawer), and slow, expected drift such as the clock moving a meeting up the list.

### How it behaves

- **Colour:** a yellow wash with a darker yellow bar on the inside-left edge (`--hl`, `--hl-bar`). Yellow is reserved for this; status colours elsewhere (GitHub blue/orange/red/green/purple, etc.) avoid it.
- **Dismissal: attention, not time.** A highlight is cleared when the user *puts their attention on it*, which means either
  - **the mouse pointer moves over it**, or
  - **the keyboard cursor (selection) moves onto it**.

  Neither clicking elsewhere, nor time passing, nor the cursor merely *resting* where the change lands counts: the pointer has to move over it / the selection has to move onto it, so a highlight can't vanish before it was noticed. Highlights are saved with the rest of the state, so they survive a restart until seen.
- **Hidden things still show.** If the changed item is inside a collapsed card or a collapsed parent, the *collapsed container* is highlighted instead. Hovering it or moving the cursor onto it counts as having seen the change and clears the highlights beneath it.
- **Not part of undo.** Highlights are attention state, not data: undoing never "un-highlights", and dismissing one never creates an undo step.
- **Several at once is fine.** Each is independent; there is no "clear all" — if there is a lot to catch up on, the highlights are the to-do list for your eyes.

### Implementation notes (POC)

- State: `hl: Record<itemOrMeetingId, true>`; `highlight(ids)` / `dismissHl(ids)` in `actions.ts`.
- Rendered in Next (row, collapsed card header, meeting card) and Organizer (row, collapsed parent) via the `.hl` class. Pointer dismissal is `mousemove` on the element; keyboard dismissal is an effect on selection change (`hlForRow` / `hlForCard` decide what an element stands for).
- The mock bar's *GitHub pull requests* section and the smart-item scenarios exercise the external triggers.

## 2. Links to external things render as what they are

A URL that identifies a thing the app understands is shown as a compact reference, not a raw link.

- **GitHub pull request** (`https://github.com/<org>/<repo>/pull/<n>`, also `/pulls/<n>`): shown as **`[mark] repo#n [state]`**. The org and full URL are in the tooltip and the link target.
- **The mark is part of the text flow.** The GitHub mark is an inline-block that belongs to the same no-wrap group as `repo#n` and its state, so a long title wraps *after* the reference rather than leaving the icon alone on a line.
- **State is an icon, not a word.** One small filled disc per state in GitHub's colours with the glyph knocked out in the background colour: `draft` dashed ring (dark grey) · `to review` ring with dot (blue) · `build fails` ✕ (red) · `ready` ✓ (green) · `merged` merge graph (purple) · `closed` slashed ring (dark red; the link is also struck through). The words live in the tooltip / accessible name.
- **`has feedback` is a count.** Instead of an icon, an orange pill shows the number of *unresolved comments*. A change in that number is an external change and raises a highlight (§1).
- A PR status never moves the item: it stays where the user put it. A status *change* raises a highlight (§1) instead.
- Anywhere a link cannot be rendered (window titles, toasts, menus, the focus pill) it degrades to plain `repo#n`.
- In the POC the status is simulated from the mock bar; in the product it comes from the GitHub connector (see design.md §4).

## 3. Source drawers: bring things in on demand

External systems are not mirrored wholesale into yatai. Each has a **drawer** — a small pop-up that rises from a thin strip at the bottom of the window — where you browse what exists and pull in only what you want to track.

| Drawer | Tabs | Brings in |
|---|---|---|
| **Outlook** | Today's agenda | A meeting card (with its fixed calendar row) |
| **GitHub** | Assigned to me · My PRs · Mentions | An item whose text is the PR link (rendered per §2) |
| **DevOps** | Mentions · My work items · Created by me | A work-item (smart) item |

- **Add to Next** (⏎) or, for GitHub and DevOps, **to the Inbox** (I) to triage later. Things already in yatai show "✓ in yatai" and can't be added twice.
- Keyboard-first like everything else: ↑↓ choose, ←→ switch tab, Esc closes and returns focus to the list.
- **Meetings can be deleted** from yatai (Delete on the card or its calendar row, or `/delete`) — that only removes it from yatai, never from Outlook. The Outlook drawer is how you bring it back. Only the meeting is removed: items you had added *inside* it (prep) are kept and move to the top level of Next. Undo restores the meeting and its nesting.
- A drawer pull-in is something the user chose, so it is not highlighted (§1).

## 4. Window: resizable, and views that grow with it

- **Resize** by dragging any edge or corner (the dock only has its left edge); **move** a floating / maximised window by its title bar. Double-click an edge or the title bar to reset. Each layout remembers its own size.
- **Views respond to width, not to a mode.** Cards flow into columns, the Organizer grows table columns, and the **Inbox shows the Organizer beside it** once there is room: drag inbox items (several at once) onto a row to file them under it, between rows to file them as siblings, or onto empty space for top level.

## 5. Inbox is the same editor as Next

Enter adds below, ⇧Enter above (inline editor, chaining), F2 edits, multi-line markdown, ⇧↑↓ / ⌘click multi-select, ⌘↑↓ reorder. No separate capture field.

## 6. Copy / paste as markdown

⌘C copies the selected items (or the one under the cursor) as a nested markdown list with their sub-items; ⌘V pastes that format back into the structure, in any view.

    - [ ] Write the spec
      extra title lines are indented
      - [x] A finished sub-item      ([-] = dropped)

- **Next / Organizer:** pasted below the selected item as siblings (on a card header: into that card). In Next they are also put in Next. One undo removes the whole paste.
- **Inbox:** one entry per top-level item; its sub-items travel as a bullet list inside the entry.
- Plain lines and `*` / `+` / `1.` bullets paste too (one item per line).

## 7. Top-level items have no group

Anything can sit at the top level. In Next, top-level items are just rows with no card header (there is no "Items" group), aligned to the left edge. There are no empty "new card" shells either: Enter / ⇧Enter on a card header add the first item *inside* that card, and a new item with nothing to anchor to is a plain top-level row. Indent / outdent therefore always have a neighbour to work with.

## 8. Removing things

- **In Next, ⌫ takes items out of Next** (with everything beneath them); they stay in the Organizer. **⇧⌫ deletes them completely.** In the Organizer ⌫ always deletes. Both are undoable. Meetings are the exception: ⌫ removes them from yatai (they come back from the Outlook drawer).
- **Toggling a parent into / out of Next acts on the whole hierarchy**, parent included.
- **Indent follows what you see.** ⌘] in Next nests under the row displayed directly above, even after rows were moved around; outdenting keeps the item where it was on screen.

## 9. Splitting sub-items out of their parent

- **Any row can be dragged in Next**, sub-items included. Dropping a sub-item outside its card (before / after another card, or beside its own) gives it a card of its own whose header is its parent — **the parent repeats** there, with the split marker (⑂ 2/2); the parent row stays where it was and simply no longer shows that sub-item.
- **Moving it back consolidates.** Dropping it onto its parent row, or between its siblings nested there, puts it back in the group (and closes the split). `/consolidate` on the pulled card does the same; on the parent's card it also brings back every sub-item pulled out of its rows.
- Dropping a sub-item between its siblings (nested, same parent) reorders them in the tree.
- Implementation: a plan segment with `pulled: true` may list sub-items of a Next row; they are then left out when their parent row expands.

## 10. Collapse / expand all

`−` collapses everything, `+` (or `=`) expands everything — in Next (cards, rows with sub-items; collapsing also folds open notes) and in the Organizer (every item with children).

## 11. AI proposals: purple until you decide

**Principle.** The AI never changes your data directly. Whatever it wants to change is shown in place, **purple**, until you **accept** (⌘⏎) or **reject** (⌘⌫) it as a whole.

- **Purple = proposed** (`--ai`, `--ai-soft`), the counterpart of yellow = changed by someone else (§1). New items carry a small `NEW` chip, removed ones are struck through, changed fields (title, estimate — with the old value struck beside it — due, status, being in Next) are tinted. A collapsed card or parent with proposed changes inside is purple too.
- **The views show the result.** Next and the Organizer render the document as the proposal would leave it, so you judge the outcome, not a diff.
- **Accept is one undo step** (⌘Z takes it all back). Reject discards it; nothing was ever changed. Accepted changes are not highlighted yellow — you just reviewed them.
- **While a proposal is pending, other edits are refused** (with a toast) — decide first. Navigation, collapsing and the chat keep working: you can keep talking to refine the proposal; new changes add to it.
- **The conversation docks** bottom-left without a scrim while a proposal is pending, so the purple stays visible. Closing it keeps both the proposal (a bar at the bottom of the window: Chat · Reject · Accept) and the conversation.
- **Clickable next steps.** Every answer ends with 2–4 follow-ups the AI suggests ("Revise the Vitest estimate", "Break down Extract staff"), shown as chips above the input; clicking one sends it. Before the first message the chips are openers (about the selected item when there is one). Keyboard: ↑ from the empty input onto the chips, ←→ between them, ⏎ sends, ↓ / Esc back to the input. The model returns `{reply, suggestions}` as structured output, so they are always there.
- **Tools the AI has:** `get_today_items` (meetings and every item in Next), `get_item` (one item with its notes and whole sub-tree), `search_items`, `patch_items` (some keys of one or more items: title, est, due, status, today) and `set_sub_items` (an item's complete list of sub-items, nested: keep by id, add without, omit to remove). Read tools see the document as proposed so far.
- **Configuration (POC):** `OPENAI_API_KEY` (and optional `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_BASE_URL`) in `poc/.env`. Calls go to the Responses API (`/v1/responses`) with `store: false`: the conversation, encrypted reasoning included, is kept in the app and resent each turn. The Vite dev server proxies `/api/openai` and adds the key, so it never reaches the browser. Without a key the old mocked replies are used.


## 12. Picking a date

`/due` → **Pick a date…** (`5`) turns the menu into a calendar in place, no separate dialog. ←→ day, ↑↓ week, PgUp/PgDn (or ⇧↑↓) month, Home today, ⏎ picks, Esc / ⌫ goes back to the list; clicking a day picks it. Typing jumps straight to a date: `fri` (the next one), `+3`, `+2w`, `+1m`, `tom`, `20` (the next 20th), `nov 20`, `20/11` (in the locale's day/month order), `2026-12-01`. It opens on the current due date (marked with a dot); today is outlined.
