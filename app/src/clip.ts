import type { Node } from './store';

/** Copy / paste format: a nested markdown list. One item per bullet, extra title lines indented under it.
 *    - [ ] Write the spec
 *      second line of the same item
 *      - [x] A sub-item
 *  `[x]` done, `[-]` dropped. Plain lines and `*`, `+`, `1.` bullets are accepted when pasting. */
export interface ClipItem {
  title: string;
  done: boolean;
  dropped: boolean;
  kids: ClipItem[];
}

export function toMarkdown(items: ClipItem[], depth = 0): string {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  for (const it of items) {
    const mark = it.done ? 'x' : it.dropped ? '-' : ' ';
    const [first, ...rest] = it.title.split('\n');
    out.push(`${pad}- [${mark}] ${first}`);
    for (const l of rest) if (l.trim()) out.push(`${pad}  ${l}`);
    if (it.kids.length) out.push(toMarkdown(it.kids, depth + 1));
  }
  return out.join('\n');
}

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
    kids: nodes.filter((c) => c.parentId === n.id).map(build),
  });
  return nodes.filter((n) => want.has(n.id) && !hasAncestor(n)).map(build);
}

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[( |x|X|-)\]\s*)?(.*)$/;

export function parseMarkdown(text: string): ClipItem[] {
  const root: ClipItem[] = [];
  const stack: { indent: number; item: ClipItem }[] = [];
  for (const raw of text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
    if (!raw.trim()) continue;
    const m = BULLET.exec(raw);
    const indent = (m ? m[1] : /^\s*/.exec(raw)![0]).length;
    const top = stack[stack.length - 1];
    if (!m && top && indent > top.indent) {
      top.item.title += '\n' + raw.trim(); // continuation of the item above
      continue;
    }
    const item: ClipItem = m
      ? { title: m[3].trim(), done: m[2] === 'x' || m[2] === 'X', dropped: m[2] === '-', kids: [] }
      : { title: raw.trim().replace(/^#{1,6}\s+/, ''), done: false, dropped: false, kids: [] };
    if (!item.title) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    (stack.length ? stack[stack.length - 1].item.kids : root).push(item);
    stack.push({ indent, item });
  }
  return root;
}

export const countItems = (items: ClipItem[]): number => items.reduce((n, i) => n + 1 + countItems(i.kids), 0);

/** inbox items are flat text: sub-items travel as a bullet list inside the text */
export const flatten = (it: ClipItem): string => [it.title, ...(it.kids.length ? [toMarkdown(it.kids).replace(/^- \[ \] /gm, '- ').replace(/^( *)- \[[x-]\] /gm, '$1- ')] : [])].join('\n');
