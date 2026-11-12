// Run with node scripts/check-plan.cjs (or bun scripts/check-plan.cjs).
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const path = require('node:path');

const result = buildSync({
  stdin: { contents: "export * from './src/model'; export * from './src/actions'; export { get, set, resetDoc } from './src/store';", resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
global.requestAnimationFrame = () => 0;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(bundled, bundled.exports, require);
const { ROOT, reconcilePlan, nextModel, get, set, resetDoc, outdentItems, moveNode, dropOnRow, dropRowSplit, consolidate, undo, redo } = bundled.exports;
const node = (id, parentId = null, today = true) => ({ id, parentId, title: id, today, status: 'todo', open: true, created: 0, modified: 0 });
const unique = (ids, message) => assert.equal(new Set(ids).size, ids.length, message);
function check() {
  const s = get();
  const plan = reconcilePlan(s.plan, s.nodes, s.meetings);
  unique(plan.map(sg => sg.id), 'unique segment IDs');
  unique(plan.flatMap(sg => sg.items), 'unique planned items');
  assert.deepEqual(reconcilePlan(plan, s.nodes, s.meetings), plan, 'reconciliation is stable');
  const cards = nextModel(s).cards;
  unique(cards.map(c => c.key), 'unique React card keys');
  for (const c of cards) unique(c.rows.map(r => r.id), 'unique row keys within card');
  const visible = cards.flatMap(c => c.rows.filter(r => r.node && !r.head).map(r => r.id));
  assert.deepEqual(visible.slice().sort(), s.nodes.filter(n => n.today).map(n => n.id).sort(), 'every planned item appears exactly once, excluding repeated split headers');
  return plan;
}
function load(nodes, plan = []) {
  resetDoc({ nodes, plan, meetings: [], inbox: [], current: null }, false);
}

load([node('a'), node('b'), node('c')]);
check();

// Moving a child out while its own children retain the old owner card ID.
load([node('parent', null, false), node('child', 'parent', false), node('leaf', 'child')], [
  { id: 's_child', owner: 'child', items: ['leaf'] },
]);
set(s => ({ nodes: s.nodes.map(n => n.id === 'child' ? { ...n, today: true } : n) }));
outdentItems(['child']);
check();

// Existing split IDs must not collide with IDs generated when roots split apart.
load([node('a'), node('b'), node('c')], [
  { id: 's_b', owner: ROOT, items: ['a', 'b'] },
  { id: 's_b_2', owner: ROOT, items: ['c'] },
]);
const repaired = check();
assert.equal(repaired[2].id, 's_b_2', 'preserve an existing non-conflicting ID');
assert.deepEqual(get().plan[0].items, ['a', 'b'], 'rendering does not mutate stored plan');

// Repair legacy duplicate IDs without losing any rows or their order.
load([node('a'), node('b'), node('c')], [
  { id: 's_same', owner: ROOT, items: ['a'] },
  { id: 's_same', owner: ROOT, items: ['b'] },
  { id: 's_same_2', owner: ROOT, items: ['c'] },
]);
assert.deepEqual(check().flatMap(sg => sg.items), ['a', 'b', 'c']);

load([node('parent'), node('a', 'parent'), node('b', 'parent'), node('other')]);
set(() => ({ plan: check() }));
dropRowSplit('a', nextModel(get()).cards.at(-1).key, 'after');
check();
consolidate(nextModel(get()).cards.find(c => c.seg?.pulled).key);
check();
dropRowSplit('a', nextModel(get()).cards.at(-1).key, 'after');
check();
outdentItems(['a', 'b']);
check();
unique(get().plan.map(sg => sg.id), 'outdent stores unique IDs');
undo(); check();
redo(); check();
moveNode('a', 'parent', null); check();
dropOnRow('b', 'a', 'after', null); check();
dropOnRow('a', 'other', 'after', null); check();

// A repeatable sequence of tree moves exercises stale plans and reused owner IDs.
load(Array.from({ length: 12 }, (_, i) => node(`n${i}`, i > 3 ? `n${i % 4}` : null)));
let seed = 12345;
const pick = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
for (let i = 0; i < 150; i++) {
  const nodes = get().nodes;
  const a = nodes[pick(nodes.length)];
  const b = nodes[pick(nodes.length)];
  if (i % 3 === 0) moveNode(a.id, pick(2) ? b.id : null, null);
  else if (i % 3 === 1 && a.parentId) outdentItems([a.id]);
  else dropOnRow(a.id, b.id, ['before', 'after', 'into'][pick(3)], null);
  const plan = check();
  if (i % 5 === 0) set(() => ({ plan })); // like a later action saving the reconciled view
}
console.log('Plan rendering and move regression checks passed');
