# yatai app — todo

## Check by hand (couldn't be verified headlessly)

- [ ] Source bar: 4px quota tracks sit only under Claude, Copilot and Codex labels; all sources remain reachable by horizontal scrolling in the narrow dock. Coding harness drawer footer: usage windows have remaining allowance/reset labels; other source footers have no bars; missing and expired readings stay neutral; inspect light/dark themes and keyboard focus.

- [ ] Settings → Sources → Coding harnesses: switch Claude, Copilot and Codex off/on, Save, restart; buttons and polling follow the saved choices.
- [ ] Codex: start and finish a local turn, open its drawer, add a session to Next and observe its status; verify with CLI and desktop logs. Recent idle sessions can remain for two days; activity older than 30 minutes does not prove a running turn.

- [ ] Next: drag rows between cards, split and consolidate, and outdent several sub-items to the top level; undo/redo and reopen the app. Each item should appear once (apart from intentional repeated parent headings on split cards), with no duplicate-key warning or leftover duplicate cards.

- [ ] Plugin drawers: drag the slim top header (including its centre grip) to move the window; resize still works; the top-right ✕ closes it. At narrow widths / larger UI scales, tabs scroll and the close button stays visible. DevOps group-row blank space also drags; tab and toolbar buttons still click normally.

- [ ] Organizer: Delete on a row (with sub-items open) selects the next sibling, else the previous sibling, else the parent; the cursor no longer jumps to the top; ⇧Delete the same
- [ ] Claude / Copilot drawer rows: bold folder name + one line (no wrapping), a ▾ at the right of each row; click it, or D / Space on the selected row → a small popup under the row with Session (full name, scrolls when long), Folder, Where, State, Branch, Id; text in it can be selected; Esc closes the popup (a second Esc closes the drawer); moving the selection or opening another row closes it; the last rows' popups stay readable (scroll the list); light and dark

- Next: the faint "+N" pill on a row with sub-items outside Next (stronger when the selection is on or inside it); click opens the tick list, ticking brings an item in with everything under it, unticking takes it out; Esc / click away closes.
- [ ] Copilot button (bottom bar, ◐): the drawer lists the open Copilot sessions (VS Code, CLI, JetBrains) with the session's own title, folder, where, state and how long; a closed VS Code window or a finished CLI run is gone within ~10 s (or marked ended when it is an item); ⏎ adds one to Next; ask it something → Working…, then a toast `Copilot … finished`; a tool permission prompt (run a command) → amber `Needs you` + toast, answering it → working again; a plain question Copilot asks you in the chat: does it say `Needs you`? (not confirmed: if not, note what the log shows); sessions finished 2+ days ago while VS Code is open are not listed; demo connectors → two made-up sessions

- [ ] Claude button (bottom bar, ✦): the drawer lists the Claude Code sessions running now (VS Code and CLI, all windows) with folder · where · state and how long, those that need you first, then working (spinning), then finished; ⏎ on one adds it to Next (✦ item, state icon and a chip); in that session: ask something and wait → the item says Working…, then a toast `Claude … finished` and a green Finished chip; trigger a permission prompt / a question → amber `Needs you` + toast + highlight; close that window → `Session ended` (a toast only when the item is set to notify); a session closed with the drawer open leaves the list within ~10 s; two items for two windows of the same folder can be told apart by name; demo connectors on → three made-up sessions

