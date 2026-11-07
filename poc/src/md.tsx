import type { ReactNode } from 'react';
import { prMatch } from './model';
import { PrRef } from './Pr';

/* Basic markdown: **bold**, *italic*, `code`, urls, - lists, 1. lists, - [ ] checkboxes */

const INLINE_SRC =
  '(`[^`]+`|\\*\\*[^*]+\\*\\*|__[^_]+__|\\*[^*\\s][^*]*\\*|(?<![\\w])_[^_\\s][^_]*_(?![\\w])|https?:\\/\\/[^\\s)]*[^\\s).,;:!?])';

const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export function inline(text: string, kp = 'i', prIcon = true): ReactNode[] {
  const re = new RegExp(INLINE_SRC, 'g');
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${kp}${i++}`;
    if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**') || t.startsWith('__')) out.push(<strong key={key}>{inline(t.slice(2, -2), key, prIcon)}</strong>);
    else if (t.startsWith('http') && prMatch(t)) {
      const pm = prMatch(t)!;
      out.push(<PrRef key={key} url={t} org={pm[1]} repo={pm[2]} num={pm[3]} icon={prIcon} />);
    } else if (t.startsWith('http'))
      out.push(
        <a key={key} href={t} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {short(t)}
        </a>,
      );
    else out.push(<em key={key}>{inline(t.slice(1, -1), key, prIcon)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const CHECK = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUM = /^\s*\d+[.)]\s+(.*)$/;

export interface BodyInfo {
  first: string;
  rest: string[];
  checks: { done: number; total: number };
}

/** first line is always visible; everything after is the (smaller) body */
export function bodyInfo(text: string): BodyInfo {
  const [first, ...rest] = text.split('\n');
  let done = 0;
  let total = 0;
  for (const l of rest) {
    const m = CHECK.exec(l);
    if (m) {
      total++;
      if (m[1] !== ' ') done++;
    }
  }
  return { first, rest, checks: { done, total } };
}

export function toggleLine(text: string, idx: number): string {
  const lines = text.split('\n');
  lines[idx] = lines[idx].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

type Block =
  | { t: 'p'; text: string }
  | { t: 'ul'; items: { text: string; idx: number; check?: boolean; done?: boolean }[] }
  | { t: 'ol'; items: { text: string; idx: number }[] };

export function Md({ lines, offset, onToggle }: { lines: string[]; offset: number; onToggle?: (line: number) => void }) {
  const blocks: Block[] = [];
  lines.forEach((raw, i) => {
    const idx = offset + i;
    if (!raw.trim()) return;
    let m: RegExpExecArray | null;
    const last = blocks[blocks.length - 1];
    if ((m = CHECK.exec(raw))) {
      const it = { text: m[2], idx, check: true, done: m[1] !== ' ' };
      if (last?.t === 'ul') last.items.push(it);
      else blocks.push({ t: 'ul', items: [it] });
    } else if ((m = BULLET.exec(raw))) {
      const it = { text: m[1], idx };
      if (last?.t === 'ul') last.items.push(it);
      else blocks.push({ t: 'ul', items: [it] });
    } else if ((m = NUM.exec(raw))) {
      const it = { text: m[1], idx };
      if (last?.t === 'ol') last.items.push(it);
      else blocks.push({ t: 'ol', items: [it] });
    } else blocks.push({ t: 'p', text: raw });
  });
  return (
    <div className="md">
      {blocks.map((b, bi) => {
        if (b.t === 'p') return <p key={bi}>{inline(b.text, `p${bi}-`)}</p>;
        if (b.t === 'ol')
          return (
            <ol key={bi}>
              {b.items.map((it) => (
                <li key={it.idx}>{inline(it.text, `o${it.idx}-`)}</li>
              ))}
            </ol>
          );
        return (
          <ul key={bi}>
            {b.items.map((it) =>
              it.check ? (
                <li key={it.idx} className={`chk ${it.done ? 'done' : ''}`}>
                  <button
                    className={`cb ${it.done ? 'on' : ''}`}
                    tabIndex={-1}
                    aria-label={it.done ? 'Uncheck' : 'Check'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle?.(it.idx);
                    }}
                  >
                    {it.done ? '✓' : ''}
                  </button>
                  <span>{inline(it.text, `c${it.idx}-`)}</span>
                </li>
              ) : (
                <li key={it.idx}>{inline(it.text, `b${it.idx}-`)}</li>
              ),
            )}
          </ul>
        );
      })}
    </div>
  );
}
