import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const mine = new WeakMap<Element, Animation>();
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Snap = Map<string, [number, number]>;

let quietUntil = 0;
/** layout changes that are not "things moving" (UI scale, density): don't animate them */
export const quietFlip = (ms = 250) => (quietUntil = Date.now() + ms);

/**
 * positions relative to the root (+ its scroll offset), in the root's own CSS pixels.
 * Dividing by the zoom factor means changing the UI scale never looks like movement, and a transform
 * applied to an element lands exactly where intended even inside a CSS-zoomed ancestor.
 */
function measure(root: HTMLElement, attr: string): Snap {
  const rb = root.getBoundingClientRect();
  const z = root.offsetWidth ? rb.width / root.offsetWidth || 1 : 1;
  const out: Snap = new Map();
  root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
    const r = el.getBoundingClientRect();
    out.set(el.getAttribute(attr)!, [(r.left - rb.left) / z + root.scrollLeft, (r.top - rb.top) / z + root.scrollTop]);
  });
  return out;
}

/**
 * FLIP animation for reordering: elements inside `ref` carrying `[attr]="<stable id>"` glide from
 * their previous position to the new one whenever the component re-renders.
 *
 * The "previous" snapshot is taken after every render AND whenever a CSS transition/animation inside
 * the root settles (collapse/expand shifts things around without any re-render). Without the second
 * part, the next re-render would animate from positions that were stale before the collapse happened.
 */
export function useFlip(ref: RefObject<HTMLElement>, attr: string) {
  const prev = useRef<Snap>(new Map());
  const running = useRef(0);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => mine.get(el)?.cancel());
    const next = measure(root, attr);
    if (!reduce() && Date.now() > quietUntil) {
      root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
        const id = el.getAttribute(attr)!;
        const p = prev.current.get(id);
        const n = next.get(id)!;
        if (!p) return;
        const dx = p[0] - n[0];
        const dy = p[1] - n[1];
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        const a = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        mine.set(el, a);
        running.current++;
        a.finished.catch(() => {}).finally(() => (running.current = Math.max(0, running.current - 1)));
      });
    }
    prev.current = next;
  });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const settle = (e: Event) => {
      if (e.type === 'transitionend' && !/grid-template-rows|height/.test((e as TransitionEvent).propertyName)) return;
      if (running.current) return;
      prev.current = measure(root, attr);
    };
    const resync = () => {
      if (!running.current) prev.current = measure(root, attr);
    };
    window.addEventListener('flip-resync', resync);
    root.addEventListener('transitionend', settle);
    root.addEventListener('animationend', settle);
    return () => {
      window.removeEventListener('flip-resync', resync);
      root.removeEventListener('transitionend', settle);
      root.removeEventListener('animationend', settle);
    };
  }, []);
}