- [ ] Updates: after the first release (Actions green, repo public, secrets set), install `yatai_*_x64-setup.exe` from the Release; push a second change to main → ~20 s after the next start (or Settings → Updates → Check now, or tray → Check for updates) the toast says `yatai vX is downloaded`, the tray entry reads `Restart to update to vX`, Settings → Updates has the button; clicking it flushes, shows the installer briefly and yatai comes back at the new version (shown top right of that section); offline → Check now says why, nothing breaks; `bun run app` shows `Off in dev builds`
- [ ] Add to Next on a parent (T in the Organizer, or the menu): the parent itself shows ★ today, and so do the middle levels and open sub-items (not the done ones); after /tomorrow nothing in it says "tomorrow" any more; with only some sub-items in Next the menu says "Add all of it to Next" (T) and "Remove from Next"; T on one that is all in Next takes it all out; several selected → menu Add to Next never takes any out
- [ ] /remind on an item: the submenu shows 1–8 + Custom… (9), 0 clears once set; the row shows `⏰ in 5 min` (Next and Organizer), the menu says `Remind me… (in 5 min)`; when it comes: the item is in Next (also from the Organizer, or after /tomorrow), yellow, a toast `⏰ …`, and a Windows notification when yatai is hidden or behind another window; quit yatai with a reminder due in 1 min, reopen after it → it fires at once; Custom…: type `20m`, `16:30`, `fri 10:00` → the line under shows when, ⏎ sets, nonsense says "Not a time (yet)"; a multi-selection sets them all; undo removes a reminder you set
- [ ] Yellow highlight on a hidden item: it no longer turns the collapsed parent / card yellow, and hovering or moving over the parent does not clear it: the parent shows a tiny yellow circle instead (next to the priority square); expand it → the item itself is yellow, hovering it clears it, and the circle goes with it
- [ ] Turn circles: a collapsed parent (Next row, Next card header, Organizer row) shows a blue circle when something inside is mine to act on (PR to review / answer / fix, failed run, Claude / Copilot session that needs you or finished) and a purple one when only waiting (checks running, session working, my PR in review); title-bar circle button (next to the funnel) cycles everything → blue (actionable) → purple (waiting) → everything, with their parents, in Next and the Organizer, together with the priority filter
- [ ] New to act on: with the GitHub / Calendar drawer closed, a PR that newly asks for my review (or a PR of mine that now needs me) and a meeting newly on today's calendar → toast `GitHub: new for you — …`, a blue dot on the source's button and on the row in the drawer, gone once the drawer has been opened and closed; the first look after install only learns what is there (no toasts); an item that flips to my move toasts `… your move` and goes yellow; GitHub's lists are looked at in the background at most every 5 min (watch the request count)
- [ ] Emails (POC), on Windows with classic Outlook set up: the Emails button opens a drawer whose tabs fill in as the model sorts ("Sorting… N" goes down; no console window flashes); Settings → Emails shows the count and the time of the last read; changing "Unread from the last N days" re-reads at once and older mail leaves the drawer; Settings → Emails → Folders lists the mailbox's folders (indented, unread counts; no shared mailboxes, no Deleted Items / Sync Issues / Junk / Sent), none ticked at first and the drawer says to pick some; ticking a subfolder brings its unread mail in with the folder name on the row, unticking removes it; a renamed folder shows as not found; a mail read in Outlook fades within ~2 min; a new urgent mail toasts and the button shows a red count; ⏎ / I bring one in as `Subject — ✉ Sender`; Ollama stopped → one toast, the mail is still listed under Sorting…; a model that is not pulled → toast says `ollama pull …`; changing the model in Settings sorts everything again; Task Manager shows Ollama at Low (idle) priority while it sorts
- [ ] Emails with Laya (after `app\sidecar\laya\setup.ps1`): Settings → Emails → Sorter: Laya → every mail is sorted again; the first one takes a while (the helper starts and loads the checkpoint), then a few seconds each; rows say `72% · expects a reply`; Task Manager shows the helper's python.exe at Low priority, and it is gone ~10 s after quitting yatai; without the setup → one toast saying to run setup.ps1
- [ ] The drawer button reads "Calendar" (was Outlook); Settings lists Calendar
- [ ] PR colours with a real token (the new GraphQL fields `viewerDidAuthor`, `viewerLatestReviewRequest`, `comments(last: 1) { viewerDidAuthor }` must be accepted, or every PR fetch fails): my PR awaiting review = muted purple; a comment on it I have not answered = deep blue count; after I reply = purple; approved = blue (mine) / purple (theirs); review requested of me = blue; merged green, closed grey (cancelled runs grey too); light and dark. Demo: "My PRs" / "Assigned to me" / "Mentions" show the same split
- [ ] A PR waiting on someone else no longer pins an attention card in Next or toasts a warning
- [ ] Priority filter on / off (1–5, 0) with the selection far down the list: Next and the Organizer scroll it back to the middle of the view
- [ ] AI chat input: ⇧⏎ adds a line, ⏎ sends, pasting several lines keeps them; the box grows to ~6 lines then scrolls, and shrinks back after sending; ↑ on an empty box still goes to the chips; the message shows its line breaks
- [ ] /tomorrow on a parent in Next: the parent and everything under it leave Next at once (no header left behind); next day the parent comes back with the sub-items that were in Next (not the done ones)
- [ ] Quick priority: Ctrl+1–5 in Next / Organizer puts a small coloured square with the digit at the right of the row (red 1 → amber 3 → blue 5; light and dark); same again or Ctrl+0 clears; works on a multi-selection; collapse a parent → it shows the highest (lowest number) inside; a collapsed meeting card's header too; Organizer table view keeps the column aligned; relaunch → kept
- [ ] Priority colours: 1 red → 3 amber → 5 blue, each step tellable apart, white bold digit readable on all five (light and dark)
- [ ] Priority picker: click a square (or the faint one on a hovered row, or /priority) → five squares + ✕ under it; click, digits, ←→ ⏎, Esc; on a multi-selection it sets them all
- [ ] Priority filter: plain 1–5 (2 shows 1 and 2) and the title bar funnel; only matching items and their parents, unfolded, in Next and the Organizer; 0 / same again clears; the funnel shows the active colour; typing digits inside an editor still types
- [ ] Views: ⌘1–3 on macOS as before; on Windows Alt+1–3 (Ctrl+1–3 now sets a priority), also from the popups and the focus pill; the tab tooltips / kbd hints show the right one

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

