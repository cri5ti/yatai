# yatai — plugins (connectors)

Part of the design docs: see [design.md](design.md).

Status: implemented in `app/src/plugins/` (see "As built" at the end for where it differs from the proposal). Expands [design.md](design.md) §4 (smart items) and §10 (milestones 2, 3, 6).
First targets: **GitHub** (real data), **Outlook** and **Azure DevOps** (move onto the plugin system, still mocked).
More sources are expected (Jira, Linear, GitLab, Teams, AI sessions), so the system is built around the *kinds of things a source gives us*, not around three hard-coded integrations.

## 1. Where we are

Everything external is faked in the core today, and the three sources are wired in by name:

| Concern | Today | Lives in |
|---|---|---|
| PR link detection | one regex, `prLinks()` | `model.ts` |
| PR status + unresolved comments | `prs` / `prc` maps keyed `org/repo#123`, set by hand from the developer panel | `store.ts`, `actions.ts` (`setPrStatus`), `Controls.tsx` |
| Pipeline / work item / AI-session chips | `alertsFor()` switches on `node.smart.source` and reads global `flags` | `model.ts` |
| Meetings | `CALENDAR` constant; "moved" is `flags.meetingMoved` | `store.ts`, `model.ts` |
| The three drawers | `GH` / `ADO` mock tables, per-kind tabs hard-coded | `mock.ts`, `Drawer.tsx` |
| Secrets | one AI key in the OS keychain, added to requests in Rust | `src-tauri/src/ai.rs` |
| Polling, auth, diffing | nothing | — |

What the POC and the app already tell us about what each source must deliver:

