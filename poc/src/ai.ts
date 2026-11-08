import { get, set, uid } from './store';
import type { AiMsg, AiOp, Node, State, Status, SubSpec } from './store';
import { fmt, isoDay, meetingsFor, nextModel, pathOf, plain } from './model';
import { STATUSES, describe, mintIds, propose, viewOf } from './proposal';

/**
 * The ⌘/ assistant, backed by the OpenAI Responses API with function tools.
 * Stateless (store: false): the whole conversation is kept here and sent each time, reasoning items included (encrypted).
 * The key lives in poc/.env and is added by the dev-server proxy (vite.config.ts): the browser only calls /api/openai.
 * Read tools see the document *as proposed so far*; write tools only add to the proposal (shown in purple).
 */
declare const __AI__: { configured: boolean; model: string; effort: string };
export const AI_CFG = __AI__;

/** Responses API input / output items (only the parts used here; output items are sent back verbatim) */
type Item =
  | { role: 'user'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string; [k: string]: unknown }
  | { type: 'message'; role: 'assistant'; content: { type: string; text?: string; refusal?: string }[]; [k: string]: unknown }
  | { type: 'reasoning'; [k: string]: unknown };
type Msg = Item;
/** some models refuse encrypted reasoning: then it is left out (and reasoning items are not sent back) */
let encrypted = true;

/** the API conversation (tool calls included); the popup only shows the user / AI text */
let convo: Msg[] = [];
let abort: AbortController | null = null;
export const stopTurn = () => abort?.abort();
export const resetConvo = () => {
  convo = [];
  abort?.abort();
  abort = null;
};
/** tell the model what happened to its proposal (accepted / rejected) before the next turn */
export const noteToModel = (text: string) => convo.length && convo.push({ role: 'user', content: `[app] ${text}` });

const SYSTEM = `You are the assistant inside yatai, a small keyboard-first task app for one person (a software developer).

Data model:
- Everything is an "item" in one tree. Any item can have sub-items to any depth; an item with sub-items is done when all its leaves are.
- "Next" is today's list: items with today=true. Next groups them in cards under their parent; meetings from the calendar are cards too.
- Item fields: title (markdown; line 1 is the headline, later lines are notes), status (todo | doing | waiting | done | dropped), est (minutes), due (yyyy-mm-dd), today (in Next).
- Items with a "smart" source (pr, pipeline, workitem, ai) track something external; leave their titles alone.

How you work:
- Use the read tools to look before you change anything. Refer to items by id.
- Your write tools (patch_items, set_sub_items) do NOT apply changes. They add to a proposal the user sees highlighted in purple and accepts or rejects. So don't ask "shall I?" — just propose, then say in 1–3 short sentences what you proposed. If you need more information, ask briefly instead.
- Estimates are in minutes; prefer 5, 15, 30, 60, 120, 240, 480. Keep titles short and concrete (imperative verbs).
- set_sub_items replaces the WHOLE list of an item's sub-items: include every sub-item to keep (by id), new ones without an id; anything you leave out is removed.
- Your final answer is JSON: "reply" is what you say — plain, concise text, light markdown (**bold**, lists) is fine.
- "suggestions": 2–4 next things the user could ask you, written as the user would type them (imperative, at most 6 words, specific to the items and situation at hand — e.g. "Estimate the release items", "Break down Extract staff", "Move the vector spike to tomorrow"). With a proposal pending, include ways to refine it. Never suggest "accept" or "reject" (the app has buttons for that).`;

/** the final answer's shape: what to say, and follow-ups the popup offers as clickable chips */
const REPLY_FORMAT = {
  type: 'json_schema',
  name: 'reply',
  strict: true,
  schema: {
    type: 'object',
    properties: { reply: { type: 'string' }, suggestions: { type: 'array', items: { type: 'string' } } },
    required: ['reply', 'suggestions'],
    additionalProperties: false,
  },
};
/** the JSON answer, or — if the model ignored the format — its text as is */
function parseReply(raw: string): { reply: string; suggestions: string[] } {
  try {
    const j = JSON.parse(raw);
    if (typeof j?.reply === 'string') return { reply: j.reply, suggestions: Array.isArray(j.suggestions) ? j.suggestions.filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 4) : [] };
  } catch {
    /* not JSON */
  }
  return { reply: raw, suggestions: [] };
}

