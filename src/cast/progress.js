// What the director sees of a pupil: their numbers, the pack's coded name and their own name sealed
// with the company code, never a line or a word missed. One row a phone, under a random id kept on the
// phone, so no one else can work it out and write over it. Sent when they change. With no signal it
// waits: the next try sends the latest.
import { post } from './client.js';
import { sealText } from './pack.js';
import { fadingCount, isLearnt, learntPercent, onWayCount, sceneLights } from './proof.js';
import { streakDays } from './streak.js';

const ROW = 'progressId';
const SCENES_MOST = 480; // sealed: a row has to fit in the worker's 1,024 bytes

// Each scene's %, short: 1=40|2=100|Prologue=0. Sealed with the name, so the worker cannot read it.
export const sceneLine = (model, getState) =>
  sceneLights(model, getState)
    .map((l) => `${/^Scene (\d+)/i.exec(l.heading)?.[1] ?? l.heading.split(':')[0].slice(0, 12).replace(/[|=]/g, ' ')}=${l.percent}`)
    .join('|');

export function progressOf(ctx) {
  const days = [...ctx.states.values()].flatMap((s) => [s.lastDay, s.walkDay]).filter(Boolean).sort();
  return {
    pack: ctx.member.file,
    percent: learntPercent(ctx.model, ctx.getState),
    learnt: ctx.model.items.filter((it) => isLearnt(ctx.getState(it.id))).length,
    total: ctx.model.items.length,
    fading: fadingCount(ctx.plan().ready, ctx.getState),
    onWay: onWayCount(ctx.model, ctx.getState),
    scenes: sceneLine(ctx.model, ctx.getState),
    streak: streakDays(ctx.streak, ctx.today()),
    lastDay: days.length ? days[days.length - 1] : null,
  };
}

const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

let sending = false; // the app asks often: one at a time

export async function report(ctx) {
  if (sending) return;
  sending = true;
  try {
    const name = await ctx.store.get('myName');
    if (!ctx.keys || !ctx.member?.file || !name) return;
    let id = await ctx.store.get(ROW);
    if (!id) await ctx.store.set(ROW, (id = randomId()));
    const row = { id, ...progressOf(ctx), reminders: !!(await ctx.store.get('push')) };
    const said = JSON.stringify({ ...row, name });
    if (said === (await ctx.store.get('reported'))) return;
    const scenes = await sealText(ctx.keys.key, row.scenes);
    const res = await post('/progress', ctx.keys.token, { ...row, who: await sealText(ctx.keys.key, name), scenes: scenes.length <= SCENES_MOST ? scenes : undefined });
    if (res.ok) await ctx.store.set('reported', said);
  } catch {
    // no signal: nothing to do
  } finally {
    sending = false;
  }
}

// Remove everything: the row goes from the director's page too.
export async function forgetRow(ctx) {
  const id = await ctx.store.get(ROW);
  if (id && ctx.keys) await post('/progress/off', ctx.keys.token, { id });
}
