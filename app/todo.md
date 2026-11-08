# yatai app — todo

## Check by hand (couldn't be verified headlessly)

- [ ] ⌘C / ⌘V on list items still copy / paste markdown (macOS routes them through the Edit menu)
- [ ] ⌘Z / ⌘⇧Z with nothing being edited: one undo step, not two (the Edit menu has Undo too)
- [ ] Resize the dock by its left edge: it keeps the new width and snaps back to the right edge, full height
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
- [ ] Context menus fit in the 372 px dock
- [ ] Dark mode carries over to the capture window
- [ ] Developer panel: demo connectors, Load demo data, Start empty, simulated clock → Real time

## Gaps in what's there

- [ ] Popups: their size / position is not remembered (always placed beside the main window)
- [ ] Popups on Windows / Linux: owned windows do not follow the main one when it moves; Wayland ignores window positions
- [ ] Popups are square-cornered (rounded + see-through needs `macOSPrivateApi`)
- [ ] Context menus could become native menus (Tauri menu API) instead of in-page

- [ ] AI: Stop only stops waiting; cancel the request in Rust (abort handle per request)
- [ ] Dock → large for the Organizer has lost the POC's animation (animate the window size, or accept it)
- [ ] Undo history is memory-only and is cleared at the day rollover
- [ ] Done items stay in Next forever: decide what a new day does with them (archive? hide after N days?)
- [ ] "Start empty" / "Load demo data" can't be undone: confirm first, or back up the db
- [ ] Migrate POC data: export from the POC's localStorage → import into the app (maybe a markdown paste is enough)
- [ ] Windows: never run; check frameless resize edges, tray, ⌥ shortcuts, WebView2 differences
- [ ] Linux: tray needs libappindicator; untested
- [ ] Shortcuts that are already taken should be rebindable in Settings, not just reported
- [ ] macOS: decide on the Dock icon (regular app vs menu-bar only / accessory policy)

## Next: connectors (design.md §4, §10; plan in spec/design/plugins.md)

- [ ] **Plugin system first** (plugins.md §11): core + mocked Outlook / DevOps / GitHub on it, then the Rust http/secrets host, then GitHub live

- [ ] **GitHub** (first: pasted PR links already render as PRs)
  - [ ] auth: device flow or a token in the keychain (or reuse `gh auth token`)
  - [ ] poll each linked PR: state, checks, unresolved review threads → `prs` / `prc`, highlight + toast on change
  - [ ] drawer tabs from the API: assigned to me, my PRs, mentions
- [ ] **Outlook calendar** via Microsoft Graph (read-only `Calendars.Read`)
  - [ ] find out whether an app registration is possible in the work tenant, or device-code is needed
  - [ ] today's events → the Outlook drawer; moved / cancelled meetings highlight
- [ ] **Azure DevOps**: work items (mentions, mine, created by me), pipeline runs
- [ ] **AI sessions** (Claude / Copilot): how to detect done / needs feedback — hooks, logs, or APIs?
- [ ] Polling while the window is hidden: it keeps running in the webview; decide if it needs to move to Rust

## Later

- [ ] OS notifications for external changes while the window is hidden
- [ ] Launch at login
- [ ] Code signing + notarization (also stops keychain prompts after every rebuild), auto-update
- [ ] AI v1 for real: inbox filing, breakdown and estimates go through the model instead of the mocks in `mock.ts`
- [ ] AI v2: plan today, history and similarity (embeddings in SQLite), "can I help" handoff
- [ ] Teams messages; active-app awareness (opt-in, privacy first; design.md §9)
