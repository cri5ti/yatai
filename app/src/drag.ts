import { useEffect, useRef } from 'react';

/**
 * End an in-page drag for sure. The dragged element is often gone by the time the drag ends (the drop moved it
 * to another card, or filed it away), so it never gets its own dragend and the view would keep it see-through.
 * While `active`, anything that comes after a drag ends it: a drop or dragend anywhere, the next mouse move
 * (none fire during a drag), or the window losing focus.
 */
export function useDragEnd(active: boolean, end: () => void) {
  const fn = useRef(end);
  fn.current = end;
  useEffect(() => {
    if (!active) return;
    const now = () => fn.current();
    const later = () => setTimeout(now, 0); // after the drop handlers have run
    window.addEventListener('drop', later);
    window.addEventListener('dragend', later, true);
    window.addEventListener('mousemove', now);
    window.addEventListener('blur', now);
    return () => {
      window.removeEventListener('drop', later);
      window.removeEventListener('dragend', later, true);
      window.removeEventListener('mousemove', now);
      window.removeEventListener('blur', now);
    };
  }, [active]);
}
