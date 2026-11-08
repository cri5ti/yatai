/**
 * An iCalendar feed (Outlook's "publish a calendar" .ics) → the meetings of one day.
 * Handles what Outlook publishes: UTC / floating / TZID times (IANA names, Windows names such as
 * "GTB Standard Time", "(UTC+02:00)"), recurring series (RRULE: daily, weekly, monthly, yearly; COUNT, UNTIL,
 * EXDATE), moved or cancelled single instances (RECURRENCE-ID), STATUS:CANCELLED. All-day events are left out.
 * Pure: no network, no clock; the time zone of "the day" is a parameter.
 */
import type { AgendaEvent } from '../types';

/** Windows zone names (what Outlook writes) → IANA */
const WIN: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12', 'UTC-11': 'Etc/GMT+11', 'Aleutian Standard Time': 'America/Adak', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas', 'Alaskan Standard Time': 'America/Anchorage', 'UTC-09': 'Etc/GMT+9', 'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8', 'Pacific Standard Time': 'America/Los_Angeles', 'US Mountain Standard Time': 'America/Phoenix', 'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver', 'Yukon Standard Time': 'America/Whitehorse', 'Central America Standard Time': 'America/Guatemala', 'Central Standard Time': 'America/Chicago',
  'Easter Island Standard Time': 'Pacific/Easter', 'Central Standard Time (Mexico)': 'America/Mexico_City', 'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota', 'Eastern Standard Time (Mexico)': 'America/Cancun', 'Eastern Standard Time': 'America/New_York', 'Haiti Standard Time': 'America/Port-au-Prince',
  'Cuba Standard Time': 'America/Havana', 'US Eastern Standard Time': 'America/Indiana/Indianapolis', 'Turks And Caicos Standard Time': 'America/Grand_Turk', 'Paraguay Standard Time': 'America/Asuncion',
  'Atlantic Standard Time': 'America/Halifax', 'Venezuela Standard Time': 'America/Caracas', 'Central Brazilian Standard Time': 'America/Cuiaba', 'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago', 'Newfoundland Standard Time': 'America/St_Johns', 'Tocantins Standard Time': 'America/Araguaina', 'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne', 'Argentina Standard Time': 'America/Argentina/Buenos_Aires', 'Greenland Standard Time': 'America/Nuuk', 'Montevideo Standard Time': 'America/Montevideo',
  'Magallanes Standard Time': 'America/Punta_Arenas', 'Saint Pierre Standard Time': 'America/Miquelon', 'Bahia Standard Time': 'America/Bahia', 'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores', 'Cape Verde Standard Time': 'Atlantic/Cape_Verde', UTC: 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Sao Tome Standard Time': 'Africa/Sao_Tome', 'Morocco Standard Time': 'Africa/Casablanca', 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris', 'Central European Standard Time': 'Europe/Warsaw', 'W. Central Africa Standard Time': 'Africa/Lagos', 'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut', 'Egypt Standard Time': 'Africa/Cairo', 'E. Europe Standard Time': 'Europe/Chisinau', 'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron', 'South Africa Standard Time': 'Africa/Johannesburg', 'FLE Standard Time': 'Europe/Kyiv', 'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad', 'Sudan Standard Time': 'Africa/Khartoum', 'Libya Standard Time': 'Africa/Tripoli', 'Namibia Standard Time': 'Africa/Windhoek',
  'Jordan Standard Time': 'Asia/Amman', 'Arabic Standard Time': 'Asia/Baghdad', 'Turkey Standard Time': 'Europe/Istanbul', 'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk', 'Russian Standard Time': 'Europe/Moscow', 'E. Africa Standard Time': 'Africa/Nairobi', 'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai', 'Astrakhan Standard Time': 'Europe/Astrakhan', 'Azerbaijan Standard Time': 'Asia/Baku', 'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius', 'Saratov Standard Time': 'Europe/Saratov', 'Georgian Standard Time': 'Asia/Tbilisi', 'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul', 'West Asia Standard Time': 'Asia/Tashkent', 'Ekaterinburg Standard Time': 'Asia/Yekaterinburg', 'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata', 'Sri Lanka Standard Time': 'Asia/Colombo', 'Nepal Standard Time': 'Asia/Kathmandu', 'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka', 'Omsk Standard Time': 'Asia/Omsk', 'Myanmar Standard Time': 'Asia/Yangon', 'SE Asia Standard Time': 'Asia/Bangkok',
  'Altai Standard Time': 'Asia/Barnaul', 'W. Mongolia Standard Time': 'Asia/Hovd', 'North Asia Standard Time': 'Asia/Krasnoyarsk', 'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Tomsk Standard Time': 'Asia/Tomsk', 'China Standard Time': 'Asia/Shanghai', 'North Asia East Standard Time': 'Asia/Irkutsk', 'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth', 'Taipei Standard Time': 'Asia/Taipei', 'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar', 'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita', 'Tokyo Standard Time': 'Asia/Tokyo', 'North Korea Standard Time': 'Asia/Pyongyang', 'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'AUS Central Standard Time': 'Australia/Darwin', 'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'West Pacific Standard Time': 'Pacific/Port_Moresby', 'Tasmania Standard Time': 'Australia/Hobart', 'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe', 'Bougainville Standard Time': 'Pacific/Bougainville', 'Russia Time Zone 10': 'Asia/Srednekolymsk', 'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk', 'Sakhalin Standard Time': 'Asia/Sakhalin', 'Central Pacific Standard Time': 'Pacific/Guadalcanal', 'Russia Time Zone 11': 'Asia/Kamchatka',
  'New Zealand Standard Time': 'Pacific/Auckland', 'UTC+12': 'Etc/GMT-12', 'Fiji Standard Time': 'Pacific/Fiji', 'Kamchatka Standard Time': 'Asia/Kamchatka',
  'Chatham Islands Standard Time': 'Pacific/Chatham', 'UTC+13': 'Etc/GMT-13', 'Tonga Standard Time': 'Pacific/Tongatapu', 'Samoa Standard Time': 'Pacific/Apia', 'Line Islands Standard Time': 'Pacific/Kiritimati',
};

