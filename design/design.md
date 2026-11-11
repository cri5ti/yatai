# yatai — design

Yet Another Todo App, but with AI. A very lightweight desktop app whose default state is a thin window showing what to do next, today.

Start here for context. Related documents:

| Document | What it covers |
|---|---|
| [interaction.md](interaction.md) | the rules every view follows: keyboard model, items, starting, commands |
| [ux.md](ux.md) | cross-cutting UX principles: highlights, links as references, drawers, AI proposals |
| [plugins.md](plugins.md) | external sources (GitHub, Outlook calendar and mail, Azure DevOps, more later): the plugin system |
| [../app/todo.md](../app/todo.md) | what is built, what is left, what needs checking by hand |

## 1. Goals and non-goals

**Goals**
- Lightweight: small footprint, instant launch, usable as an always-open thin window.
- The 80% case is **Next**: what to do next, and nothing else.
- Capture is frictionless (Inbox); organising can happen later, with AI help.
- Things that live elsewhere (PRs, pipelines, work items, AI sessions, meetings) are tracked automatically and surface when they need attention.
- Keyboard-first.
- Local-first: all data in SQLite on the user's machine.

**Non-goals (for now)**
- Multi-user collaboration, or cloud sync of the yatai database.
- Mobile apps.
- Writing back to external systems (read-only sources).
- Active-app / screen monitoring (privacy-sensitive, see §8).

## 2. Concepts

| Concept | Description |
|---|---|
| **Item** | The one building block. A *project* has tasks, a *task* has actions, an *action* is the smallest bit of work doable in one sitting. All are items in a tree of any depth; "task" just means "has children". |
| **Next** | The plan for today: an ordered list of cards (a task or a meeting, with the actions of it scheduled today). |
| **Inbox item** | Unstructured captured text, not yet filed into the tree. |
| **Meeting** | A calendar entry in the plan at its time; it can hold items (prep) and carries a fixed calendar row. |
| **Smart item** | An item bound to something external whose status is monitored (a PR, a work item, a pipeline run, an AI session). |
| **Focus session** | A timed block on one action. |

Metadata kept automatically: created, last modified, last run (last started), scheduled for, time spent.

## 3. Views and windows

- **Next** (default): thin window, vertical list of cards. Ordering: meetings by time (rising as they approach), then the user's order; smart items needing attention are promoted. Status chips on smart items ("build failed", "2 unresolved comments").
- **Organizer**: the whole tree; expand / collapse, reorder, reparent, metadata columns (created, modified, last run, scheduled, estimate, due).
- **Inbox**: a quick-capture list (global hotkey from any app), triaged by dragging into the tree or accepting an AI suggestion. When the window is wide it shows the Organizer beside it.
- **Focus**: hides everything but the current action and a timer.
- **Layouts**: *dock* (right edge, full height), *float*, *large*, *pill* (small always-on-top). Each remembers its size. Settings, help, the AI chat, the source drawers and the developer panel open as their own small windows.

## 4. Sources (smart items, meetings)

External systems are not mirrored into yatai. **Plugins** (GitHub, Outlook, Azure DevOps, later Jira / Teams / AI sessions) recognise links, report the live state of what is in Next, list what is browsable in a drawer, and supply calendar agendas. Changes become highlights and toasts. Details, auth and security: [plugins.md](plugins.md).

## 5. AI

All AI calls go through one service so the provider and model are swappable. Context sent is minimal and user-visible.

- **Inbox organisation**: suggest where each captured item belongs.
- **Plan today**: propose and order Next from meetings, due dates, estimates and history.
- **Estimates and breakdown**: estimate effort; split a task into actions.
- **Help**: flag items the AI could do or help with.
- **History**: "you did something like this before" (embeddings in SQLite, later).

AI is always a suggestion, never a silent change: proposals are shown in place and accepted or rejected as a whole ([ux.md](ux.md) §11).

## 6. Architecture