/* ---------- tools ---------- */
const subSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id of an existing item to keep (omit for a new item)' },
    title: { type: 'string', description: 'required for new items; for existing ones only when renaming' },
    est: { type: ['number', 'null'], description: 'estimate in minutes, null clears' },
    status: { type: 'string', enum: STATUSES },
    children: { type: 'array', description: "this item's full list of sub-items (omit to leave them unchanged)", items: { $ref: '#/$defs/sub' } },
  },
};
const FUNCS = [
  {
    type: 'function',
    function: {
      name: 'get_today_items',
      description: "Today's plan: the meetings and every item in Next, card by card, with ids, status, estimates and nesting.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_item',
      description: 'One item with its full title (notes included), its path and its whole sub-item tree.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_items',
      description: 'Find items anywhere in the tree (not only today) by text. With an empty query: an outline of the top two levels.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_items',
      description: 'Propose changes to some fields of one or more items. Only the keys you pass change.',
      parameters: {
        type: 'object',
        properties: {
          patches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string', description: 'one line renames the headline and keeps the notes; include newlines to replace the notes too' },
                est: { type: ['number', 'null'], description: 'minutes; null clears' },
                due: { type: ['string', 'null'], description: 'yyyy-mm-dd; null clears' },
                status: { type: 'string', enum: STATUSES },
                today: { type: 'boolean', description: 'put in / take out of Next' },
              },
              required: ['id'],
            },
          },
        },
        required: ['patches'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_sub_items',
      description: "Propose the complete list of an item's sub-items (replaces the current list: keep by id, add without id, omit to remove). Nest with children.",
      parameters: {
        type: 'object',
        $defs: { sub: subSchema },
        properties: { id: { type: 'string', description: 'the parent item' }, items: { type: 'array', items: { $ref: '#/$defs/sub' } } },
        required: ['id', 'items'],
      },
    },
  },
];
/** the Responses API takes function tools flat: { type, name, description, parameters } */
const TOOLS = FUNCS.map((t) => ({ type: 'function', ...t.function }));

const first = (t: string) => plain(t.split('\n')[0]);
/** a one-line title from the model renames the headline only: the notes (lines 2+) stay */
const keepNotes = (next: string, old?: string) => (next.includes('\n') || !old?.includes('\n') ? next : next + old.slice(old.indexOf('\n')));
const doneOf = (nodes: Node[], n: Node): boolean => {
  const kids = nodes.filter((c) => c.parentId === n.id);
  if (!kids.length) return n.status === 'done';
  const live = kids.filter((k) => k.status !== 'dropped');
  return n.status === 'done' || (live.length > 0 && live.every((k) => doneOf(nodes, k)));
};
const brief = (s: State, n: Node, marks: Record<string, { kind: string }> | null) => ({
  id: n.id,
  title: first(n.title),
  ...(n.title.includes('\n') ? { notes: true } : {}),
  status: doneOf(s.nodes, n) ? 'done' : n.status,
  ...(n.est ? { est: n.est } : {}),
  ...(n.due ? { due: n.due } : {}),
  ...(n.smart ? { smart: n.smart.source } : {}),
  ...(s.current?.id === n.id ? { running: true } : {}),
  ...(marks?.[n.id] ? { proposed: marks[n.id].kind } : {}),
});
const tree = (s: State, n: Node, marks: Record<string, { kind: string }> | null): unknown => {
  const kids = s.nodes.filter((c) => c.parentId === n.id);
  return { ...brief(s, n, marks), today: n.today, ...(kids.length ? { children: kids.map((k) => tree(s, k, marks)) } : {}) };
};

const LABEL: Record<string, string> = {
  get_today_items: "Reading today's items…",
  get_item: 'Reading an item…',
  search_items: 'Searching…',
  patch_items: 'Proposing changes…',
  set_sub_items: 'Proposing sub-items…',
};

