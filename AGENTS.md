# Working on yatai

## Layout

- `spec/`: design docs (`spec/design/design.md`)
- `poc/`: the React UX prototype. It is frozen and serves as the UX playground.
- `app/`: the desktop app (Tauri 2 + Vite + React + Bun, SQLite). See `app/README.md` for how to run it and `app/todo.md` for what's left.

## Commits

- Commit often while working, so the history leaves a trail of the steps taken. Commit after each step that works: one feature, one fix, or one refactor that type-checks and builds. Don't save everything for a single commit at the end.
- Commit on `main` unless asked to branch. Write a short subject line (`app: …`, `poc: …`, `spec: …`), then a few lines on what changed and why.
- Before committing, run `bunx tsc --noEmit` and `bun run build` in `app/`. When Rust changed, also run `cargo check` (and `cargo test`) in `app/src-tauri`.
- Never commit `.env` files, `src-tauri/target`, or `node_modules`.

## Verifying

- Check UI changes headlessly: type-check, build, and run small esbuild + node scripts against the store and actions.
- Don't drive a browser to test the UI unless asked. The user tests the UI by hand. List anything that can't be checked headlessly under "Check by hand" in `app/todo.md`.
