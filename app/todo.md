# yatai app — todo

## Check by hand (couldn't be verified headlessly)

- [ ] ⌘C / ⌘V on list items still copy / paste markdown (macOS routes them through the Edit menu)
- [ ] ⌘Z / ⌘⇧Z with nothing being edited: one undo step, not two (the Edit menu has Undo too)
- [ ] Resize the dock by its left edge: it keeps the new width and snaps back to the right edge, full height
- [ ] Float / large: grab the empty part of the title bar (between the tabs and the icons) to move the window; the 7 px edges and 16 px corners resize it (macOS follows the pointer by hand: check it feels smooth, and that the corner and top edge don't steal clicks from the tabs)
- [ ] Shell icons (↶ ↷ ? ⚙ ⧉ ✕) are larger; the shortcut hint bars at the bottom of Next / Inbox / Organizer are gone (? still lists everything)
- [ ] Float / large: move and resize, quit, relaunch → same place; double-click the title bar → back to default
- [ ] Organizer from the dock jumps to the large window, and back to the dock on ⌘1
- [ ] Focus mode: pill is always on top, grows when the session ends, gives the window back after
- [ ] Idle pill (⧉ cycle): ⤢ / Esc / double-click / ⌘1–3 bring back the layout it came from
- [ ] ⌥Space from another app: capture window pops up, ⏎ lands in the Inbox, Esc / click away hides it
- [ ] ⌥Y: hides when frontmost, brings forward when buried; tray click does the same
- [ ] Tray: inbox count beside the icon, every menu item works, Quit keeps the last edit (edit, ⌘Q right away, relaunch)
- [ ] ✕ and ⌘W hide to the tray instead of quitting
- [ ] Settings: save a key → assistant goes live; Remove → mocked replies; model / effort / base URL are used
- [ ] Release build (`bun run bundle`): key comes from the keychain only, no `.env`
- [ ] Popup windows: ⌘, settings, ? help, ⌘/ AI chat, the three drawers, ⌘⇧D developer panel each open as their own window
  - [ ] beside the dock (left of it), or centered for settings / help; no white flash on first open
  - [ ] Esc, ⌘W and ✕ close them; help also closes when you click elsewhere; the keyboard goes back to the main window
  - [ ] drag a popup by its header; moving the float window takes its popups along (macOS)
  - [ ] typing in the AI chat, accepting with ⌘⏎ from the chat, chips under a reply; drawer ↑↓ ⏎ I
  - [ ] hiding yatai (⌥Y, ✕) hides open popups; showing it brings them back; focus mode puts the drawer away
- [ ] ⌘-click (Ctrl-click) on a PR link or any url opens the system browser; a plain click still just selects the row and never navigates the webview
- [ ] Drawer ↻ (or R) refreshes the list: spinner while it runs, "updated Ns ago" in the footer
- [ ] Context menus fit in the 372 px dock
- [ ] Dark mode carries over to the capture window
- [ ] Developer panel: demo connectors, Load demo data, Start empty, simulated clock → Real time

- [ ] Settings → Database: location shown, "Show" opens the data folder; daily / frequent snapshots appear in the list after "Back up now"; changing a keep-count trims old files at once; a frequent snapshot appears ~15 min after an edit (not after only selecting rows)
- [ ] ⌘E in the Organizer / Next: editor opens in its own window with everything in view as markdown (Next: its items under their tasks); with several items multi-selected ⌘E takes only those (⌘⇧E = everything in view); a new line made in Next lands in Next; ⌘⏎ applies, Esc (twice when edited) cancels; light / dark follow the theme; Tab / ⇧Tab indent; Enter continues the list
- [ ] ⌘E apply: rename one line, change `@est:` / `@due:`, tick `[x]`, add and delete lines, move a block: items that were not touched keep their Next placement, timers and open / closed state; one ⌘Z undoes it all
- [ ] ⌘C of items now includes `@est:` / `@due:`; pasting them back restores both

- [ ] Next: pressing Enter repeatedly on a fresh start gives separate top-level items with separator lines; each drags / moves (⌘↑↓) on its own; indent / outdent still nests
- [ ] Window: the dock can be dragged by the title bar and resized from any edge; it keeps its place; ⧉ toggles docked ↔ full width and each remembers its own position; 📌 keeps the window on top (remembered); no undo / redo buttons in the title bar (⌘Z still works)

- [ ] Settings: one footer (fixed, not scrolling away): edits are held until Save (keys, tokens, model, backup schedule all together); Discard / Esc throws them away; Remove (key / token) and Back up now still act at once

- [ ] Windows: dragging works: items / cards in Next and Organizer (HTML5 drag and drop, needed `dragDropEnabled: false`), and the window by its title bar

## Gaps in what's there

- [ ] Popups: their size / position is not remembered (always placed beside the main window)
- [ ] Popups on Windows / Linux: owned windows do not follow the main one when it moves; Wayland ignores window positions
- [ ] Popups are square-cornered (rounded + see-through needs `macOSPrivateApi`)
- [ ] Context menus could become native menus (Tauri menu API) instead of in-page

- [ ] AI: Stop only stops waiting; cancel the request in Rust (abort handle per request)
- [ ] Dock → large for the Organizer has lost the POC's animation (animate the window size, or accept it)
- [ ] Undo history is memory-only and is cleared at the day rollover
- [ ] Done items stay in Next forever: decide what a new day does with them (archive? hide after N days?)
- [ ] "Start empty" / "Load demo data" can't be undone: confirm first, or take a snapshot first (backups exist now: `backup_now`)
- [ ] Restore a backup from Settings (today: quit, copy the file over yatai.db)
- [ ] Markdown editor: tags are only text in the title (no tag field on items yet); `@today` / recurrence are not in the format
- [ ] Migrate POC data: export from the POC's localStorage → import into the app (maybe a markdown paste is enough)
- [ ] Windows: never run; check frameless resize edges, tray, ⌥ shortcuts, WebView2 differences
- [ ] Linux: tray needs libappindicator; untested
- [ ] Shortcuts that are already taken should be rebindable in Settings, not just reported
- [ ] macOS: decide on the Dock icon (regular app vs menu-bar only / accessory policy)

## Connectors (plan: design/plugins.md)

Plugin system is in (`app/src/plugins/`): Outlook / DevOps / AI sessions run on it with mocked data; GitHub / GitHub Enterprise is live with a personal access token.

- [ ] GitHub, check by hand with a real token
  - [ ] Settings → Accounts: host blank (github.com) + fine-grained token → "Connected as …"; wrong token → toast, nothing kept in the keychain
  - [ ] GitHub Enterprise: host `ghe.example.com`, token for that host → PR links of that host render as PRs, the drawer lists work
  - [ ] paste a PR url into an item and add it to Next: its icon follows the real state (checks, unresolved threads, approved)
  - [ ] push a failing check / leave a comment on a tracked PR: within a minute the item highlights and a toast appears
  - [ ] a bare pasted PR link in Next becomes `url Title` plus the PR description as note lines (typed text is never touched)
  - [ ] a PR the token cannot see says so (toast with GitHub's message) instead of looking closed
  - [ ] drawer tabs: assigned to me / my PRs / mentions show real PRs; ⏎ brings one into Next
  - [ ] revoke the token on GitHub: one toast, polling stops, drawer says "rejected the token"
  - [ ] Remove in Settings clears the keychain entry (Keychain Access → `yatai` / `plugin:github`)
- [ ] GitHub: device flow once a GitHub App client_id exists; issues (links + state); review actions are out of scope
- [ ] **Outlook** (published ICS feed; Graph needs an admin to approve `Calendars.Read` in the work tenant, so it is parked)
  - [ ] Settings → Accounts → Calendar link: paste the ICS link (Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar) → "Connected as <calendar> · N meetings today"
  - [ ] today's meetings (times in your local zone, recurring ones, none of the all-day ones) match Outlook; a meeting brought into Next follows a move (highlight + toast) and a cancellation / removal
  - [ ] Outlook drawer tabs: Today (bring in with ⏎) · Tomorrow · Next 5 days ; double-click / ⏎ on a Tomorrow or later meeting brings it into Next ahead, labelled "Tue 10:00" / "tomorrow", so you can add prep under it; on its day it is a normal card; a move on the calendar is noticed
  - [ ] note the feed lags behind Outlook (it is a published copy): measure how long a change takes to show up
  - [ ] if some recurring meeting is wrong or on the wrong day, send me that VEVENT (without attendees) so the parser can be fixed
  - [ ] Windows: never run yet (see above); the link fetch is plain https from Rust
  - [ ] later, if the admin approves: Microsoft Graph `calendarView` with device code, which is real time (swap `plugins/outlook/index.ts`'s `live`)
- [ ] **Azure DevOps**: work items (mentions, mine, created by me), pipeline runs: replace the mock in `plugins/devops.ts` (PAT first)
- [ ] **AI sessions** (Claude / Copilot): how to detect done / needs feedback: hooks, logs, or APIs?
- [ ] Polling while the window is hidden: it keeps running in the webview at a slower rate (3 min); decide if it needs to move to Rust
- [ ] The tracker only looks at items in Next (and items bound with `smart`); an item in the Organizer shows the last state it had

## Later

- [ ] OS notifications for external changes while the window is hidden
- [ ] Launch at login
- [ ] Code signing + notarization (also stops keychain prompts after every rebuild), auto-update
- [ ] AI v1 for real: inbox filing, breakdown and estimates go through the model instead of the mocks in `mock.ts`
- [ ] AI v2: plan today, history and similarity (embeddings in SQLite), "can I help" handoff
- [ ] Teams messages; active-app awareness (opt-in, privacy first; design.md §9)
