// What the director sees of a pupil: their numbers, the pack's coded name and their own name sealed
// with the company code, never a line or a word missed. One row a person, as two can learn one part,
// and the same row if they install again. Sent when they change. With no signal it waits: the next
// try sends the latest.
import { post } from './client.js';
import { sealText, tokenHash } from './pack.js';
import { fadingCount, isLearnt, learntPercent } from './proof.js';

export function progressOf(ctx) {
  const days = [...ctx.states.values()].map((s) => s.lastDay).filter(Boolean).sort();
  return {
    pack: ctx.member.file,
    percent: learntPercent(ctx.model, ctx.getState),
    learnt: ctx.model.items.filter((it) => isLearnt(ctx.getState(it.id))).length,
    total: ctx.model.items.length,
    fading: fadingCount(ctx.plan().ready, ctx.getState),
    lastDay: days.at(-1) ?? null,
  };
}

export async function report(ctx) {
  try {
    const name = await ctx.store.get('myName');
    if (!ctx.keys || !ctx.member?.file || !name) return;
    const id = (await tokenHash(`${ctx.keys.token}|${ctx.member.file}|${name.toLowerCase()}`)).slice(0, 32);
    const row = { id, ...progressOf(ctx) };
    const said = JSON.stringify(row);
    if (said === (await ctx.store.get('reported'))) return;
    const res = await post('/progress', ctx.keys.token, { ...row, who: await sealText(ctx.keys.key, name) });
    if (res.ok) await ctx.store.set('reported', said);
  } catch {
    // no signal: nothing to do
  }
}