function runTool(name: string, args: any): unknown {
  const { s, marks } = viewOf(get());
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  switch (name) {
    case 'get_today_items': {
      // everything in Next, collapsed or not
      const open = { ...s, nodes: s.nodes.map((n) => (n.open ? n : { ...n, open: true })) };
      const cards = nextModel(open).cards.map((c) => ({
        card: c.kind === 'meeting' ? `meeting: ${c.meeting!.title} ${fmt(c.meeting!.eff)}` : c.task ? c.path.join(' › ') : '(top level)',
        ...(c.task ? { parentId: c.task.id } : {}),
        items: c.rows.filter((r) => r.node).map((r) => ({ ...brief(s, r.node!, marks), depth: r.depth })),
      }));
      return {
        now: `${isoDay(0)} ${fmt(s.clock)}`,
        meetings: meetingsFor(s).map((m) => ({ id: m.id, title: m.title, start: fmt(m.eff), minutes: m.durationMin, state: m.state })),
        cards,
      };
    }
    case 'get_item': {
      const n = byId.get(args.id);
      if (!n) return { error: `no item ${args.id}` };
      return { path: pathOf(s.nodes, n.parentId), fullTitle: n.title, ...(tree(s, n, marks) as object) };
    }
    case 'search_items': {
      const q = String(args.query ?? '').trim().toLowerCase();
      const limit = Math.min(Number(args.limit) || 30, 80);
      if (!q) {
        return s.nodes.filter((n) => !n.parentId).map((n) => ({ ...brief(s, n, marks), today: n.today, children: s.nodes.filter((c) => c.parentId === n.id).map((c) => ({ ...brief(s, c, marks), today: c.today, subItems: s.nodes.filter((g) => g.parentId === c.id).length })) }));
      }
      return s.nodes
        .filter((n) => n.title.toLowerCase().includes(q))
        .slice(0, limit)
        .map((n) => ({ ...brief(s, n, marks), today: n.today, path: pathOf(s.nodes, n.parentId).join(' › '), subItems: s.nodes.filter((c) => c.parentId === n.id).length }));
    }
    case 'patch_items': {
      const res: unknown[] = [];
      for (const p of (args.patches ?? []) as any[]) {
        if (!byId.has(p.id)) {
          res.push({ id: p.id, error: 'no such item' });
          continue;
        }
        const set: Extract<AiOp, { op: 'patch' }>['set'] = {};
        if (typeof p.title === 'string' && p.title.trim()) set.title = keepNotes(p.title, byId.get(p.id)!.title);
        if ('est' in p) set.est = p.est == null ? null : Math.max(1, Math.round(Number(p.est)));
        if ('due' in p) set.due = p.due && /^\d{4}-\d{2}-\d{2}$/.test(p.due) ? p.due : null;
        if (STATUSES.includes(p.status)) set.status = p.status as Status;
        if (typeof p.today === 'boolean') set.today = p.today;
        propose({ op: 'patch', id: p.id, set });
        res.push({ id: p.id, ok: true });
      }
      return { proposed: res, note: 'Pending: shown to the user in purple to accept or reject.' };
    }
    case 'set_sub_items': {
      if (!byId.has(args.id)) return { error: `no item ${args.id}` };
      const clean = (xs: any[]): SubSpec[] =>
        (xs ?? []).map((x) => ({
          id: String(x.id ?? ''),
          title: typeof x.title === 'string' ? keepNotes(x.title, byId.get(String(x.id ?? ''))?.title) : undefined,
          est: x.est === undefined ? undefined : x.est == null ? null : Math.max(1, Math.round(Number(x.est))),
          status: STATUSES.includes(x.status) ? x.status : undefined,
          children: Array.isArray(x.children) ? clean(x.children) : undefined,
        }));
      const items = mintIds(clean(args.items), (id) => byId.has(id));
      propose({ op: 'subs', id: args.id, items });
      const ids = (xs: SubSpec[]): unknown[] => xs.map((x) => ({ id: x.id, ...(x.isNew ? { new: true } : {}), ...(x.children ? { children: ids(x.children) } : {}) }));
      return { proposed: ids(items), note: 'Pending: shown to the user in purple to accept or reject.' };
    }
  }
  return { error: `unknown tool ${name}` };
}

