/** Small keyboard helpers shared by every view. */

/** ⌘ on mac, Ctrl elsewhere */
export const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

export const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Return keyboard focus to the active view's list (after menus / popups / inline edits close). */
export function focusArea() {
  requestAnimationFrame(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && isEditable(a)) return; // something else (e.g. an inline editor) already took focus
    (document.querySelector('[data-kbd-area]') as HTMLElement | null)?.focus({ preventScroll: true });
  });
}

/** Estimate steps (minutes) — shift+←/→ scrolls through these. */
export const EST_STEPS = [5, 15, 30, 60, 120, 240, 480];
/** Digit shortcuts in the /estimate submenu */
export const EST_KEYS: [string, number][] = [
  ['1', 5],
  ['2', 15],
  ['3', 30],
  ['4', 60],
  ['5', 120],
  ['6', 240],
  ['8', 480],
];

export function stepEst(cur: number | undefined, dir: 1 | -1): number | undefined {
  if (dir === 1) return EST_STEPS.find((v) => v > (cur ?? 0)) ?? cur;
  if (cur == null) return undefined;
  return [...EST_STEPS].reverse().find((v) => v < cur); // undefined => cleared
}

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
