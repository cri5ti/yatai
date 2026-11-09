/**
 * Display controls: UI scale and row density. They act at once (no Save). Used in the footer's small pop-over and in
 * Settings → Display; through `act`, so they work from the settings popup window too.
 */
import { useEffect, useRef, useState } from 'react';
import { DENSITIES, SCALES, useS } from './store';
import { act } from './act';
import { cx } from './kbd';

const DENS = ['Tight', 'Normal', 'Roomy'];

function DensityIcon({ i }: { i: number }) {
  return (
    <svg width="16" height="13" viewBox="0 0 12 10" aria-hidden>
      {[0, 1, 2].map((k) => (
        <rect key={k} x="0" y={[0.5, 3.5, 6.5][k] + (i - 1) * (k - 1) * -1.2} width="12" height="1.4" rx=".7" fill="currentColor" />
      ))}
    </svg>
  );
}

/** the two button groups; `labels`: name the density steps (Settings has the room) */
export function DisplayControls({ labels = false }: { labels?: boolean }) {
  const s = useS();
  return (
    <div className="dispctl">
      <div className="dispgrp">
        <span className="displbl">Scale</span>
        <div className="ugrp" role="group" aria-label="Scale">
          {SCALES.map((v, i) => (
            <button key={v} className={s.scale === i ? 'on' : ''} aria-pressed={s.scale === i} title={`Scale ${Math.round(v * 100)}%`} onClick={() => act.setScale(i)}>
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>
      </div>
      <div className="dispgrp">
        <span className="displbl">Density</span>
        <div className="ugrp" role="group" aria-label="Density">
          {DENSITIES.map((_, i) => (
            <button key={i} className={s.density === i ? 'on' : ''} aria-pressed={s.density === i} title={`${DENS[i]} rows`} aria-label={`${DENS[i]} rows`} onClick={() => act.setDensity(i)}>
              <DensityIcon i={i} />
              {labels && <span>{DENS[i]}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** the footer's button: a small pop-over above it with the display controls; Esc / a click elsewhere closes it */
export function DisplayButton() {
  const [at, setAt] = useState<{ right: number; bottom: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => !pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setAt(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setAt(null));
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('blur', () => setAt(null), { once: true });
    return () => (window.removeEventListener('pointerdown', away, true), window.removeEventListener('keydown', esc, true));
  }, [at]);
  const toggle = () => {
    if (at) return setAt(null);
    const r = btn.current!.getBoundingClientRect();
    setAt({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 6 });
  };
  return (
    <>
      <button ref={btn} className={cx('dispbtn', at && 'on')} aria-expanded={!!at} aria-haspopup="dialog" title="Display: scale and density" onClick={toggle}>
        <span aria-hidden>Aa</span>
      </button>
      {at && (
        <div ref={pop} className="disppop" role="dialog" aria-label="Display" style={{ right: at.right, bottom: at.bottom }}>
          <DisplayControls />
        </div>
      )}
    </>
  );
}