/* ---------- time zones ---------- */
type Zone = { kind: 'iana'; name: string } | { kind: 'fixed'; min: number } | { kind: 'utc' } | { kind: 'local' };
const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })));
  return f;
};
const validIana = (n: string) => {
  try {
    fmt(n);
    return true;
  } catch {
    return false;
  }
};
export function resolveZone(tzid: string | undefined): Zone {
  if (!tzid) return { kind: 'local' };
  const n = tzid.replace(/^"|"$/g, '').trim();
  if (/^(UTC|GMT|Z)$/i.test(n)) return { kind: 'utc' };
  if (validIana(n) && !/ /.test(n)) return { kind: 'iana', name: n };
  if (WIN[n]) return { kind: 'iana', name: WIN[n] };
  const o = /(?:UTC|GMT)\s*([+-])(\d{1,2}):?(\d{2})?/.exec(n); // "(UTC+02:00) Bucharest"
  if (o) return { kind: 'fixed', min: (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +(o[3] ?? 0)) };
  return { kind: 'local' };
}
interface Parts { y: number; m: number; d: number; h: number; mi: number }
/** offset of a zone from UTC at an instant, minutes (east positive) */
function offsetAt(ms: number, tz: string): number {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000;
}
/** wall-clock time in a zone → instant */
function wallToInstant(p: Parts, z: Zone, local: string): number {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  if (z.kind === 'utc') return guess;
  if (z.kind === 'fixed') return guess - z.min * 60000;
  const tz = z.kind === 'iana' ? z.name : local;
  const o1 = offsetAt(guess, tz);
  let t = guess - o1 * 60000;
  const o2 = offsetAt(t, tz);
  if (o2 !== o1) t = guess - o2 * 60000;
  return t;
}
function instantToWall(ms: number, tz: string): Parts {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, +x.value]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute };
}
const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
const fromDayNum = (n: number) => {
  const d = new Date(n * 864e5);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const dow = (n: number) => (((n + 4) % 7) + 7) % 7; // 0 = Sunday (1970-01-01 was a Thursday)

/* ---------- parsing ---------- */
interface Dt { p: Parts; zone: Zone; date: boolean }
interface Rule { freq: string; interval: number; count?: number; until?: Dt; byday: { n?: number; wd: number }[]; bymonthday: number[]; bymonth: number[]; wkst: number }
interface Vevent { uid: string; summary: string; where: string; cancelled: boolean; start: Dt; end?: Dt; durMin?: number; rule?: Rule; exdates: Dt[]; recId?: Dt }
export interface Calendar { name?: string; events: Vevent[] }

const unesc = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseDt(value: string, params: Record<string, string>): Dt | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const p = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0) };
  const date = m[4] == null || params.VALUE === 'DATE';
  return { p, date, zone: m[7] ? { kind: 'utc' } : resolveZone(params.TZID) };
}
function parseRule(v: string): Rule | undefined {
  const r: Record<string, string> = Object.fromEntries(v.split(';').map((x) => x.split('=') as [string, string]));
  if (!r.FREQ) return undefined;
  const until = r.UNTIL ? parseDt(r.UNTIL, {}) : null;
  return {
    freq: r.FREQ,
    interval: Math.max(1, +(r.INTERVAL ?? 1) || 1),
    count: r.COUNT ? +r.COUNT : undefined,
    until: until ?? undefined,
    byday: (r.BYDAY ?? '').split(',').filter(Boolean).map((x) => {
      const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(x);
      return { n: mm?.[1] ? +mm[1] : undefined, wd: WD[mm?.[2] ?? 'MO'] ?? 1 };
    }),
    bymonthday: (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number),
    bymonth: (r.BYMONTH ?? '').split(',').filter(Boolean).map(Number),
    wkst: WD[r.WKST ?? 'MO'] ?? 1,
  };
}
const durMin = (v: string) => {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(v);
  return m ? (+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 1440 + +(m[3] ?? 0) * 60 + +(m[4] ?? 0) : 0;
};

export function parseIcs(text: string): Calendar {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const cal: Calendar = { events: [] };
  let cur: Partial<Vevent> | null = null;
  let depth = 0; // inside a VEVENT's VALARM and the like
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      cur = { uid: '', summary: '', where: '', cancelled: false, exdates: [] };
      depth = 0;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.start) cal.events.push({ uid: cur.uid || cur.summary || '?', ...cur } as Vevent);
      cur = null;
      continue;
    }
    if (cur && /^BEGIN:/.test(line)) depth++;
    if (cur && /^END:/.test(line)) depth--;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...ps] = line.slice(0, colon).split(';');
    const key = name.toUpperCase();
    const value = line.slice(colon + 1);
    const params = Object.fromEntries(ps.map((x) => x.split('=') as [string, string]).map(([k, v]) => [k.toUpperCase(), (v ?? '').replace(/^"|"$/g, '')]));
    if (!cur) {
      if (key === 'X-WR-CALNAME') cal.name = unesc(value);
      continue;
    }
    if (depth > 0) continue;
    switch (key) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.summary = unesc(value); break;
      case 'LOCATION': cur.where = unesc(value); break;
      case 'STATUS': cur.cancelled = /CANCEL/i.test(value); break;
      case 'DTSTART': cur.start = parseDt(value, params) ?? undefined; break;
      case 'DTEND': cur.end = parseDt(value, params) ?? undefined; break;
      case 'DURATION': cur.durMin = durMin(value.trim()); break;
      case 'RRULE': cur.rule = parseRule(value.trim()); break;
      case 'EXDATE': for (const v of value.split(',')) { const d = parseDt(v, params); if (d) cur.exdates!.push(d); } break;
      case 'RECURRENCE-ID': cur.recId = parseDt(value, params) ?? undefined; break;
    }
  }
  return cal;
}