- [ ] Next, one kind of row: an item whose children are in Next (but not itself) shows as the card's top row, with its path muted in front, and behaves like any row (Space, F2, ⌘↑↓ moves the card, ⌫, / menu has Consolidate and Collapse); Enter on it, or on any open item with children, adds the first child
- [ ] Next drag: drop on a row's top / bottom edge = before / after it, middle = into it (any item, anywhere but into itself); gaps between cards move a top row's whole card, or split a sub-item out; nothing stays see-through after a drop (Next, Organizer, Inbox → Organizer)
- [ ] Bring in from the GitHub / DevOps drawer (⏎): lands under the item picked in Next (or the Organizer's selection), or right after it when that item is itself a PR / work item; with nothing picked, top level

- [ ] Disconnect GitHub (or DevOps): PR / run links show the muted unplugged-plug mark, not a state; connected but not fetched yet: no mark; a PR the token cannot see: amber mark
- [ ] Complete every sub-item of an item (or have GitHub resolve every thread): the item stays open until you tick it yourself; ticking it leaves the sub-items as they are
- [ ] Footer bar: taller, with bigger source buttons (Outlook / GitHub / DevOps); scale and density now sit behind the Aa button (a small pop-over: Esc / click elsewhere closes it) and in Settings → Display (applies at once, also from the settings window); easy to click without grabbing the window's bottom edge or corners (dock and float)
- [ ] DevOps drawer → Pipelines with a real PAT: every running / queued run across the organization, running first; ⏎ brings one in and it then follows the run's state; `requests:` rises by about one per project per refresh
- [ ] Settings → GitHub / DevOps / Outlook: "How to get it" is open while not connected (folded once connected). Links open in the browser with a plain click. Copy puts the command on the clipboard. The placeholders follow the GitHub host and the DevOps organization typed above (until then they stay `<your-org>`). Try `gh auth token` and the `az rest` route for a real token
- [ ] Window snapping on a second monitor with a different display scale (e.g. laptop 150 % + external 100 %): flush on every edge, nothing sticking out; quit and relaunch with the window there → same place
- [ ] Window snapping: drag the window to within 20 px of any screen edge and let go → flush with it (left / right / top / bottom, below the menu bar / above the taskbar); resize an edge close to the screen's → it stretches to it; 21 px away → left alone; the snapped place is what is remembered. Check it does not jump while you are still holding the mouse (it settles 300 ms after the last move)
- [ ] Next / Inbox / Organizer / drawers: the vertical scrollbar is always there (Windows), so rows no longer re-wrap as the list grows or shrinks
- [ ] DevOps drawer with a real PAT (Build: Read + Work Items: Read): Assigned to me / Created by me / Following / Mentions list real work items; ⏎ brings one in as a smart item; changing its state in Azure DevOps shows within a minute (chip + toast). A PAT without Work Items: Read says so in the list
- [ ] Popups remember where you put them: move / resize the GitHub drawer, close it, open it again → same place; the Outlook and DevOps drawers each keep their own place (switch between them with the footer buttons); settings, AI chat, help and the developer panel too; quit and relaunch → still there; unplug the screen it was on → back beside the main window. A drawer never moved still follows the main window
- [ ] Drawers: no title in the header any more (only the tabs, still draggable). DevOps: a first row Builds · Work items, the tabs of that group below (Builds: Pending / Running / Recent, today's last 20 finished; Work items: Assigned to me / Created by me / Following / Mentions); ←→ still walks every tab
- [ ] Drawers: placeholder rows (shimmering, the shape of the real ones) on first opening a tab and while a refresh you asked for (R / ↻) runs; the 30 s background refreshes keep the rows; reduced motion → no shimmer
- [ ] Outlook drawer → Today / Tomorrow: the header's schedule button (or V) plots the day by the hour; 9–18 (or your Settings → Outlook working hours) fills ~80% of the drawer; it opens at the working day's start (today: just before now); overlapping meetings side by side, double bookings in the accent colour, past faded, red now-line; ↑↓ ⏎ and double-click work; resize the drawer → the scale follows; the choice survives a restart
- [ ] Tray icon: purple diamond normally; a highlight anywhere → yellow tile with the purple diamond, back to purple once they are all seen; during a meeting (developer panel clock, or a real one) → blue tile with a white diamond; check it is readable in the macOS menu bar (light and dark) and the Windows tray
- [ ] Next: the meeting in progress has a muted blue card with a blue bar; the Outlook drawer's row for it too
- [ ] Drawers: `requests: N` at the right of the footer, rising as polls run; GitHub also shows the points left (hover: totals and reset time); with 20 PRs in Next it should stay around 60 requests an hour, plus a full fetch only when a PR changes
- [ ] Right-click → Refresh on a PR / run / work item (and on several selected): "Refreshing…", then its state; works for items not in Next too
- [ ] Outlook drawer, Today: time ranges on the left, no second line; red now-line through the meeting in progress (moves with the clock: try the developer panel's clock) or above the next meeting; past meetings faded; two overlapping meetings have an accent bar and time (Tomorrow / Next 5 days too)
- [ ] PR details as sub-items: a PR with unresolved threads gets one sub-item per thread (`@who on file: text`, link on line 2); resolving one on GitHub checks it off within a minute; a failing check adds "Build failed: name — error" with the run link, checked off once it passes; merged → all checked. Real token: the error text is useful (annotations need Checks: read)
- [ ] GitHub: a PR whose checks are queued / running shows the blue "checks running" icon (spinning arc); it is not announced, the result is
- [ ] /notify (row menu: Notify me when it changes) on a PR or run item: 🔔 on the row; every change of state toasts; with yatai hidden or in the background a system notification appears (first time: the OS asks for permission; macOS / Windows); toggling again stops it; survives a restart
- [ ] DevOps drawer → Pipelines (demo connectors): runs with their state icons; ⏎ brings one in; the developer panel's "DevOps pipeline runs" moves it queued → building → failed / done

- [ ] GitHub drawer: funnel icon (or F) opens a filter bar with a repository drop-down: tick several repos (searchable, with counts; ↑↓ ⏎ in the search box), the list narrows to them, Clear / Esc resets; the icon is filled while a filter is on

## Gaps in what's there

- [ ] GitHub: back off on a rate limit (wait for `retry-after` / `resetAt` instead of retrying at the normal interval)
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
- [ ] **Sources** (Settings → Sources): switches and methods
  - [ ] every source has a switch; off: its footer button and Settings page go, it stops polling, its drawer (by shortcut) says it is switched off; on again: all returns
  - [ ] Calendar / Emails / DevOps list their methods; change one and Save: the account is checked again (header: connected / rejected); the Microsoft page exists only while some source is set to Microsoft app registration
  - [ ] **Azure CLI** (DevOps): `az login`, then Settings → Azure DevOps → Check says "✓ signed in"; a pasted run link is tracked with no PAT; `az logout` → within a poll the account says sign-in rejected ("Run `az login` again"); without `az`: "not installed or not on the PATH". Does `az` on this machine satisfy the tenant's conditional access (MFA, device compliance)? Does `cmd /C az` flash a console window?
- [ ] **Microsoft account** (parked until the Entra registration is approved; Settings → Microsoft, shared by the sources set to Microsoft app registration): check by hand
  - [ ] Settings → Sources: Calendar → Microsoft app registration; register the app (guide in Settings), paste the client id (+ tenant), Sign in: the browser opens, you sign in, "Signed in" page, Settings says "✓ signed in as …" and the Calendar drawer shows today's meetings (compare with Outlook; a move shows within a poll, 3 min)
  - [ ] **find out what the tenant says**: consent screen, or "needs admin approval" (AADSTS65001 / 90094), or app registrations are not allowed. If an admin must approve, ask for `Calendars.Read`, `Mail.Read`, `User.Read`
  - [ ] Emails → Microsoft app registration, Sign in for the new permissions: Settings → Emails lists your folders through Graph (no classic Outlook running); tick Inbox → unread mail appears in the drawer and is sorted. Filter / order errors ("InefficientFilter") would show as "Outlook: …"
  - [ ] Azure DevOps → Microsoft app registration: with a DevOps organization set, a pasted run link is tracked without a PAT
  - [ ] set a source back to its other method: it uses the PAT / ICS link / classic Outlook again; Sign out removes the sign-in from the keychain (`yatai` / `entra`, `entra.rt0…`)
  - [ ] leave the app running for over an hour (the access token expires after ~60–90 min): the next poll still works, silently. After a long time off (refresh token ~90 days, or a conditional-access policy) the source says it needs a new sign-in: sign in again in Settings → Microsoft. **Missing: a "sign in again" button** (the Sign in button is disabled while everything is granted)
  - [ ] closing the browser tab before signing in: the settings spinner times out after 3 minutes
- [ ] **Outlook** (published ICS feed; Graph needs an admin to approve `Calendars.Read` in the work tenant, so it is parked)
  - [ ] Settings → Accounts → Calendar link: paste the ICS link (Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar) → "Connected as <calendar> · N meetings today"
  - [ ] today's meetings (times in your local zone, recurring ones, none of the all-day ones) match Outlook; a meeting brought into Next follows a move (highlight + toast) and a cancellation / removal
  - [ ] Outlook drawer tabs: Today (bring in with ⏎) · Tomorrow · Next 5 days ; double-click / ⏎ on a Tomorrow or later meeting brings it into Next ahead, labelled "Tue 10:00" / "tomorrow", so you can add prep under it; on its day it is a normal card; a move on the calendar is noticed
  - [ ] note the feed lags behind Outlook (it is a published copy): measure how long a change takes to show up
  - [ ] if some recurring meeting is wrong or on the wrong day, send me that VEVENT (without attendees) so the parser can be fixed
  - [ ] Windows: never run yet (see above); the link fetch is plain https from Rust
  - [ ] later, if the admin approves: Microsoft Graph `calendarView` with device code, which is real time (swap `plugins/outlook/index.ts`'s `live`)
- [ ] **Azure DevOps**, check by hand with a real PAT (Build: Read)
  - [ ] Settings → DevOps: organization `dev.azure.com/<org>` + PAT → "Connected as …"; a wrong PAT → "token rejected", nothing kept
  - [ ] paste a run link (`…/_build/results?buildId=N`) into an item in Next: it shows `◇ pipeline #N` with queued / building (spinning) / failed / done; queue a new run and watch it move (polled every 30 s)
  - [ ] a run that fails: toast + highlight; one that finishes: "…: done" toast; queued → building is quiet unless the item notifies
  - [ ] a run link of another organization says it can't be seen
- [ ] Azure DevOps: work items and the drawer lists over REST (`_apis/wit/wiql`, `workitemsbatch`, recent builds); the drawer shows the mocked tabs only with the demo connectors
- [ ] **Emails** (POC: classic Outlook through COM + an Ollama model)
  - [ ] **Review: keep Ollama or drop it?** Laya (decision model, no LLM) is wired in as a sorter; Ollama (qwen3) stays the default until Laya is trained, and stays behind Settings → Emails → Sorter for comparison. Once Laya has run on real mail for a while: compare the buckets (Sort all again with each), and if Laya is good enough, remove the Ollama path (`classifyOllama` in `plugins/mail/classify.ts`, `src-tauri/src/llm.rs` with its idle-priority code, the `mailModel` setting, the Ollama rows in Settings and the docs). If it is not, decide between training Laya on labelled mail and keeping qwen3
  - [ ] **Laya needs training before it can be the default** (untrained it agreed with qwen3 on 8–13 of 38 mails; design/plugins.md): label a few hundred mails (qwen3's buckets as a first pass, corrected by hand, plus corrections made in the drawer), fine-tune / temperature-fit a checkpoint on them, point the helper at it, then make Laya the default sorter. Keep a low-confidence mail out of Urgent
  - [ ] hook the buckets into tasks: Urgent / Today straight into Next or the Inbox? Dismiss → archive in Outlook (a write)?
  - [ ] new Outlook (olk) has no COM: Graph `Mail.Read` through Settings → Microsoft is now the way out (check by hand above); remove COM (`mail.rs`, `mail.ps1`) once it has proved itself. Classic Outlook can run out of MAPI resources ("Outlook has exhausted all shared resources"), which is one more reason
  - [ ] a better prompt / model (comparison in design/plugins.md: qwen3 4B instruct beats llama3.2); learn from corrections (moving a mail to another bucket)
  - [ ] the 45 s sorting budget per cycle delays the drawer's other lists while it runs
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
