// The offer of reminders: once they have practised, until they answer. From a tap, as phones insist.
// Before that, one whole screen asks: after the first download, or the next time an older phone opens.
import { h, clear, button, focusHeading, screen, settled } from './dom.js';
import { canPush, enable } from '../cast/reminders.js';

const PROMPTED = 'pushPrompted';

export const needsPrompt = async (ctx) => canPush() && Notification.permission !== 'denied' && !(await ctx.store.get('push')) && !(await ctx.store.get(PROMPTED));

// Not now leaves the smaller offer to come, after they have tried a round.
export function reminderPrompt(ctx, { title, words, then }) {
  const show = (body, footer) => {
    clear(ctx.root).append(screen({ title, body, footer }));
    focusHeading(ctx.root);
  };
  const yes = settled(async () => {
    const on = await enable(ctx).catch(() => false);
    await ctx.store.set(PROMPTED, true);
    if (on) return then();
    show([h('p', { class: 'message', role: 'alert' }, 'Reminders did not switch on. You can try again in Settings.')], [button('Carry on', settled(then), { class: 'btn primary' })]);
  });
  const no = settled(async () => {
    await ctx.store.set(PROMPTED, true);
    then();
  });
  show([h('p', { class: 'lead' }, words)], [button('Yes, remind me', yes, { class: 'btn primary' }), button('Not now', no)]);
}

export async function reminderOffer(ctx) {
  if (!ctx.events.length || !canPush() || (await ctx.store.get('push')) || (await ctx.store.get('pushAsked'))) return null;
  const box = h('div', { class: 'notice' });
  const answer = async (yes) => {
    const on = yes && (await enable(ctx).catch(() => false));
    if (on || !yes) await ctx.store.set('pushAsked', true); // if it did not work, it can be offered again
    const said = h('p', { role: 'status', tabindex: '-1' }, yes && !on ? 'Reminders did not switch on. You can try again in Settings.' : on ? 'Reminders are on.' : 'No reminders. You can turn them on in Settings.');
    clear(box).append(said);
    said.focus(); // the button that had focus has gone
  };
  box.append(
    h('p', {}, 'Want a nudge when your lines start to fade? Once you know them you will forget them unless you keep going, so a reminder really helps.'),
    h('div', { class: 'row' }, button('Yes, remind me', settled(() => answer(true)), { class: 'btn primary' }), button('Not now', settled(() => answer(false)))),
  );
  return box;
}