/* ---------- recurrence: wall-clock dates of a series, ascending ---------- */
function* series(e: Vevent, lastDay: number): Generator<number> {
  const r = e.rule!;
  const s0 = dayNum(e.start.p.y, e.start.p.m, e.start.p.d);
  const sd = fromDayNum(s0);
  let n = 0;
  const emit = function* (day: number) {
    if (day < s0) return;
    yield day;
  };
  const limit = 20000;
  if (r.freq === 'DAILY') {
    for (let k = 0; k < limit; k++) {
      const day = s0 + k * r.interval;
      if (day > lastDay) return;
      const f = fromDayNum(day);
      if (r.byday.length && !r.byday.some((b) => b.wd === dow(day))) continue;
      if (r.bymonth.length && !r.bymonth.includes(f.m)) continue;
      yield day;
    }
  } else if (r.freq === 'WEEKLY') {
    const wds = r.byday.length ? r.byday.map((b) => b.wd) : [dow(s0)];
    const weekStart = s0 - ((dow(s0) - r.wkst + 7) % 7);
    for (let k = 0; k < limit; k++) {
      const base = weekStart + k * r.interval * 7;
      if (base > lastDay) return;
      const days = wds.map((w) => base + ((w - r.wkst + 7) % 7)).sort((a, b) => a - b);
      for (const day of days) yield* emit(day);
    }
  } else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
    const yearly = r.freq === 'YEARLY';
    for (let k = 0; k < limit; k++) {
      const months = yearly ? (r.bymonth.length ? r.bymonth : [sd.m]) : [((sd.m - 1 + k * r.interval) % 12) + 1];
      const year = yearly ? sd.y + k * r.interval : sd.y + Math.floor((sd.m - 1 + k * r.interval) / 12);
      if (dayNum(year, 1, 1) > lastDay) return;
      for (const m of months) {
        const first = dayNum(year, m, 1);
        const len = dayNum(m === 12 ? year + 1 : year, m === 12 ? 1 : m + 1, 1) - first;
        const days: number[] = [];
        if (r.bymonthday.length) for (const d of r.bymonthday) { const dd = d > 0 ? d : len + d + 1; if (dd >= 1 && dd <= len) days.push(first + dd - 1); }
        else if (r.byday.length)
          for (const b of r.byday) {
            const all = Array.from({ length: len }, (_, i) => first + i).filter((x) => dow(x) === b.wd);
            if (b.n == null) days.push(...all);
            else { const x = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (x != null) days.push(x); }
          }
        else if (sd.d <= len) days.push(first + sd.d - 1);
        for (const day of days.sort((a, b) => a - b)) yield* emit(day);
      }
    }
  }
  void n;
}