```
┌────────────────────────── Desktop shell (Tauri 2, Rust) ──────────────────────────┐
│  windows · tray · global hotkeys · keychain · SQLite · http for plugins · AI call  │
├────────────────────────────────────────────────────────────────────────────────────┤
│  UI (TypeScript, Vite, React)                                                      │
│   Next · Inbox · Organizer · Focus · drawers · popups                              │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Core (TS): store + undo, actions, plan model, command menu, AI service            │
│  Plugins (TS): tracker (poll loop, change detection) · github · outlook · devops · mail  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **Stack:** Tauri 2 + Vite + React + TypeScript, Bun as package manager. Nearly all logic is TypeScript; Rust is for the shell and for anything that holds a secret.
- **State:** one immutable store; every data change goes through `commit` (undo/redo). The main window owns the state; popup windows get a copy and send actions back by name.
- **Persistence:** SQLite; only changed rows are written, shortly after a change, and flushed on hide / quit. UI preferences are one JSON value. Rust keeps snapshots of the file (`VACUUM INTO`, in `backups/` beside it): one per day and one every N minutes if the document changed, each kind with its own keep-count, set in Settings → Database. The browser build (used for development and headless checks) uses localStorage.
- **Secrets:** tokens and API keys live in the OS keychain and are attached to requests in Rust; the page never reads them back.
- **Polling:** a loop in the main window asks each plugin about what is in Next (see [plugins.md](plugins.md)); there is no push channel to a desktop app.

## 7. Data model (as built)

```
item(id, ord, parent_id, title, status, today, open, created, modified, last_run,
     scheduled, est, due, later, spent, smart)        -- the one tree
inbox(id, ord, text, created, suggestion)
meeting(id, ord, day, title, start, moved_to, duration_min, location, open)
plan_seg(id, ord, owner, items, keep, pulled)         -- Next's cards, in order
kv(key, value)                                        -- UI preferences, last snapshots, calendar agenda
```

- `status`: `todo | doing | waiting | done | dropped`; `waiting` is the typical state of a smart item.
- Schema changes are migrations in `app/src-tauri/src/db.rs` (`PRAGMA user_version`).
- External state is not a table of its own: the last snapshot per tracked thing is kept with the UI state.

## 8. Privacy and security

- Data stays local; the only outbound traffic is the plugins' APIs and the AI calls the user enabled.
- Read-only access to external systems, with the narrowest token that works.
- AI payloads are minimal; the key is in the keychain.
- **Active-app monitoring** (detect context switches) is deferred. If built: opt-in, only app-name / time buckets stored locally, never window titles sent to an AI.

## 9. Repository

```
design/   these documents
app/      the desktop app (see app/README.md); app/todo.md is the backlog
poc/      the React UX prototype: frozen, the UX playground the app was built from
```

## 10. Status and roadmap

Built: the desktop app with all views, SQLite, tray, global hotkeys, popup windows, undo, the AI assistant (OpenAI-compatible), and the plugin system with GitHub / GitHub Enterprise (live, token), Outlook (live through the published calendar feed) and Azure DevOps / AI sessions (mocked).

Releases: every push to `main` that touches `app/` builds on GitHub Actions and publishes a signed Windows installer as a GitHub Release (version `<major>.<minor>.<run number>`). Installed copies check the latest release a few seconds after start and every few hours, download in the background, and offer "Restart to update" (toast, tray menu, Settings → Updates).

Next, roughly in order: real Azure DevOps; Outlook via Microsoft Graph where a tenant allows it (real-time); AI v2 (plan today, history and similarity, "can I help" handoff); AI-session monitoring; Teams messages; OS notifications while hidden; launch at login; Windows and Linux hardening (the app has mostly been run on macOS).

## 11. Open questions

- Does background polling need to run while the window is hidden or closed (tray-resident), and should the loop move to Rust?
- AI-session state: Claude Code is solved by reading its own per-session files (plugins.md, Claude sessions); Copilot CLI is still open (its session folder under `~/.copilot`, or hooks).
- Embedding source for history: local model or API.
- Next: how much is auto-ordered and how much is pinned by the user?
