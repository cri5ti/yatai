// Headless integration checks: node scripts/check-plugins.cjs (or bun scripts/check-plugins.cjs)
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const path = require('node:path');
const result = buildSync({
  stdin: { contents: `export * from './src/plugins/codex/map';
    export * from './src/plugins/quota';
    export { PLUGINS, implFor } from './src/plugins/registry';
    export { get, set } from './src/store';
    export { setQuotas } from './src/plugins/requests';
    export { trackedRefs, changes } from './src/plugins/tracker';`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
global.requestAnimationFrame = () => 0;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(bundled, bundled.exports, require);
const p = bundled.exports;
const now = Date.now();
const session = { sessionId: 'a', cwd: '/work/api', name: 'api', client: 'codex_cli_rs', branch: '', state: 'working', stateAt: now };
const rows = p.entriesOf([session, { ...session, sessionId: 'old', state: 'idle', stateAt: now - 3 * 86400000 }, { ...session, sessionId: 'ended', state: 'ended' }], now);
assert.equal(rows.length, 1);
assert.equal(rows[0].ref, 'codex:a');
assert.equal(rows[0].lead.kind, 'codex');
assert.equal(rows[0].canInbox, false);
const working = p.snapshotOf(session);
const finished = p.snapshotOf({ ...session, state: 'idle', stateAt: now + 1 });
assert.equal(p.changes(working, finished).length, 1);
assert.equal(p.changes(finished, finished).length, 0);
assert.equal(p.endedSnapshot('codex:a', working).view.glyph, 'ended');
assert.deepEqual(p.trackedRefs({ nodes: [{ id: 'n', title: 'Codex: api', today: true, status: 'waiting', smart: { source: 'ai', ref: 'codex:a' } }] }).get('codex'), ['codex:a']);
for (const id of ['claude', 'copilot', 'codex']) {
  const plugin = p.PLUGINS.find(x => x.id === id);
  const state = { ...p.get(), demo: true };
  assert.equal(p.implFor(plugin, state), plugin.mock);
  assert.equal(p.implFor(plugin, { ...state, settings: { ...state.settings, sources: { [id]: { on: false } } } }), null);
}
const q = { left: 75, limit: 100, reset: now + 60000, label: '5h', observedAt: now };
p.setQuotas('codex', [q, { ...q, label: '7d' }]);
assert.equal(p.quotaWindows(p.get().reqs.codex).length, 2);
assert.equal(p.quotaView(q, now).percent, 75);
assert.equal(p.quotaView({ ...q, left: 0 }, now).percent, 0);
assert.equal(p.quotaView({ ...q, left: 200 }, now).percent, 100);
assert.equal(p.quotaView(q, now + 60001).percent, null);
assert.equal(p.quotaView(q, now + 60001).expired, true);
assert.equal(p.quotaView({ ...q, limit: 0 }, now).percent, null);
assert.equal(p.quotaView(undefined, now).percent, null);
assert.equal(p.quotaWindows({ at: [], total: 0, quota: q }).length, 1);
p.setQuotas('codex', []);
assert.equal(p.quotaWindows(p.get().reqs.codex).length, 0);
console.log('Plugin checks passed: tracking, state changes, harness switches and quota windows.');