async function complete(instructions: string, input: Msg[], signal: AbortSignal): Promise<Msg[]> {
  const body = (enc: boolean) =>
    JSON.stringify({
      model: AI_CFG.model,
      instructions,
      input: enc ? input : input.filter((i) => !('type' in i && i.type === 'reasoning')),
      tools: TOOLS,
      tool_choice: 'auto',
      text: { format: REPLY_FORMAT },
      store: false,
      ...(enc ? { include: ['reasoning.encrypted_content'] } : {}),
      ...(AI_CFG.effort ? { reasoning: { effort: AI_CFG.effort } } : {}),
    });
  const call = (enc: boolean) => fetch('/api/openai/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(enc), signal });
  let res = await call(encrypted);
  let data = await res.json().catch(() => null);
  if (!res.ok && encrypted && res.status === 400 && /encrypt|include/i.test(data?.error?.message ?? '')) {
    encrypted = false; // this model does not do encrypted reasoning: carry on without it
    res = await call(false);
    data = await res.json().catch(() => null);
  }
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI request failed (${res.status})`);
  if (data?.status === 'incomplete') throw new Error(`Response incomplete: ${data.incomplete_details?.reason ?? 'unknown reason'}`);
  return (data?.output ?? []) as Msg[];
}

const setAi = (fn: (a: NonNullable<State['ai']>) => Partial<NonNullable<State['ai']>>) => set((s) => (s.ai ? { ai: { ...s.ai, ...fn(s.ai) } } : {}));
const say = (m: Omit<AiMsg, 'id'>) => setAi((a) => ({ msgs: [...a.msgs, { id: uid(), ...m }] }));

/** one user turn: let the model read and propose until it answers in text */
export async function chatTurn(text: string) {
  const s = get();
  const ctxNode = s.ai?.ctxId ? s.nodes.find((n) => n.id === s.ai!.ctxId) : undefined;
  const context = `Now: ${isoDay(0)} ${fmt(s.clock)}.${ctxNode ? ` The user has this item selected: ${ctxNode.id} "${first(ctxNode.title)}".` : ''}${s.proposal?.ops.length ? ' A proposal of yours is pending (already applied in what the read tools return).' : ''}`;
  convo.push({ role: 'user', content: text });
  const turnStart = convo.length - 1;
  abort = new AbortController();
  const signal = abort.signal;
  setAi(() => ({ busy: true, status: 'Thinking…' }));
  try {
    for (let step = 0; step < 10; step++) {
      const out = await complete(`${SYSTEM}\n\n${context}`, convo, signal);
      convo.push(...out);
      const calls = out.filter((i): i is Extract<Msg, { type: 'function_call' }> => 'type' in i && i.type === 'function_call');
      if (!calls.length) {
        const said = out
          .flatMap((i) => ('type' in i && i.type === 'message' ? i.content : []))
          .map((c) => c.text ?? c.refusal ?? '')
          .join('\n')
          .trim();
        const p = get().proposal;
        const tail = p?.ops.length ? `\n\n_${describe(viewOf(get()).marks ?? {})} — ⌘⏎ accept · ⌘⌫ reject_` : '';
        const r = parseReply(said);
        say({ role: 'ai', text: (r.reply.trim() || 'Done.') + tail, suggest: r.suggestions });
        return;
      }
      for (const fc of calls) {
        setAi(() => ({ status: LABEL[fc.name] ?? 'Working…' }));
        let res: unknown;
        try {
          res = runTool(fc.name, JSON.parse(fc.arguments || '{}'));
        } catch (e) {
          res = { error: String(e) };
        }
        convo.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(res) });
      }
    }
    say({ role: 'ai', text: 'I stopped after too many steps — try a narrower request.', error: true });
  } catch (e) {
    // keep the API conversation valid: drop this turn's unanswered tail (its proposals stay)
    convo.length = turnStart;
    if (!signal.aborted) say({ role: 'ai', text: `⚠ ${(e as Error).message}`, error: true });
  } finally {
    if (abort?.signal === signal) abort = null;
    setAi(() => ({ busy: false, status: undefined }));
  }
}
