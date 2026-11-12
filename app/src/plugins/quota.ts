import type { Quota, ReqCount } from '../store';

export function quotaWindows(r?: ReqCount): Quota[] {
  return r?.quotas ?? (r?.quota ? [r.quota] : []);
}

/** An expired reading is unknown, never a fresh full allowance or an exhausted one. */
export function quotaView(q: Quota | undefined, now: number) {
  const valid = !!q && Number.isFinite(q.left) && Number.isFinite(q.limit) && q.limit > 0;
  const expired = valid && q.reset > 0 && q.reset <= now;
  const percent = valid && !expired ? Math.max(0, Math.min(100, q.left / q.limit * 100)) : null;
  const reset = q?.reset && Number.isFinite(q.reset) ? new Date(q.reset).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const amount = percent === null ? expired ? 'Awaiting fresh usage' : 'Quota not reported' : `${Math.round(percent)}% left`;
  const detail = percent === null ? amount : q!.label ? amount : `${q!.left.toLocaleString()} / ${q!.limit.toLocaleString()} left`;
  const label = q?.label ?? 'Quota';
  const tip = `${label}: ${detail}${reset ? ` · ${expired ? 'reset was' : 'resets'} ${reset}` : ''}${q?.observedAt ? ` · reported ${new Date(q.observedAt).toLocaleTimeString()}` : ''}`;
  return { percent, expired, label, amount, detail, tip, reset };
}
