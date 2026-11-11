# yatai — desktop app

The POC's UI as a real desktop app: Tauri 2 + Vite + React, data in SQLite. `poc/` stays as the UX playground.

```sh
bun install
bun run app       # the desktop app (tauri dev)
bun run dev       # the same UI in a browser at :5174 (localStorage, AI via the dev proxy)
bun run bundle    # release build → src-tauri/target/release/bundle
```

**Releases and auto-update.** `.github/workflows/app.yml` type-checks, builds and tests every PR; every push to `main` also publishes a signed NSIS installer + `latest.json` as a GitHub Release (version = `major.minor` from `tauri.conf.json` + the run number; bump the minor by hand for bigger releases). Installed builds read `releases/latest/download/latest.json` (endpoint and public key in `tauri.conf.json`), download updates in the background and ask for a restart. Needs the repo public and two Actions secrets: `TAURI_SIGNING_PRIVATE_KEY` (from `bunx tauri signer generate`; the matching public key is in `tauri.conf.json`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty). Dev builds never update.

```sh
```

Emails (Windows, classic Outlook) sorts mail on this PC: with Ollama (`ollama pull qwen3:4b-instruct-2507-q4_K_M`), or with the Laya decision model, set up once with `powershell -ExecutionPolicy Bypass -File sidecar\laya\setup.ps1` (a Python 3.12 venv in `%LOCALAPPDATA%\yatai\laya`; the app starts the helper when needed). Settings → Emails picks one.

The Rust toolchain is pinned in `src-tauri/rust-toolchain.toml` (Tauri 2.12 needs rustc ≥ 1.90).

## What changed from the POC

| POC (mocked) | App |
|---|---|
| Mock desktop, window layouts drawn in the page | The OS window: **dock** (right edge, full height), **float**, **large**, **pill** (always on top). What you resize / move it to is remembered per layout. |
| Taskbar tray icon | Menu-bar / system-tray icon: click to show/hide, inbox count beside it, menu with capture, settings, developer panel, quit. |
| Alt+Space / Alt+Y inside the page | Global hotkeys: **⌥Space** opens a small capture window over any app, **⌥Y** shows / hides (brings a buried window forward). If another app owns one, yatai says so and keeps running. |
| localStorage | SQLite at `~/Library/Application Support/dev.yatai.app/yatai.db` (Windows: `%APPDATA%\dev.yatai.app`). Only changed rows are written, ~250 ms after a change; pending writes are flushed on hide and quit. |
| `OPENAI_API_KEY` in `.env`, dev-server proxy | Settings (**⌘,**): key in the OS keychain, model, reasoning effort, base URL. Rust makes the API call, so the key never enters the webview. Debug builds also read `app/.env`. |
| Mock clock | Real time. At a new day, yesterday's meetings leave Next (their prep items stay) and items moved to "tomorrow" / "+N days" come back, highlighted. |
| Mock bar on the right | **Developer panel** (tray menu or **⌘⇧D**): demo connectors, load demo data / start empty, simulated clock, PR statuses, scenarios. |
| Settings, help, AI chat, drawers, mock bar as overlays in the page | Their own popup windows beside the main one (see `src/popups.ts`). The main window owns the state; popups get a copy and send actions back by name (`src/act.ts`). |
| Drawers full of fake data | Real GitHub (token) and Outlook (published calendar link) through the plugin system; Azure DevOps and AI sessions are still mocked (Developer panel → demo connectors). |

## Layout

```
src/              UI (from poc/src) + platform.ts (Tauri vs browser), persist.ts (SQLite sync), Settings, capture window
                  popups.ts / popup.tsx / act.ts: popup windows (add one: a line in VIEWS + its component in popup.tsx)
src-tauri/src/    lib.rs  shell: windows, tray, global shortcuts, quit-after-flush
                  db.rs   schema + migrations (PRAGMA user_version), whitelisted row writes
                  backup.rs  daily / frequent snapshots of the db (Settings → Database)
                  ai.rs   keychain + the OpenAI request
```

Schema: `item` (the one tree: projects / tasks / actions), `inbox`, `meeting` (with its `day`), `plan_seg` (Next's cards), `kv` (UI preferences). Add a migration by appending to `MIGRATIONS` in `db.rs`.

## Not built yet

Real Azure DevOps and AI-session connectors, Outlook through Microsoft Graph (the app reads a published calendar link today): see `design/plugins.md` and `app/todo.md`. OS notifications, launch at login, macOS / Linux release builds (CI builds the Windows installer only).