| Source | What the UX needs from it |
|---|---|
| **GitHub** | (a) a pasted PR link becomes a smart item with a live state: draft / to review / checks running (queued or in progress: a passing state, not announced) / has feedback (N unresolved) / build fails / ready / merged / closed; (b) a change (build went red, new comments, approved) highlights the item and toasts; (c) drawer lists: *assigned to me* (review requested), *my PRs*, *mentions*; (d) "bring in" to Next or Inbox: under the current item (the row picked in Next, or the Organizer's selection), or beside it when that is itself a PR / work item / run |
| **Outlook** | (a) today's events, each with start / duration / location; (b) a meeting you brought into Next stays in sync: moved, cancelled, renamed → highlight + toast; (c) the drawer lists today's agenda; (d) read-only (moving a meeting in yatai is local only) |
| **Azure DevOps** | (a) work items: *mentions*, *mine*, *created by me*, with type + state; (b) a linked work item chips its state changes (Active → Resolved); (c) pipeline runs: a pasted `…/_build/results?buildId=N` link shows the run's state: queued / building / failed / done (or cancelled); a failed run alerts, a finished one is announced |
| **Later** | AI sessions (local, no network: done / needs feedback), Teams mentions, Jira / Linear issues, GitLab MRs |

The common shape: a source supplies **links it can recognise**, **live state for things yatai tracks**, **lists to browse**, and sometimes **time-bound events**. Everything else (highlighting, toasts, ordering in Next, chips, bring-in, persistence) is the same for every source and belongs in the core.

## 2. Goals and non-goals

Goals
- Adding a source touches one folder (`app/src/plugins/<id>/`) and one line in a registry. No `switch (source)` in the core.
- The core knows nothing about GitHub PRs, work items or Graph. It knows *tracked things*, *lists*, *agenda events* and *alerts*.
- A mocked plugin and a real plugin implement the same interface, so the developer panel keeps working and a plugin can be developed against mock data first.
- Tokens never reach the page after they are stored (same rule as the AI key).
- Read-only by default; writes (comment, merge, move meeting) are a later, per-plugin, opt-in capability.

Non-goals (for now)
- Third-party / user-installed plugins and sandboxing. Plugins are in-tree TypeScript. The interface is kept serialisable (plain JSON in and out, no callbacks) so a plugin can later run out of process (stdio JSON-RPC) or as a WASM module without changing the core.
- Two-way sync.
- Polling while the app is closed (see open questions).

## 3. Concepts

| Term | Meaning |
|---|---|
| **Plugin** | One source: `github`, `outlook`, `devops`. Has a manifest, an auth method and any of the *providers* below. |
| **Ref** | A stable pointer to one thing at a source: `{ plugin: 'github', id: 'acme/api#482' }`. `id` is opaque to the core; the plugin parses it. Serialised as `github:acme/api#482`. |
| **Snapshot** | What a plugin currently knows about a Ref (`title`, a `state`, alerts, `rev`). The core stores the last snapshot per Ref. |
| **Alert** | A thing worth attention inside a snapshot: `{ key, tone, text }`. Keys are stable (`checks:failed`, `threads:3`) so the core can tell *new* from *still there*. |
| **List** | A named, browsable set of entries a plugin offers (a drawer tab). |
| **Agenda event** | A time-bound entry (meeting) from a calendar-like plugin. |
| **Account** | The plugin's credential state: `none` / `connected(as)` / `expired` / `error`. |

### Providers (a plugin implements any subset)

| Provider | Gives the core | Used for |
|---|---|---|
| `links` | `match(text) → Ref[]` (find refs in pasted/typed text), `url(ref)` | paste a PR / work item / pipeline URL → smart item; open in browser |
| `track` | `fetch(refs[]) → Snapshot[]` (batched), poll hint | live chips, highlights, toasts |
| `lists` | `lists() → ListDef[]`, `list(id) → Entry[]` | drawer tabs, "bring in" |
| `agenda` | `agenda(day) → AgendaEvent[]` | meetings in Next and the Outlook drawer |

GitHub: links + track + lists. DevOps: links + track + lists. Outlook: agenda (+ lists for the drawer, which is just today's agenda). A future AI-sessions plugin: track only (no links, no lists; its refs come from a local discovery step).

## 4. The plugin interface

TypeScript, in `app/src/plugins/types.ts`. Everything crossing the boundary is plain JSON.

```ts
export interface Plugin {
  manifest: {
    id: string;                      // 'github'
    name: string;                    // 'GitHub'
    icon: string;                    // id of an icon the UI knows, or an emoji
    hosts: string[];                 // network allow-list: ['api.github.com', 'github.com']
    auth: AuthMethod[];              // how the user can connect, in order of preference
  };

  /** the plugin is told about the host once; it never touches fetch/keychain directly */
  init?(host: Host): void;

  links?: {
    match(text: string): RefMatch[];                 // sync, pure, no network
    url(ref: Ref): string;
  };
  track?: {
    fetch(refs: Ref[], ctx: FetchCtx): Promise<Snapshot[]>;   // one batched call where the API allows
    pollMs: { active: number; idle: number };                 // hints; core adds backoff / visibility rules
  };
  lists?: {
    defs(): ListDef[];                                        // [{ id:'assigned', label:'Assigned to me' }, …]
    fetch(id: string, ctx: FetchCtx): Promise<Entry[]>;
  };
  agenda?: {
    fetch(day: string, ctx: FetchCtx): Promise<AgendaEvent[]>;
  };
}

export type AuthMethod =
  | { kind: 'device-flow'; /* GitHub, Entra */ }
  | { kind: 'token'; label: string; help: string }        // paste a PAT; stored in the keychain
  | { kind: 'cli'; command: string; label: string }      // import from a local CLI login (gh, az)
  | { kind: 'none' };                                     // local-only plugins

export interface Ref { plugin: string; id: string }
export interface RefMatch { ref: Ref; start: number; end: number }   // where in the text it was found

export interface Snapshot {
  ref: Ref;
  title: string;
  /** a small closed vocabulary the UI can draw without knowing the plugin */
  view: { glyph: Glyph; label: string; tone: Tone; count?: number };
  alerts: Alert[];                // what the chips under the item say; see §6
  rev: string;                    // changes when anything shown changes (updated_at, etag, hash)
  gone?: boolean;                 // deleted / no access: stop polling it, say so
}
export interface Alert { key: string; tone: 'bad' | 'warn' | 'good' | 'info'; text: string }

export interface Entry {          // one row in a drawer
  ref: Ref;
  title: string;
  sub: string;
  lead: Snapshot['view'];         // the left-hand glyph / state
  snapshot?: Snapshot;            // when the list call already returned full state, saves a track() call
}

export interface AgendaEvent {
  ref: Ref; title: string; start: number; durationMin: number; where: string;   // minutes of day, as Meeting today
  cancelled?: boolean; rev: string;
}

export interface FetchCtx { signal: AbortSignal; since?: string }   // since = last rev, for conditional requests
```

`Glyph` is a closed set (`draft | review | feedback | failing | ready | merged | closed | active | resolved | running | …`). The current `PrState` glyphs in `Pr.tsx` become the first entries; a plugin that needs a new look adds a glyph to the shared set rather than shipping its own React. This keeps the UI one design.

### The host (what a plugin is allowed to do)

```ts
export interface Host {
  http(req: { method?: string; url: string; headers?: Record<string, string>; body?: unknown;
              auth?: boolean }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  kv: { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> };   // per-plugin namespace
  log(level: 'debug' | 'info' | 'warn', msg: string): void;
}
```

- `http` goes through a Rust command, not the webview's `fetch`. Rust checks the URL host against `manifest.hosts` and, when `auth: true`, attaches the plugin's credential from the keychain (`Authorization: Bearer …`, or Basic for ADO PATs). **The plugin never sees the token.** This generalises what `ai.rs` already does for the AI key.
- The one moment a token is in the page is when the user pastes it, or during the device flow (see §8.2). It is handed to Rust (`plugin_secret_set`) and not kept.
- `kv` is for plugin cursors and small caches (e.g. etags), namespaced `plugin:<id>:` in the existing `kv` table.

## 5. Core services (`app/src/plugins/`)

```
plugins/
  types.ts         the interfaces above
  registry.ts      list of plugins, mode per plugin (live | mock | off), lookup by id
  runtime.ts       builds Host for a plugin; wraps calls with timeouts, error → account status
  tracker.ts       the poll loop and snapshot diffing (§6)
  auth.ts          account status, connect / disconnect flows, token expiry handling
  github/          index.ts, api.ts (REST+GraphQL), map.ts (API → Snapshot), auth.ts
  outlook/         index.ts (mock for now)
  devops/          index.ts (mock for now)
  mock/            shared helpers: in-memory source driven by the developer panel
```

**Registry.** `registry.ts` exports `PLUGINS: Plugin[]`. Each plugin has a *mode*, saved in UI prefs: `live` (real), `mock`, `off`. Default: a plugin with a real implementation is `live`; one without is `mock` when `demo` is on and `off` otherwise. The developer panel can flip any plugin to `mock`. Mock and live implementations are two exports of the same plugin folder behind the same interface (`github/index.ts` exports `live`, `github/mock.ts` exports `mock`).

**Tracker.** One loop in the core:
1. Collects what is being tracked: every non-done node that holds a ref (§7), plus agenda for today.
2. Groups by plugin, calls `track.fetch(refs)` once per plugin per tick. Open drawer → also fetches its current list (more often while it is open).
3. Diffs each returned snapshot against the stored one (§6) and emits changes.
4. Schedules the next tick per plugin: `pollMs.active` while the window is visible, `pollMs.idle` while hidden (never 0), exponential backoff on errors and `429 / Retry-After`, paused while the account is `none / expired`.
5. Manual refresh (⌘R in a drawer, "refresh" on a chip) bypasses the timer.

The tracker is the only thing that calls a plugin, so rate limiting, backoff and the offline state are done once.

**Auth service.** Holds `Account` per plugin: `none | connecting | connected{as} | expired | error{msg}`. The Settings window gets one "Accounts" section listing every registered plugin with Connect / Disconnect and its state (replacing nothing: the AI key section stays). Drawers and chips of a plugin without an account show a *Connect GitHub…* row instead of the current "not built yet" text, which opens Settings on that plugin. 401 from any call → account `expired`, polling for that plugin pauses, one toast.

## 6. Snapshots, alerts and changes

The core's replacement for `alertsFor()` + `flags`:

- A tracked node's chips = `snapshot.alerts` (plus the always-shown `view` glyph/label).
- On each new snapshot the core compares `alerts` by `key` with the stored ones:
  - new key with tone `bad | warn | good` → highlight the node (existing `hl`) and toast `text`;
  - key gone → silently removed;
  - tone `info` never toasts.
- `needsAttention(node)` = has any alert with tone ≠ `info`. This is what `nextModel` already uses to promote a card, so ordering keeps working with no change to its logic.
- `rev` equal → skip the diff entirely (cheap polls).

Example, GitHub PR with a red check and 3 unresolved threads:
```json
{ "ref": {"plugin":"github","id":"acme/api#482"}, "title": "Auth token refactor",
  "view": {"glyph":"feedback","label":"has feedback","tone":"warn","count":3},
  "alerts": [{"key":"checks:failed","tone":"bad","text":"Build failed: unit-tests"},
             {"key":"threads","tone":"warn","text":"3 unresolved comments"}],
  "rev": "2026-11-08T10:14:02Z" }
```

The existing `Flags` / developer-panel toggles keep working **as the mock plugins' input**: toggling "PR build failing" changes what the mock GitHub plugin returns on its next `fetch`, then the normal diff produces the highlight and toast. The mock path therefore exercises the same code as the live path.


### 6.0 Getting the credentials

Settings shows, under each account, **How to get it** (`app/src/guides.tsx`), open until the account is connected. GitHub: `gh auth token [--hostname <host>]` (the GitHub CLI's own token: quick but broad), or a fine-grained token (Pull requests / Commit statuses / Checks / Metadata, read-only), plus the SAML SSO note. DevOps: the Personal access tokens page (Build: Read), or one Azure CLI script that signs in and creates a PAT with Build (Read) for 90 days through the PAT lifecycle API. There is a PowerShell version (az for the access token, Invoke-RestMethod for the request, because JSON passed to `az.cmd` loses its quotes) and a bash / zsh one (`az rest`); the user's OS comes first. Outlook: Publish a calendar → the ICS link (there is no CLI route without an admin's consent for Graph). Placeholders are filled from what the user typed (host, organization); nothing company-specific is written in.

### 6.1 Notify me when it changes

Any item that tracks something (a PR link, a run link, a smart item) has **Notify me when it changes** in its menu (`/notify`; several selected items toggle together). It is saved on the item (`notify`). For such an item, every change of state counts: GitHub's *checks running*, a run going queued → building → done. Normally only what wants attention counts. Each change is a toast and a highlight, as always. When yatai is hidden or not in front, it is also a **system notification** (`tauri-plugin-notification`; it asks for permission the first time). Rows that notify show a 🔔.

**Refresh** (same menus, `/refresh`) asks the sources about the selected items right away, whether or not they are in Next, and says what came back.

### 6.2 Details become sub-items

A snapshot can carry `details`: the things to act on inside a tracked item, each with a stable key. GitHub reports each **failing check**, with its first real error (a failure annotation that is not just "exit code 1", else the check's title) and a link to the run; its key includes the head commit, so a failure on a later commit is a new one. It also reports each **unresolved review thread**, by its first comment (`@who on file: text`, linked). The tracker (`syncDetails`) keeps one sub-item per detail under every open item that tracks the ref. It marks them with `origin` (`<ref>|<key>`), puts the link on the second line (comment links never count as the PR itself), and highlights new ones. When a detail is no longer reported (the check passes, the thread is resolved, the PR is merged or closed), its sub-item is **checked off** and highlighted. Nothing is reopened or deleted: a sub-item you remove comes back only if it is reported anew.

## 7. Data model changes

Small and additive; fits `design.md` §7 (`smart_binding`, `event`).

- `Node.smart: { source }` → `Node.smart: { ref: Ref }` (`source` is derived from `ref.plugin`). A node holds at most one ref in v1; PR links inside titles are still detected by `links.match` at render and tracking time, so pasting a URL "just works" without a separate bind step. Pasting resolves through *every* plugin's `links.match`, the first match wins.
- New table `snapshot(ref TEXT PRIMARY KEY, json, rev, fetched_at)` replaces the `prs` / `prc` UI maps. In state: `snaps: Record<refKey, Snapshot>`.
- `Meeting` gains `ref?: Ref` and `cancelled?: boolean`. A meeting brought in from an agenda keeps its ref; agenda syncs update `start`/`title`/`where` and emit `meeting moved` alerts (replaces `flags.meetingMoved` + `movedTo`).
- `kv` rows `plugin:<id>:mode`, `plugin:<id>:cursor:*`.
- Migration: existing nodes with `smart.source = 'pr'` and PR links get `smart.ref` filled from `prLinks`; `pipeline` / `workitem` / `ai` map to the mock plugins' refs; `prs` / `prc` are dropped (they are only mock state).

Drawer kinds stop being a closed union: `drawer: { plugin: string; list: string; sel: number }`. Tabs come from `lists.defs()`. The three drawer shortcuts stay as they are, bound to `github`, `outlook`, `devops` by the registry (`plugin.manifest.drawerKey`, so a fourth source gets a menu entry, not a new component).

## 8. The three plugins

### 8.1 Plan for the system itself (needed before any plugin)

1. Types, registry, runtime, tracker, snapshot store.
2. Rust: generic `plugin_http` + `plugin_secret_{set,clear,status}` (the AI key keeps its commands; they share the keychain helper).
3. Core switched from `flags` / `prs` / `GH` / `ADO` / `CALENDAR` to snapshots, lists and agenda.
4. `Chips`, `Next`, `Drawer`, `Pr` read `snaps` through small selectors; they stop importing from `mock.ts`.

### 8.2 GitHub (live)

**Auth** — the user has to be able to connect in under a minute, and the token should be as narrow as possible. In order of preference (`manifest.auth`):

1. **Device flow** (browser-based, no secret in the app, works with SSO). The app shows a code and opens `github.com/login/device`, polls `POST /login/oauth/access_token` until approved. Needs a registered app with *device flow enabled*; its `client_id` is public and ships in the binary. Prefer a **GitHub App** (fine-grained read-only permissions: Pull requests, Checks, Commit statuses, Metadata; expiring tokens + refresh token) over an OAuth App (whose only useful scope, `repo`, is read-write and sees all private repos). An org that restricts third-party apps must approve the app once.
2. **Personal access token** (fine-grained, read-only: *Pull requests*, *Checks*, *Commit statuses*, *Metadata*, optionally *Issues*), pasted in Settings and stored in the keychain. Zero registration needed; works today.
3. **Import from `gh`** (button: "Use my `gh` login") runs `gh auth token` once and stores the result in the keychain. Zero friction for a developer who already has the CLI; note that `gh`'s token is usually broad, so the UI says so.

Proposal: build 2 and 3 first (no external registration, usable immediately), then 1 once there is a `client_id` to ship. All three end in the same place: a token in the keychain under `plugin:github`, `Authorization: Bearer`.

For GitHub Enterprise: a configurable base URL in the plugin's settings; `hosts` is derived from it.

**Links** — `match` finds `github.com/<org>/<repo>/pull/<n>` (what `prLinks` does now), id = `org/repo#n`. Issues (`/issues/n`) are a cheap second pattern with the same machinery; out of v1 scope for status, in for link detection.

**Track** — one GraphQL request per tick for all tracked PRs, using aliases:
```graphql
query { p0: repository(owner:"acme", name:"api") { pullRequest(number:482) {
  title url state isDraft merged mergeable reviewDecision updatedAt
  reviewThreads(first:100) { nodes { isResolved } }
  commits(last:1) { nodes { commit { statusCheckRollup { state contexts(first:50){ nodes { … on CheckRun { name conclusion } … on StatusContext { context state } } } } } } }
} } p1: … }
```
Cost is about 1 point per PR; the 5,000 points/h budget allows 20 PRs polled every 60 s with room to spare. Pause on `403` secondary-rate-limit / `Retry-After`.

Mapping to the existing `PrStatus` (first match wins, so "what needs me" beats "what is true"):

| Condition | view.glyph | alert |
|---|---|---|
| `merged` | merged | — |
| `closed` | closed | — |
| `isDraft` | draft | — |
| rollup `FAILURE` / `ERROR` | failing | `checks:failed` bad: "Build failed: <first failing check>" |
| unresolved threads > 0 or `CHANGES_REQUESTED` | feedback (count = unresolved threads) | `threads` warn: "N unresolved comments" |
| `APPROVED` and rollup `SUCCESS` and mergeable | ready | `ready` good: "Approved · mergeable" |
| otherwise | review | `review` info: "Awaiting review" |

These match the seven states and chip texts the POC already designed (`alertsFor`, `PR_STATUSES`).

**Whose move** (`view.turn`, `map.ts turnOf`): an open PR is either mine to act on (`me`, deep blue) or waiting on someone else (`them`, muted purple); merged is green, closed grey. It comes from `viewerDidAuthor`, `viewerLatestReviewRequest` and, per unresolved thread, whether its last comment is mine.
- My PR: draft, failing, conflicts, a thread whose last word is not mine, changes requested (no threads), or approved and green (merge it) → `me`; awaiting review, checks running, or every thread answered by me → `them`.
- Someone else's PR: `me` only while my review is requested; otherwise (my comments, my requested changes, approved) → `them`.
- Waiting on others turns its alerts to `info`: no pin in Next, no warning toast.

**Lists** (drawer tabs), via the search API, each returning enough to build a snapshot (then one `track` call fills in the check/thread state for the visible rows):
- *Assigned to me*: `is:pr is:open review-requested:@me archived:false`
- *My PRs*: `is:pr author:@me archived:false` (open + recently merged, limited to 30)
- *Mentions*: `is:pr mentions:@me is:open`

**Bring in** is the existing `bringIn`: it creates the node with `smart.ref` and the snapshot from the entry.

**Out of scope for v1**: notifications API, comments text, review actions, issues' status, org-wide search, webhooks (needs a server; polling only).

### 8.3 Outlook (mocked, through the plugin system)

`agenda` provider returning the current `CALENDAR` data from a mock source; `lists` returns *Today's agenda* from the same call. The mock's "move Design review" toggle (dev panel) mutates the mock source, so the agenda sync produces a changed `start`, the meeting highlights and toasts through the normal path.

Live versions: the published ICS feed (no sign-in, slow), or Microsoft Graph `GET /me/calendarView` (`Calendars.Read`) through the Microsoft account below (real time). Which one is used follows Settings → Microsoft.

### 8.3.1 The Microsoft account (Entra ID), shared by Calendar, Emails and Azure DevOps

One sign-in, several sources. The user registers yatai once as an Entra *public client* (redirect `http://localhost`, delegated `User.Read`, `Calendars.Read`, `Mail.Read`, `offline_access`, Azure DevOps `user_impersonation`) and pastes its client id in Settings → Microsoft, where a tick box per source (Calendar · Emails · Azure DevOps) switches that source onto the account. Ticking one that needs a permission not consented yet opens the browser once (authorization code + PKCE, loopback redirect: device code is often blocked by conditional access).

- **Tokens stay in Rust** (`src-tauri/src/entra.rs`). The refresh token is in the OS keychain (split in pieces: a Windows credential is small); an access token per resource (`graph`, `devops`) is minted from it and renewed five minutes before it expires. The refresh token rotates and is saved again. The page only asks `plugin_http` for a request `entra: 'graph' | 'devops'`; Rust adds the bearer and refuses any host that is not that resource's (`graph.microsoft.com`; `dev.azure.com`, `*.visualstudio.com`).
- A grant that no longer works (expired, revoked, conditional access wants a new sign-in) answers like a rejected token (401 → `AuthError` → the account shows *expired*).
- GitHub is not part of this: Entra does not issue GitHub tokens (a PAT or the `gh` token, as before).
- Emails reads through Graph (`plugins/mail/graph.ts`, same input and output as `mail.ps1`) when ticked, else through the classic Outlook's COM, which new Outlook does not have.
- The old token / ICS fields stay as the fallback for Azure DevOps and Calendar when the account is not ticked for them.

### 8.4 Azure DevOps (pipeline runs live; work items mocked)

- **Pipeline runs are live.** A run link (`https://dev.azure.com/<org>/<project>/_build/results?buildId=<id>`, or `<org>.visualstudio.com/…`) in an item's first line is a ref `devops:build/<host>/<org>/<project>#<id>`. The item renders it as `◇ name #id` plus a state icon: queued, building (spinning), failed, done, cancelled. The tracker reads `GET …/<project>/_apis/build/builds/<id>`; `statusOf` maps `status` + `result` to the state (partially succeeded = done with a warning). Settings → DevOps takes the organization (`acme`, `dev.azure.com/acme` or `acme.visualstudio.com`) and a PAT with *Build (Read)*. The token is bound to that host and sent by Rust as Basic auth (`plugin_http` with `scheme: "basic"`). A run of another organization, or one the token cannot see, says so instead of looking queued.
- **Announcing a run:** queued and building are *passing* states (`View.quiet`): moving into them is not a toast. Failing is an alert (toast + highlight). Finishing (done / cancelled) is announced by its change of state. An item set to notify (§6.1) hears about every step.
- **Builds** (drawer group, live): *Pending* (waiting: `notStarted`, `postponed`), *Running* (`inProgress`, `cancelling`) and *Recent* (finished today, the latest 20), across every project of the organization, newest first. Each row shows the project, branch, who started it and when it was queued / started / finished. ⏎ brings one in as a tracked run link. Builds can only be listed per project (Azure DevOps has no organization-wide call). So once an hour yatai lists the projects and asks each whether it has any pipeline (`build/definitions?$top=1`); refreshes then ask only those. That is one request per project with pipelines per refresh of the open tab, only while the drawer is open. A project the token cannot read is left out.
- **Work items** (drawer group, live): tabs *Assigned to me*, *Created by me* (both leave finished states out), *Following* (`@Follows`) and *Mentions* (`@RecentMentions`). Each refresh is one WIQL query (newest change first, at most 50) and one `workitemsbatch` for the fields: type, state, project, assignee, last change. ⏎ brings one in as a smart item (`devops:wi/<id>`); its state is then followed in one batch for all tracked work items, and a change of state is announced. The token needs *Work Items (Read)* as well as *Build (Read)*.
- **Mocked (demo):** the same tabs over made-up data; work items (`links`/`track` by the `WI 18233` convention, `lists` *Mentions*, *My work items*, *Created by me*), the smart "Deploy 2.4" run of the demo data, and the *Pipelines* drawer list. The developer panel sets each mocked run's state. Later: work items over REST (`_apis/wit/wiql` + `workitemsbatch`), a live pipelines list, Entra device flow.

## 9. Adding a source later (what it costs)

| Source | Providers | Notes |
|---|---|---|
| Jira / Linear | links, track, lists | token auth; same shape as DevOps work items |
| GitLab MRs | links, track, lists | near-copy of GitHub; `hosts` configurable |
| Teams mentions | lists (+ track for pinned chats) | Graph, `Chat.Read`; shares the Entra account with Outlook, so *accounts* should be shareable between plugins (`manifest.auth.shared: 'entra'`), a small addition to the auth service |
| AI sessions: Claude, Copilot (both built) | lists + track | local: `auth: none`; reads files on this PC instead of `http` (see the Claude entry in §13). Both share `plugins/sessions.ts` (states, chips, rows) |

## 10. Security

- Tokens live only in the OS keychain, one entry per plugin (`plugin:<id>`), read in Rust and attached to requests there. The webview only gets *status* (`connected as …`).
- `plugin_http` enforces the manifest's host allow-list and HTTPS, rejects redirects to other hosts, and caps response size.
- Requests carry a plain `yatai` User-Agent, no email or machine identifiers.
- Read-only scopes by default; the UI lists the permissions a plugin asks for before connecting.
- Snapshot cache holds titles/states only, not tokens (SQLite is already local). Disconnecting a plugin offers to delete its snapshots.
- Anything a plugin returns (titles, comments) is untrusted text: rendered as text/markdown through the existing `md.tsx`, never as HTML.

## 11. Milestones

1. **Plugin core, mocks only.** Types, registry, runtime, tracker, snapshot store, migration. Outlook, DevOps and GitHub-mock run on it; developer-panel flags drive the mocks. App behaviour is unchanged, which is the acceptance test. Headless check: scripts feeding mock plugins through the tracker and asserting highlights/toasts/ordering.
2. **Rust host**: `plugin_http`, `plugin_secret_*`; unit tests for the host allow-list and redirect handling.
3. **GitHub live**: Settings → Accounts (PAT + `gh` import), GraphQL track, search lists, empty/offline/expired states, rate-limit backoff. Manual check list in `todo.md`.
4. **GitHub device flow** once a GitHub App `client_id` exists.
5. **Real Outlook / DevOps** as the auth questions are answered.

Each step is its own commit(s) and keeps `tsc` + `build` (+ `cargo check/test`) green.

## 12. Open questions

- **GitHub App vs PAT as the default**: a GitHub App needs someone to register and, for org repos, an org admin to install/approve it. Is that acceptable, or do we stay on PAT + `gh` for a while?
- **GitHub Enterprise / multiple hosts** in v1, or only github.com?
- **Which PRs are polled**: only those linked in non-done items (cheap, proposed), or also everything in the open drawer list?
- **Polling while hidden**: webview timers are throttled when the window is hidden (see `todo.md`). Likely answer: move the tracker loop into Rust and have it emit events, once there are real plugins to justify it. The plugin interface does not change.
- **One ref per node** vs several (a PR plus its work item on one action)? v1: one; titles can still contain more links, rendered but not tracked beyond the first.
- **Plugin settings UI**: generic form from a schema in the manifest (base URL, repos to ignore, poll interval) vs bespoke per plugin. Proposal: a small `settings` schema in the manifest, rendered by Settings.

## 13. As built

Differences from the proposal above, decided while implementing:

- **Auth**: personal access token (fine-grained, read-only) first; no `gh` import, no device flow yet. The token is stored with the host it is allowed to go to (`api.github.com`, or the Enterprise host), and `plugin_http` refuses to send it anywhere else. Redirects are not followed.
- **GitHub Enterprise** is supported from the start: Settings → *GitHub host* (blank = github.com). One host at a time; PR links are recognised for that host only. REST/GraphQL live at `https://<host>/api/graphql`.
- **Refs are strings** (`github:acme/api#482`), not objects. `Plugin` has `match`, `auth`, `live`, `mock` and `pollMs`; the provider bag (`Impl`) has `fetch`, `lists`/`list`, `agenda`. Implementations import the platform bridge directly instead of receiving a `Host`.
- **What is polled**: items in Next that are not done, plus items bound to a source with `smart` (work items, runs); GitHub PRs come from the links in item titles. GitHub every 60 s while the window is shown (3 min hidden), DevOps 30 s (3 min), Outlook 5 min (15 min), Emails 2 min (5 min); the open drawer's list on the same schedule. Changing what is tracked, opening a drawer or a tab, and Refresh run a cycle at once. There is no push channel to a desktop app (webhooks need a reachable server; the notifications API is polled too), so polling it is.
- **GitHub in two steps** (GraphQL points: 5,000 an hour per token). Every poll asks the *light* fields of each PR (state, counts, head commit, check states, `updatedAt`: ~0.03 points each). Only a PR that is new, whose light fields changed since its details were fetched (`Snapshot.basis`), or that the user refreshed gets the *full* query: thread comments and check annotations, ~1.5 points each. The drawer lists use the light fields only. 20 PRs in Next cost ~1 point a poll; a change adds ~1.5 for that PR.
- **Request counts**: every request a plugin makes (`pluginHttp`, the calendar feed; each mock call counts as one) is counted, and each drawer's footer shows `requests: N` (last hour, the total in the tooltip). GitHub also shows the points left, read from `rateLimit` in every query, turning red under 10%. Backing off on a rate limit is still to do.
- **State**: `snaps` (last snapshot per ref, saved) replaces what `prs` / `prc` used to be for the UI. `prs` / `prc` / `flags` stay, but only as the *mock* plugins' input from the developer panel. `agenda` (saved) holds the calendar events; a meeting moved by the calendar gets `movedTo`.
- **Not done**: the `snapshot` SQL table (snapshots live in the UI-state JSON), per-plugin settings schema, `Host.kv`, shared accounts between plugins.
- Tested headlessly (esbuild + node): the GitHub mapping, the live API against a stubbed transport (batching, Enterprise endpoints, 401 / rate limit, rejected token removed again), and the tracker with the mocks (first sight is silent, changes toast + highlight once, meeting moves). Rust: unit tests for the host check.
- **Outlook (live)**: read through the calendar's published ICS feed instead of Graph, because the work tenant needs an admin to approve `Calendars.Read`. The link is stored in the keychain as the plugin's secret and fetched by Rust (`plugin_get_secret_url`), so it never sits in the page. `plugins/outlook/ics.ts` turns the feed into one day's meetings: UTC / floating / TZID times (IANA names, Windows names such as `GTB Standard Time`, `(UTC+02:00)`), recurring series (daily / weekly / monthly / yearly, COUNT, UNTIL, EXDATE), moved or cancelled single instances (RECURRENCE-ID), STATUS:CANCELLED; all-day events are left out. Ids are derived from the UID and the instance, so a moved meeting is recognised as the same one. A meeting in Next that disappears from the feed is announced as no longer on the calendar. Polled every 5 min (15 hidden): Outlook's published feed lags, so faster does not help. Parser tested against fixtures in three time zones.
- **Emails (POC)**: the drawer is called Emails; the Outlook one is now labelled **Calendar** (the plugin id stays `outlook`). Mail is read from the **classic Outlook on this PC through COM** (`src-tauri/src/mail.ps1`, run hidden by `mail.rs`), because Graph `Mail.Read` needs the same admin consent as the calendar and the Azure CLI token does not carry it. Outlook has the mailbox synced already (cached mode); COM starts it in the background if it is not running. Read-only. Each look takes the **unread mail of the last N days** (Settings → Emails, default 14; 0 = any age; at most 200) **in the folders the user ticked** in Settings → Emails: the user's own mailbox only (shared mailboxes are left out), its mail folders minus the system ones (Deleted Items, Sync Issues and its subfolders, Junk, Sent, Drafts, Outbox, Conversation History, RSS); **none are ticked by default, and then nothing is read**. Folders are kept as paths relative to the mailbox (`Inbox\Team`); a ticked one Outlook no longer has is shown as not found. Each mail carries its folder: the drawer row shows a subfolder's name and both sorters are told it (a rule filed it there). Mail is matched by EntryID; a mail no longer returned has been read elsewhere (shown faded for a while), and mail older than the window drops out. A new provider, `poll()`, lets a source pull a stream of its own each cycle and return toasts.
- **Sorting emails with a local model**: each mail is sorted once into Urgent / Today / Eventually / Dismiss by an **Ollama** model (Settings → Emails; default `qwen3:4b-instruct-2507-q4_K_M`), with a JSON schema for the answer and temperature 0. The prompt gets sender (and whether they are in the organisation), To / Cc, subject, age, importance and the first 1,200 characters of the body. Rust (`llm.rs`) talks to Ollama on loopback only and keeps every `ollama*` process at idle CPU priority while a request runs (Ollama starts a new runner per model load, so it is reapplied every second); requests ask for half the cores (`num_thread`). At most 45 s of sorting per cycle, so a large seed is sorted over a few cycles. Compared on 38 real unread mails (i7-9700K, GTX 1060 3 GB, idle priority, 4 threads): `llama3.2` (3B) took 3.8 s a mail but was erratic (an out-of-office and a certificate notice called urgent, a colleague's production request dismissed); `qwen3:4b-instruct-2507` took 6.1 s and was sensible throughout (no false urgents, automatic replies and vendor mail dismissed, direct requests today), if a little quick to file colleagues' FYI threads as eventually. The buckets live with the mail in the saved UI state (`mail`); hooking them into tasks is still open.
- **Laya (decision model, no LLM)** as a second sorter (Settings → Emails → Sorter). Laya is a ModernBERT / mmBERT encoder with decision heads: it answers typed questions (`choice`, `noul`) with probabilities in one forward pass and generates no text. A Python helper (`src-tauri/src/laya_server.py`, stdlib HTTP on 127.0.0.1:8765) wraps `laya.Router` with vega (its LLM reader) off; `laya.rs` writes the script next to the venv made by `app/sidecar/laya/setup.ps1` (uv, Python 3.12, CPU-only torch), starts it hidden at idle priority on first use, and the helper exits when yatai does or after an hour idle. Each mail gets three questions: the bucket (a `choice` with a description per bucket), "expects a reply?" and "bulk mail?" (`noul`); the drawer shows the bucket's probability and the signals. **Untrained it does not sort this mailbox well**: on the same 38 mails the English checkpoint agreed with qwen3 on 8 (10 called urgent, marketing among them), multilingual on 9 (29 today), typed-decisions on 13 with near-even probabilities; the yes/no signals overlapped too (a colleague's request scored as bulk 0.9). 0.6 s for a short mail once loaded, 5 to 10 s for a typical one at 4 threads. Laya's own docs say urgency-style questions need fine-tuning on labelled examples, so qwen3 stays the default sorter until Laya is trained (app/todo.md).
- **Claude sessions (local)**: the Claude button opens a drawer listing the Claude Code sessions running on this PC (CLI, VS Code, any number of windows), those that need you first. ⏎ brings one in as an item in Next (`claude:<sessionId>`, smart source `ai`); the item then follows it: *working* (quiet), *needs you* (warn: a question or a permission prompt, toast + highlight), *finished* (good: toast), *ended* (quiet; the process is gone). It reads what Claude Code already writes: one small JSON file per running session in `~/.claude/sessions` (`CLAUDE_CONFIG_DIR` is honoured) with its name, folder, status (`busy` / `idle` / `waiting` / `shell`) and when it changed. **No hooks and no change to Claude Code, and the transcripts are never opened.** `claude.rs` keeps only the public fields (never the tokens or socket paths in the file) and checks that the process is alive and is the same one (pid and creation time, so a crash that left a file behind, or a reused pid, reads as ended). The tracker polls it every 10 s (1 min hidden); it is local, so nothing counts as a request. Each wait or finish has its time in the alert key, so a second one toasts again; an idle session that was already idle when first seen is silent, as for every source. Names are the derived ones (`yatai-1d`), so the drawer row adds folder, where it runs and how long in that state; rename the item as you like. Demo: three made-up sessions. Not done: titles from the first prompt (would mean opening transcripts), jumping to the session's window.
- **Copilot sessions (local)**: the Copilot button is the same drawer for GitHub Copilot (CLI, VS Code, JetBrains), sharing `plugins/sessions.ts` and the state icons with Claude. Copilot keeps a folder per session in `~/.copilot/session-state/<id>/` (`COPILOT_HOME` is honoured): `workspace.yaml` (folder, name, client, branch), `events.jsonl` (the log) and an `inuse.<pid>.lock` while a process holds it open. `copilot.rs` reads the **kind** of the log's last events from its last 512 KB (the type and timestamp of each line are cut out of the line without parsing it; the conversation text is never read, kept or returned): a turn started or a tool running = *working*; a permission asked and not answered yet = *needs you*; `assistant.turn_end` (or an abort) = *finished*; `session.shutdown` = *ended*. A session is **open** only while a live process holds its lock (the lock file must not be older than the process, so a reused pid does not count): crashes and closed windows leave stale locks and logs without a shutdown, and read as ended. The VS Code runtime keeps every session it ever opened locked while it runs, so *finished* ones untouched for 2 days are not offered. The name is the session's own (`workspace.yaml` `name`, the title Copilot gave it). Process checks are shared with Claude (`proc.rs`). Demo: two made-up sessions. Known gap: how a question Copilot asks in a chat (not a tool permission) shows in the log is not confirmed, so *needs you* is only reliable for permission prompts; check against a real one.
- **Session rows are short, the rest is behind an arrow**: a drawer row (any plugin: `Entry.label` + `Entry.details`) shows a bold label and one line, and a ▾ at its right (or **D** / Space on the selected row) opens a tiny popup with the rest (Esc closes it first). Sessions use it: the label is the working folder, the line is the first line of the session's name cut at 90 characters (Copilot names are the whole first prompt, often 500 characters), then where it runs, its state and the branch; the popup has the full name, the folder path, where, state, branch and id. Toasts and the item's title use the short form too.
