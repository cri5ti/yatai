import type { Node } from './store';

/** Copy / paste format: top-level items are plain lines (no bullet) with a blank line between them; their
 *  sub-items are a nested markdown list, extra title lines indented under their item.
 *    [ ] Write the spec
 *      second line of the same item
 *      - [x] A sub-item
 *
 *    [ ] Another top-level item
 *  `[x]` done, `[-]` dropped. Plain lines and `-`, `*`, `+`, `1.` bullets are accepted when pasting, at any level.
 *  Metadata rides at the end of the first line: `[ ] Write the spec @est:1h30m @due:2026-11-12`
 *  (`@est:` takes 45m / 1h / 1h30m / 1.5h / plain minutes; `@due:` an ISO date). #tags are just part of the title. */
export interface ClipItem {
  title: string;
  done: boolean;
  dropped: boolean;
  est?: number; // minutes
  due?: string; // yyyy-mm-dd
  kids: ClipItem[];
}

export const fmtEst = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`);
export function parseEst(t: string): number | undefined {
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m?)?$/i.exec(t);
  if (!m || (m[1] == null && m[2] == null)) return undefined;
  const v = Math.round(parseFloat(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0', 10));
  return v > 0 ? v : undefined;
}
const META = /\s+@(est|due):(\S+)\s*$/i;
/** the first line without its trailing @est: / @due: tokens (they only count at the very end, and never leave the title empty) */
function splitMeta(first: string): { title: string; est?: number; due?: string } {
  let title = first;
  let est: number | undefined;
  let due: string | undefined;
  for (;;) {
    const m = META.exec(title);
    if (!m || !title.slice(0, m.index).trim()) break;
    if (m[1].toLowerCase() === 'est') {
      const v = parseEst(m[2]);
      if (v == null) break;
      est ??= v;
    } else {
      if (!/^\d{4}-\d\d-\d\d$/.test(m[2])) break;
      due ??= m[2];
    }
    title = title.slice(0, m.index);
  }
  return { title: title.trimEnd(), est, due };
}

function lines(items: ClipItem[], depth: number, plainTop: boolean): string[] {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  for (const it of items) {
    const mark = it.done ? 'x' : it.dropped ? '-' : ' ';
    const [first, ...rest] = it.title.split('\n');
    const meta = [it.est ? `@est:${fmtEst(it.est)}` : '', it.due ? `@due:${it.due}` : ''].filter(Boolean).join(' ');
    out.push(`${pad}${depth === 0 && plainTop ? '' : '- '}[${mark}] ${first}${meta ? ` ${meta}` : ''}`);
    for (const l of rest) if (l.trim()) out.push(`${pad}  ${l}`);
    out.push(...lines(it.kids, depth + 1, plainTop));
  }
  return out;
}
/** the clipboard / editor text: top-level items without a bullet, a blank line between them */
export const toMarkdown = (items: ClipItem[]): string => items.map((it) => lines([it], 0, true).join('\n')).join('\n\n');
/** a plain bullet list (every level has its `- `) */
export const toBulletList = (items: ClipItem[]): string => lines(items, 0, false).join('\n');

/** the given items (nested ones whose ancestor is also given are covered by it) with their whole subtrees */
export function treeOf(nodes: Node[], ids: string[], isDone: (id: string) => boolean): ClipItem[] {
  const want = new Set(ids);
  const hasAncestor = (n: Node) => {
    for (let p = nodes.find((x) => x.id === n.parentId); p; p = nodes.find((x) => x.id === p!.parentId)) if (want.has(p.id)) return true;
    return false;
  };
  const build = (n: Node): ClipItem => ({
    title: n.title,
    done: isDone(n.id),
    dropped: n.status === 'dropped',
    est: n.est,
    due: n.due,
    kids: nodes.filter((c) => c.parentId === n.id).map(build),
  });
  return nodes.filter((n) => want.has(n.id) && !hasAncestor(n)).map(build);
}

const LINE = /^(\s*)(?:([-*+]|\d+[.)])\s+)?(?:\[( |x|X|-)\]\s*)?(.*)$/;

export function parseMarkdown(text: string): ClipItem[] {
  const root: ClipItem[] = [];
  const stack: { indent: number; item: ClipItem }[] = [];
  for (const raw of text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
    if (!raw.trim()) continue;
    const m = LINE.exec(raw)!;
    const indent = m[1].length;
    const top = stack[stack.length - 1];
    // an item has a bullet, or a [ ] box at the left (an indented box without a bullet is just text in the item above)
    const isItem = !!m[2] || (m[3] !== undefined && (!top || indent <= top.indent));
    if (!isItem && top && indent > top.indent) {
      top.item.title += '\n' + raw.trim(); // continuation of the item above
      continue;
    }
    const { title, est, due } = splitMeta(isItem ? m[4].trim() : raw.trim().replace(/^#{1,6}\s+/, ''));
    if (!title) continue;
    const item: ClipItem = { title, done: isItem && (m[3] === 'x' || m[3] === 'X'), dropped: isItem && m[3] === '-', kids: [] };
    if (est) item.est = est;
    if (due) item.due = due;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    (stack.length ? stack[stack.length - 1].item.kids : root).push(item);
    stack.push({ indent, item });
  }
  return root;
}

export const countItems = (items: ClipItem[]): number => items.reduce((n, i) => n + 1 + countItems(i.kids), 0);

/** inbox items are flat text: sub-items travel as a bullet list inside the text */
export const flatten = (it: ClipItem): string => [it.title, ...(it.kids.length ? [toBulletList(it.kids).replace(/^- \[ \] /gm, '- ').replace(/^( *)- \[[x-]\] /gm, '$1- ')] : [])].join('\n');
