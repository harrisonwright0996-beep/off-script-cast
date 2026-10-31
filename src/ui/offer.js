// The offer of reminders: once they have practised, until they answer. From a tap, as phones insist.
import { h, clear, button, settled } from './dom.js';
import { canPush, enable } from '../cast/reminders.js';

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
