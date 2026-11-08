# yatai

Yet Another Todo App, but with AI: a very lightweight desktop app (Tauri 2, React, SQLite) whose default state is a thin window with what to do next today. It also watches things that live elsewhere (GitHub pull requests, Outlook meetings, Azure DevOps work items) and tells you when something needs you.

Status: early, built for personal use; expect rough edges. Mostly run on macOS; Windows and Linux are untested in places.

```
design/   design documents: start with design/design.md
app/      the desktop app: see app/README.md to run it, app/todo.md for what is left
poc/      the original UX prototype (React + Vite, mocked data)
```

Quick start:

```sh
cd app
bun install
bun run app        # the desktop app (needs Rust, see app/src-tauri/rust-toolchain.toml)
bun run dev        # the same UI in a browser
```

AI features need an OpenAI-compatible API key (Settings, ⌘,). GitHub and Outlook need a token / calendar link (Settings → Accounts). Everything stays on your machine; secrets go to the OS keychain.
