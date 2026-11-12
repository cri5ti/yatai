import { useEffect, useState } from 'react';
import type { ReqCount } from './store';
import { quotaView, quotaWindows } from './plugins/quota';

/** One track per reported quota window; sources without a quota get a neutral track. */
export function QuotaBar({ r, compact = false }: { r?: ReqCount; compact?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const windows = quotaWindows(r);
  return <span className={`quota ${compact ? 'compact' : 'detailed'}`}>
    {(windows.length ? windows : [undefined]).map((q, i) => {
      const v = quotaView(q, now);
      return <span className="quota-window" key={i} title={v.tip}>
        {!compact && <span className="quota-label"><span>{v.label} · {v.detail}</span>{v.reset && <span>{v.expired ? 'Reset' : 'Resets'} {v.reset}</span>}</span>}
        <span className={`quota-track${v.percent === null ? ' unknown' : v.percent < 10 ? ' low' : ''}`}
          role={v.percent === null ? 'img' : 'meter'} aria-label={v.tip}
          aria-valuemin={v.percent === null ? undefined : 0} aria-valuemax={v.percent === null ? undefined : 100} aria-valuenow={v.percent ?? undefined}>
          {v.percent !== null && <span className="quota-fill" style={{ width: `${v.percent}%` }} />}
        </span>
      </span>;
    })}
  </span>;
}
