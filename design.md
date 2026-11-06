# yatai — Design

Yet Another Todo App, but with AI. A very lightweight desktop app whose default state is a thin window showing what to do next, today.

## 1. Goals and non-goals

**Goals**
- Lightweight: small footprint, instant launch, usable as an always-open thin window.
- The 80% case is the **Today view**: what's next, nothing else.
- Capture is frictionless (Inbox); organization can happen later, with AI help.
- Items that live elsewhere (PRs, pipelines, work items, AI sessions, meetings) are tracked automatically and surface when they need attention.
- Keyboard-first.
- Local-first: all data in SQLite on the user's machine.

**Non-goals (v1)**
- Multi-user collaboration or cloud sync of the yatai database.
- Mobile apps.
- Active-app / screen monitoring (privacy-sensitive; deferred, see §9).

## 2. Core concepts

| Concept | Description |
|---|---|
| **Project** | Top-level container; can nest arbitrarily (hierarchy). |
| **Task** | A unit of work inside a project; tasks can nest to arbitrary depth. |
| **Action** | Smallest granular bit of work that might be done in one sitting. Leaf of a task. |
| **Inbox item** | Unstructured captured idea, not yet filed into a project. |
| **Smart item** | A task/action bound to an external source whose status is monitored. |
| **Focus session** | A timed block (pomodoro style) on a chosen action. |

Metadata (auto-driven): created, last modified, last run (last focused), scheduled for.

## 3. Views

### 3.1 Today (default)
- Thin window, vertical list of **cards** for the next items.
- Card = task (shaded accent) › action(s), e.g. `R&D › extract staff`.
- Ordering: scheduled time first (meetings pinned by time, rising to the top as they approach), then planned order for the day.
- Smart items show live status chips (e.g. "build failed", "2 new comments", "needs feedback").

### 3.2 Organizer
- Tree of projects → tasks → actions; expand/collapse; full arrow-key navigation (←/→ collapse/expand, ↑/↓ move, drag or shortcut to reparent).
- Arbitrary depth and structure.
- Shows metadata columns (created, modified, last run, scheduled).

### 3.3 Inbox
- Quick-capture box (global hotkey) plus list of captured items.
- Drag and drop into projects; or accept AI-suggested filing.

### 3.4 Focus mode
- Hides everything except the current action and a timer.
- On completion: quick prompt — done / continue / what next? — useful when switching context. Updates *last run* and feeds history for AI.

## 4. Smart items and monitoring

Pluggable **connectors**, each polling (or subscribing) and producing status events attached to an item.

| Source | Monitors |
|---|---|
| GitHub PR | mergeable state, new comments, review feedback, build failures |
| Azure DevOps pipeline | deployment/run status |
| Work items (ADO/GitHub issues) | status changes |
| AI sessions (Copilot, Claude, etc.) | done / needs feedback |
| Outlook / Teams calendar | meeting add/change/cancel; surfaced in Today and promoted as start time nears |
| Teams messages (later) | raise awareness of selected chats/mentions |

Connector contract: `auth()`, `poll(since) → events[]`, `link(url) → item`. Events update item status and may bump priority in Today (e.g. build failure promotes the card).

**Calendar sync (open question):** Microsoft Graph API (OAuth device/PKCE flow) is the route to Outlook and Teams calendar and messages. Read-only scopes (`Calendars.Read`, later `Chat.Read`). Needs an app registration; a work tenant may require admin consent.

## 5. AI features

All AI calls go through a single `AiService` so the provider/model is swappable (Claude API by default). Context sent is minimal and user-visible.

- **Inbox organization**: suggest project/task for each inbox item.
- **Plan today**: propose and order Today's cards from scheduled meetings, deadlines, effort, and history.
- **Effort estimates**: estimate per action/task, calibrated by past actuals (focus session durations).
- **Breakdown**: split a task into actions.
- **Offer help**: flag items the AI could do or help with (draft, research, code), with one-click handoff.
- **Historical learning**: "you did something like this before" — retrieve similar completed tasks (embeddings in SQLite) and suggest their action sequence.

AI is always a suggestion, never silently mutates data; accept/reject in-line.

## 6. Architecture

