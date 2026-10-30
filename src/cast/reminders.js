// Reminders. The phone works out when the next one should come, from its own memory curve, and tells
// the worker only that time. The worker sends an empty push; the words are written here and shown
// by the service worker, so nothing about the pupil ever leaves the phone.
import { VAPID_PUBLIC } from './config.js';
import { post } from './client.js';
import { isLearnt, learntPercent } from './proof.js';
import { HOUR, TARGET, readyAt } from '../memory.js';

const MIN_GAP = 20 * HOUR;
const MAX_GAP = 7 * 24 * HOUR;
const FADING = 3; // lines going before it is worth a nudge
const AFTERNOON = 16; // the next afternoon, when there are new lines to learn

// When lines will be fading, and the afternoon to come back for new ones (Infinity: no such reason).
function reasons({ model, getState, k = 1, now }) {
  const fades = model.items.map((it) => getState(it.id)).filter(isLearnt).map((s) => readyAt(s, k, TARGET)).sort((a, b) => a - b);
  const fading = fades.length ? fades[Math.min(FADING, fades.length) - 1] : Infinity;
  const anyNew = model.items.some((it) => !isLearnt(getState(it.id)));
  const d = new Date(now + MIN_GAP);
  d.setHours(AFTERNOON, 30, 0, 0);
  return { fading, afternoon: anyNew ? d.getTime() : Infinity };
}

export function nextNudge(args) {
  const { fading, afternoon } = reasons(args);
  return Math.min(args.now + MAX_GAP, Math.max(args.now + MIN_GAP, Math.min(fading, afternoon)));
}

// Why the next nudge comes: 'new' when it is for the new lines left and nothing is fading first.
export function nudgeWhy(args) {
  const { fading, afternoon } = reasons(args);
  return afternoon < fading ? 'new' : 'fading';
}

const WORDS = {
  learning: [
    'Your lines are starting to fade. A quick round now will bring them back.',
    'One quick round now does more than a long one later.',
    'Your brain is ready for another go. Just a quick round?',
    'Lines you have started are slipping a little. Catch them now and they last longer.',
  ],
  new: ['Your lines are ready when you are. Fancy a quick round?'],
  learnt: [
    'You know your lines. A quick round keeps them fresh.',
    'Lines you know still fade if you leave them. A quick round keeps them safe.',
    'Knowing it once is not the same as keeping it. A quick round keeps it.',
  ],
};

// why (see nudgeWhy) picks the words, so they are true when the nudge arrives.
export function nudgeText({ percent, turn = 0, why = 'fading' }) {
  const list = percent >= 100 ? WORDS.learnt : why === 'new' ? WORDS.new : WORDS.learning;
  return { title: 'Off Script', body: list[turn % list.length] };
}

export const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC;

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

const nowFor = (ctx) => ({ model: ctx.model, getState: ctx.getState, k: ctx.fit.k, now: Date.now() });
const next = (ctx) => nextNudge(nowFor(ctx));

async function saveWords(ctx) {
  const turn = ((await ctx.store.get('nudgeTurn')) || 0) + 1;
  await ctx.store.set('nudgeTurn', turn);
  await ctx.store.set('reminder', nudgeText({ percent: learntPercent(ctx.model, ctx.getState), turn, why: nudgeWhy(nowFor(ctx)) }));
}

// From a tap: the phone asks for permission here. Returns true when reminders are on.
export async function enable(ctx) {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) }));
  const id = randomId();
  const res = await post('/push/sub', ctx.keys.token, { id, endpoint: sub.endpoint, nextAt: next(ctx) });
  if (!res.ok) return false;
  await ctx.store.set('push', { id });
  await saveWords(ctx);
  return true;
}

// After practice, and when the app opens: the next time, and fresh words. Waits for no one: offline,
// the time already at the worker stands.
export async function sync(ctx) {
  try {
    const push = await ctx.store.get('push');
    if (!push) return;
    await saveWords(ctx);
    const res = await post('/push/next', ctx.keys.token, { id: push.id, nextAt: next(ctx) });
    if (res.status === 404) {
      // Stopped after reminders went unopened: back on now the app is open again.
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await post('/push/sub', ctx.keys.token, { id: push.id, endpoint: sub.endpoint, nextAt: next(ctx) });
    }
  } catch {
    // no signal: nothing to do
  }
}

export async function disable(ctx) {
  const push = await ctx.store.get('push');
  await ctx.store.del('push');
  const unsubscribe = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  };
  const forget = async () => push && post('/push/off', ctx.keys.token, { id: push.id });
  // Each goes ahead whatever becomes of the other. With no signal the push address is still gone from
  // the phone, so the worker forgets it at the next send.
  await Promise.allSettled([unsubscribe(), forget()]);
}
