// What the director sees of a pupil: numbers under the pack's coded name, never a name, a line or a
// word missed. Sent when they change. With no signal it waits: the next try sends the latest.
import { post } from './client.js';
import { fadingCount, isLearnt, learntPercent } from './proof.js';

export function progressOf(ctx) {
  const days = [...ctx.states.values()].map((s) => s.lastDay).filter(Boolean).sort();
  return {
    id: ctx.member.file,
    percent: learntPercent(ctx.model, ctx.getState),
    learnt: ctx.model.items.filter((it) => isLearnt(ctx.getState(it.id))).length,
    total: ctx.model.items.length,
    fading: fadingCount(ctx.plan().ready, ctx.getState),
    lastDay: days.at(-1) ?? null,
  };
}

export async function report(ctx) {
  try {
    if (!ctx.keys || !ctx.member?.file) return;
    const row = progressOf(ctx);
    const said = JSON.stringify(row);
    if (said === (await ctx.store.get('reported'))) return;
    const res = await post('/progress', ctx.keys.token, row);
    if (res.ok) await ctx.store.set('reported', said);
  } catch {
    // no signal: nothing to do
  }
}