```
┌────────────────────────── Desktop shell ──────────────────────────┐
│  UI (TypeScript, Vite)                                              │
│   Today · Organizer · Inbox · Focus                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Core (TS): domain model, queries, scheduler, AiService             │
├─────────────────────────────────────────────────────────────────────┤
│  Connectors: github · ado · graph(calendar/teams) · ai-sessions     │
├─────────────────────────────────────────────────────────────────────┤
│  SQLite (local)   ·   OS keychain (tokens)   ·   tray/hotkey/notif  │
└─────────────────────────────────────────────────────────────────────┘
```

### Stack decision

| Option | Pros | Cons |
|---|---|---|
| **Tauri 2** (recommended) | Tiny binary, low RAM, native webviews on Win/Mac, TS/Vite frontend, first-class SQLite plugin, tray/global-shortcut/notification plugins | Rust for native glue; webview differences (WebView2 vs WKWebView) |
| Electron | All TypeScript, Bun/Node for everything, mature | ~100MB+ install, higher RAM — conflicts with "very lightweight" |
| Native (WinUI + SwiftUI) | Best native feel | Two codebases |

**Recommendation:** Tauri 2 + Vite + TypeScript (Bun as package manager/dev runner). Keep nearly all logic in TS; use Rust only for shell integration (tray, global hotkey, keychain, window management). Connectors and AI run in the TS layer (or a Bun sidecar if background polling must outlive the window).

- **UI**: Solid or React; Solid is smaller/faster and suits a thin-window app. Final pick is a team preference.
- **DB**: SQLite via Tauri SQL plugin; migrations in versioned `.sql` files.
- **Secrets**: OS keychain (Credential Manager / Keychain), never in the DB.

## 7. Data model (sketch)

```sql
project(id, parent_id, name, created_at, updated_at, archived_at)
task(id, project_id, parent_id, title, notes, status, created_at, updated_at,
     scheduled_for, last_run_at, effort_est_min, sort_key)
action(id, task_id, title, status, created_at, updated_at,
       scheduled_for, last_run_at, effort_est_min, sort_key)
inbox_item(id, text, created_at, suggested_task_id, status)
smart_binding(id, owner_type, owner_id, source, external_id, url, last_status_json, last_polled_at)
event(id, binding_id, kind, payload_json, seen, created_at)
focus_session(id, action_id, started_at, ended_at, planned_min, outcome, note)
embedding(owner_type, owner_id, vector)       -- for historical similarity
```

- Hierarchy uses `parent_id` with `sort_key` (fractional indexing) for cheap reordering.
- `status`: `todo | doing | waiting | done | dropped`. `waiting` is the typical state for smart items awaiting external change.
- *Last modified* and *created* maintained by triggers; *last run* by focus sessions.

## 8. Key flows

1. **Capture**: global hotkey → tiny input → inbox row → optional AI filing suggestion.
2. **Plan today**: open Today → "Plan" → AI proposes list → accept/edit → cards appear.
3. **Focus**: select card → start focus → timer → end prompt → log session, pick next.
4. **Smart item**: paste PR URL → connector resolves → binding created → poll → event → card chip + optional notification, promoted in order.
5. **Meeting approach**: Graph poll → meeting card gains priority as start time nears; changes/cancellations flagged.

## 9. Privacy and security

- Data stays local; the only outbound traffic is connector APIs and AI calls the user enabled.
- Tokens in OS keychain; read-only scopes by default.
- AI payloads show what's being sent; per-feature opt-in.
- **Active-app monitoring** (detect context switches): deferred. If built, it would be opt-in, store only app-name/time buckets locally, and never send window titles to AI.

## 10. Milestones

1. **MVP**: Tauri shell, SQLite, project/task/action CRUD, Organizer with keyboard nav, Inbox, Today (manual), Focus mode.
2. **Smart items**: GitHub PR connector, notifications, status chips, Today re-ranking.
3. **Calendar**: Microsoft Graph for Outlook meetings in Today.
4. **AI v1**: inbox filing, task breakdown, effort estimates.
5. **AI v2**: plan today, historical similarity, "can I help" handoff, AI-session monitoring.
6. **Later**: ADO pipelines/work items, Teams messages, optional active-app awareness.

## 11. Open questions

- Graph auth: can an app registration be made in the work tenant, or is delegated device-code needed?
- Does background polling need to run when the window is closed (tray-resident daemon/sidecar)?
- How to detect Copilot/Claude session state — local logs, hooks, or APIs?
- Embedding source for history: local model vs API.
- Today view: auto-ordered vs user-pinned — how much control?
