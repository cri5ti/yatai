import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const mine = new WeakMap<Element, Animation>();
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * FLIP animation for reordering: elements inside `ref` carrying `[attr]="<stable id>"` glide from
 * their previous position to the new one whenever the component re-renders.
 * Positions are measured relative to the root (+ its scroll offset) so scrolling never triggers it.
 */
export function useFlip(ref: RefObject<HTMLElement>, attr: string) {
  const prev = useRef(new Map<string, [number, number]>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`));
    els.forEach((el) => mine.get(el)?.cancel());
    const rb = root.getBoundingClientRect();
    const next = new Map<string, [number, number]>();
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const pos: [number, number] = [r.left - rb.left + root.scrollLeft, r.top - rb.top + root.scrollTop];
      const id = el.getAttribute(attr)!;
      next.set(id, pos);
      const p = prev.current.get(id);
      if (p && !reduce()) {
        const dx = p[0] - pos[0];
        const dy = p[1] - pos[1];
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          mine.set(
            el,
            el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
              duration: 260,
              easing: 'cubic-bezier(.2,.8,.2,1)',
            }),
          );
        }
      }
    }
    prev.current = next;
  });
}
