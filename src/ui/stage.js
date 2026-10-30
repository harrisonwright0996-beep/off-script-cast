// Your lines: how much is learnt, a stage light for each scene, and one obvious next thing. No dates,
// no time to spend, no streaks: only the % and what to do now.
import { h, clear, screen, button, focusHeading, plural, settled } from './dom.js';
import { crossed, fadingCount, learntPercent, sceneLights } from '../cast/proof.js';
import { canPush, enable, sync } from '../cast/reminders.js';
import { scienceNote } from '../cast/science.js';
import { refreshPack } from './unlock.js';

const MOMENTS = {
  25: 'A quarter of your lines learnt. The lights are coming up.',
  50: 'Halfway there. That is a lot of words you can say from memory.',
  75: 'Three quarters learnt. The end is in sight.',
  100: 'Every line learnt. Amazing work. Now keep them: lines you know still fade if you stop.',
};

export function lightsOf(lights) {
  return h(
    'ul',
    { class: 'lights', 'aria-label': 'Your scenes' },
    lights.map((l) =>
      h(
        'li',
        { class: l.percent >= 100 ? 'light lit' : l.percent > 0 ? 'light warm' : 'light' },
        h('span', { class: 'lamp', 'aria-hidden': 'true', style: { opacity: String(0.25 + (0.75 * l.percent) / 100) } }),
        h('span', { class: 'light-name' }, l.heading),
        h('span', { class: 'light-pc' }, `${l.percent}%`),
      ),
    ),
  );
}

export function showStage(ctx) {
  let refreshed = false;

  const nav = ctx.nav;

  async function render() {
    await ctx.refreshEvents();
    const plan = ctx.plan();
    const percent = learntPercent(ctx.model, ctx.getState);
    const lights = sceneLights(ctx.model, ctx.getState);
    const fading = fadingCount(plan.ready, ctx.getState);
    const seen = (await ctx.store.get('seen')) || { percent: 0, lit: [], notes: 0 };
    const body = [];

    if (ctx.update) body.push(h('div', { class: 'notice' }, h('p', {}, 'A new version is ready.'), button('Update now', () => ctx.applyUpdate(), { class: 'btn' })));

    const milestone = crossed(seen.percent, percent);
    const lit = lights.filter((l) => l.percent >= 100 && !seen.lit.includes(l.scene));
    if (milestone) body.push(h('div', { class: 'moment', role: 'status' }, h('p', { class: 'moment-big' }, `${milestone}%`), h('p', {}, MOMENTS[milestone])));
    else if (lit.length) body.push(h('div', { class: 'moment', role: 'status' }, h('p', {}, `${lit[0].heading} is lit. You know every line in it.`)));
    if (percent !== seen.percent || lit.length) await ctx.store.set('seen', { ...seen, percent, lit: [...seen.lit, ...lit.map((l) => l.scene)] });

    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': `${percent}% learnt` }, h('span', { class: 'ring-num', 'aria-hidden': 'true' }, `${percent}%`), h('span', { class: 'ring-word', 'aria-hidden': 'true' }, 'learnt'));
    ring.style.setProperty('--pc', String(percent));
    body.push(ring);

    if (fading) body.push(h('p', { class: 'fading' }, `${plural(fading, 'line')} starting to fade. A quick round brings ${fading === 1 ? 'it' : 'them'} back.`));
    else if (percent >= 100) body.push(h('p', { class: 'fading' }, 'You know every line. Keep them: lines fade if you stop using them.'));
    else if (plan.done) body.push(h('p', { class: 'fading' }, 'All caught up for now. Your brain needs the gap: it is part of how this works.'));

    body.push(h('h2', {}, 'Your scenes'), lightsOf(lights));

    // After the first round, once: the offer of reminders, from a tap as phones insist.
    const practised = ctx.events.length > 0;
    if (practised && canPush() && !(await ctx.store.get('push')) && !(await ctx.store.get('pushAsked'))) {
      const box = h('div', { class: 'notice' });
      const answer = async (yes) => {
        await ctx.store.set('pushAsked', true);
        const on = yes && (await enable(ctx).catch(() => false));
        clear(box).append(h('p', { role: 'status' }, yes && !on ? 'Reminders did not switch on. You can try again in Settings.' : on ? 'Reminders are on.' : 'No reminders. You can turn them on in Settings.'));
      };
      box.append(
        h('p', {}, 'Want a nudge when your lines start to fade? Once you know them you will forget them unless you keep going, so a reminder really helps.'),
        h('div', { class: 'row' }, button('Yes, remind me', settled(() => answer(true)), { class: 'btn primary' }), button('Not now', settled(() => answer(false)))),
      );
      body.push(box);
    }

    const main = plan.done
      ? plan.ahead.length
        ? button('Learn more now', () => ctx.go('sprint', { extra: 'new' }), { class: 'btn primary' })
        : button('Run through', () => ctx.go('choose', { run: true }), { class: 'btn primary' })
      : button(percent ? 'Next round' : 'Start learning', () => ctx.go('sprint'), { class: 'btn primary' });
    const footer = [
      main,
      h('div', { class: 'row' }, button('Walk', () => ctx.go('walk')), plan.done ? null : button('Quick round', () => ctx.go('sprint', { scope: plan.tests.length ? 'tests' : 'all', minutes: 2 }))),
      h('div', { class: 'row' }, button('Run through', () => ctx.go('choose', { run: true })), button('Choose', () => ctx.go('choose'))),
      h('div', { class: 'row' }, button('My lines', () => ctx.go('scenes')), button('Settings', () => ctx.go('settings'))),
    ];
    if (ctx.nav !== nav) return; // they have moved on while this was drawing
    clear(ctx.root).append(screen({ title: 'Your lines', body, footer, className: 'today' }));
    if (!refreshed) {
      refreshed = true;
      if (ctx.keys) {
        refreshPack(ctx, () => ctx.nav === nav).then((changed) => {
          if (changed && ctx.nav === nav) render();
          sync(ctx);
        });
      }
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') render().then(() => focusHeading(ctx.root));
  };
  const onUpdate = () => render();
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('offscript:update', onUpdate);
  return render().then(() => () => {
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('offscript:update', onUpdate);
  });
}

export { scienceNote };