/* ---------- one day's meetings ---------- */
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** the meetings that start on `day` (yyyy-mm-dd) in time zone `localTz`, earliest first */
export function meetingsOn(cal: Calendar, day: string, localTz: string): AgendaEvent[] {
  const [Y, M, D] = day.split('-').map(Number);
  const loc: Zone = { kind: 'iana', name: localTz };
  const from = wallToInstant({ y: Y, m: M, d: D, h: 0, mi: 0 }, loc, localTz);
  const nx = fromDayNum(dayNum(Y, M, D) + 1);
  const to = wallToInstant({ y: nx.y, m: nx.m, d: nx.d, h: 0, mi: 0 }, loc, localTz);
  const inst = (d: Dt) => wallToInstant(d.p, d.zone, localTz);
  const lastDay = dayNum(Y, M, D) + 2; // wall dates in other zones can be a day off

  // instances moved or cancelled one by one replace the series' own
  const replaced = new Set<string>();
  for (const e of cal.events) if (e.recId) replaced.add(`${e.uid}|${inst(e.recId)}`);

  const out: AgendaEvent[] = [];
  const add = (e: Vevent, start: number, end: number, key: string) => {
    if (e.start.date || start < from || start >= to) return;
    const w = instantToWall(start, localTz);
    out.push({ id: `ics-${hash(`${e.uid}|${key}`)}`, title: e.summary || '(no title)', start: w.h * 60 + w.mi, durationMin: Math.max(1, Math.round((end - start) / 60000)), where: e.where, cancelled: e.cancelled || undefined });
  };
  for (const e of cal.events) {
    if (e.start.date) continue;
    const s0 = inst(e.start);
    const len = e.end ? inst(e.end) - s0 : (e.durMin ?? 30) * 60000;
    if (e.rule && !e.recId) {
      const ex = new Set(e.exdates.map((x) => inst(x)));
      let n = 0;
      for (const day of series(e, lastDay)) {
        const f = fromDayNum(day);
        const at = wallToInstant({ ...f, h: e.start.p.h, mi: e.start.p.mi }, e.start.zone, localTz);
        if (e.rule.until && at > (e.rule.until.date ? inst(e.rule.until) + 864e5 : inst(e.rule.until))) break;
        if (e.rule.count != null && ++n > e.rule.count) break;
        if (at >= to) { if (day > lastDay) break; continue; }
        if (ex.has(at) || replaced.has(`${e.uid}|${at}`)) continue;
        add(e, at, at + len, String(at));
      }
    } else add(e, s0, s0 + len, e.recId ? String(inst(e.recId)) : '');
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
