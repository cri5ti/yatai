/**
 * Sorting one email into a bucket, on this machine (nothing leaves it). Two sorters:
 *  - Laya (default): an encoder decision model answering typed questions with probabilities; no text is generated.
 *  - Ollama: a small generative LLM with a JSON-schema answer. Kept for comparison (app/todo.md: review it).
 */
import { layaPredict, llmLocal } from '../../platform';
import type { Settings } from '../../store';
import { isBucket } from './model';
import type { Bucket, MailItem } from './model';

export const SCHEMA = {
  type: 'object',
  properties: { bucket: { enum: ['urgent', 'today', 'eventually', 'dismiss'] }, reason: { type: 'string' } },
  required: ['bucket', 'reason'],
};

export const system = (me: string) => `You triage the work inbox of ${me}, a software developer. Put each email in exactly one bucket:
- urgent: ${me} must act within the hour: a production incident or outage, someone blocked right now waiting on ${me}, a security problem with ${me}'s own account, a deadline today that is about to pass.
- today: a person wrote to ${me} and expects a reply or an action soon: a question, a request, a review or approval asked of ${me}, a decision, a thread about work ${me} is part of.
- eventually: worth reading some time, no action soon: FYI from colleagues, team or company announcements, mentions of ${me} and comments on documents, digests ${me} may care about.
- dismiss: can be archived without reading: marketing, vendor or partner newsletters, event invitations from companies, receipts and payment notices, automatic replies (out of office), calendar responses, routine automated notices.
Rules:
- A colleague (same organisation) writing about work is never dismiss.
- Automated senders (noreply, notifications) are rarely urgent or today.
- Be sparing with urgent.
Answer with the bucket and a reason of at most 10 words.`;

const ago = (iso: string, now: number) => {
  const h = (now - Date.parse(iso)) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes ago` : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`;
};

/** what the model sees of one mail */
export function prompt(m: MailItem & { body?: string }, me: string, now = Date.now()): string {
  const toMe = !!me && (m.to ?? '').toLowerCase().includes(me.toLowerCase());
  return [
    `From: ${m.from}${m.addr ? ` <${m.addr}>` : ' (a colleague, same organisation)'}`,
    `To: ${m.to ?? ''}${toMe ? ` (includes ${me})` : ''}`,
    m.cc && `Cc: ${m.cc}`,
    `Subject: ${m.subject}`,
    `Received: ${ago(m.received, now)}`,
    m.important && 'Importance: high',
    `Body: ${(m.body ?? '(not available)').slice(0, 1200)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** leave the machine usable: half the logical processors at most (Rust also drops Ollama to idle priority) */
const threads = () => Math.max(2, Math.floor(((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) / 2));

/** the transport, swappable for tests */
export const transport = { post: llmLocal };

export type Sorted = { cls: Bucket; why: string; p?: number; reply?: boolean };
type Cfg = Pick<Settings, 'mailSorter' | 'mailLaya' | 'mailModel'>;
/** what an item was sorted by (kept on it) */
export const sorterOf = (c: Cfg) => (c.mailSorter === 'ollama' ? c.mailModel || 'qwen3:4b-instruct-2507-q4_K_M' : `laya:${c.mailLaya || 'english'}`);

export function classify(c: Cfg, me: string, m: MailItem & { body?: string }): Promise<Sorted> {
  return c.mailSorter === 'ollama' ? classifyOllama(c.mailModel || 'qwen3:4b-instruct-2507-q4_K_M', me, m) : classifyLaya(c.mailLaya || 'english', me, m);
}

/* ---------- Laya: typed questions, one forward pass, probabilities ---------- */

/** the questions asked of each email: the bucket, and two yes/no signals shown beside it */
export const questions = (me: string) => ({
  bucket: {
    type: 'choice',
    instructions: `When must ${me}, a software developer, deal with this email?`,
    criteria: {
      urgent: `within the hour: a production incident or outage, someone blocked right now waiting on ${me}, a security problem with their own account`,
      today: `today: a person wrote to ${me} and expects a reply or an action soon: a question, a request, a review or approval, a decision`,
      eventually: 'some time: FYI from colleagues, team or company announcements, mentions and comments on documents, digests',
      dismiss: 'never: marketing, vendor newsletters, event invitations, receipts, automatic replies, routine automated notices',
    },
  },
  needs_reply: { type: 'noul', instructions: `Does the sender expect ${me} to reply or act?` },
  bulk: { type: 'noul', instructions: 'Is this bulk mail: marketing, a newsletter or an automated notification?' },
});

/** a noul answer: a probability of "yes" (or a plain boolean) */
const yes = (a: unknown): boolean | undefined => {
  const v = a && typeof a === 'object' ? (a as { noul?: unknown }).noul : undefined;
  return typeof v === 'number' ? v >= 0.5 : typeof v === 'boolean' ? v : undefined;
};

export const layaTransport = { post: layaPredict };

export async function classifyLaya(checkpoint: string, me: string, m: MailItem & { body?: string }, now = Date.now()): Promise<Sorted> {
  const who = me || 'the user';
  const r = await layaTransport.post({
    model: checkpoint,
    email: {
      subject: m.subject,
      body: m.body ?? '',
      sender: m.addr ? `${m.from} <${m.addr}>` : `${m.from} (colleague, same organisation)`,
      to: (m.to ?? '').slice(0, 300),
      received: ago(m.received, now),
      max_chars: 1500,
    },
    questions: questions(who),
  });
  let out: { answers?: Record<string, { choice?: unknown; probabilities?: Record<string, number> }>; error?: string } = {};
  try {
    out = JSON.parse(r.body);
  } catch {
    /* falls through */
  }
  if (r.status < 200 || r.status >= 300) throw new Error(`Laya: ${out.error ?? `answered ${r.status}`}`);
  const b = out.answers?.bucket;
  if (!b || !isBucket(b.choice)) throw new Error('Laya did not answer with a bucket');
  const p = b.probabilities?.[b.choice];
  const reply = yes(out.answers?.needs_reply);
  const bulk = yes(out.answers?.bulk);
  const why = [p != null && `${Math.round(p * 100)}%`, reply && 'expects a reply', bulk && 'bulk'].filter(Boolean).join(' · ');
  return { cls: b.choice, why, p, reply };
}

/* ---------- Ollama: a generative LLM with a JSON-schema answer ---------- */

export async function classifyOllama(model: string, me: string, m: MailItem & { body?: string }): Promise<Sorted> {
  const r = await transport.post('api/chat', {
    model,
    stream: false,
    format: SCHEMA,
    keep_alive: '10m',
    options: { temperature: 0, num_ctx: 4096, num_thread: threads() },
    messages: [
      { role: 'system', content: system(me || 'the user') },
      { role: 'user', content: prompt(m, me) },
    ],
  });
  if (r.status === 404) throw new Error(`the model ${model} is not installed (ollama pull ${model})`);
  if (r.status < 200 || r.status >= 300) throw new Error(`the local model answered ${r.status}: ${r.body.slice(0, 200)}`);
  let out: { bucket?: unknown; reason?: unknown } = {};
  try {
    out = JSON.parse(JSON.parse(r.body).message.content);
  } catch {
    /* not what was asked for: falls through */
  }
  if (!isBucket(out.bucket)) throw new Error(`the model ${model} did not answer with a bucket`);
  return { cls: out.bucket, why: String(out.reason ?? '').trim().slice(0, 120) };
}
