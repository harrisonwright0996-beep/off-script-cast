// Your lines: how much is learnt, a stage light for each scene, and one obvious next thing. No dates,
// no time to spend, no streaks: only the % and what to do now.
import { h, clear, screen, button, announce, focusHeading, settled } from './dom.js';
import { crossed, fadingCount, learntPercent, sceneLights } from '../cast/proof.js';
import { report } from '../cast/progress.js';
import { sync } from '../cast/reminders.js';
import { reminderOffer } from './offer.js';
import { scienceNote } from '../cast/science.js';
import { applyWaitingPack, askName, refreshPack } from './unlock.js';

const MOMENTS = {
  25: 'A quarter of your lines learnt. The lights are coming up.',
  50: 'Halfway there. That is a lot of words you can say from memory.',
  75: 'Three quarters learnt. The end is in sight.',
  100: 'Every line learnt. Amazing work.',
};
const DIPPED = 'Your % dipped because a line slipped. That is normal. Get it right again and it comes back.';
const AT_ZERO = 'Every line starts here. Your % grows as you learn.';

export function lightsOf(lights) {
  return h(
    'ul',
    { class: 'lights', 'aria-label': 'Your scenes' },
    lights.map((l) =>
      h(
        'li',
        { class: l.percent >= 100 ? 'light lit' : l.percent > 0 ? 'light warm' : 'light' },
        h('span', { class: 'lamp', 'aria-hidden': 'true' }, h('span', { class: 'lamp-fill', style: { opacity: String(0.25 + (0.75 * l.percent) / 100) } })),
        h('span', { class: 'light-name' }, l.heading),
        h('span', { class: 'light-pc' }, `${l.percent}%`),
      ),
    ),
  );
}

export function showStage(ctx) {
  let refreshed = false;
  let dipped = false; // these stay said for as long as this screen is up
  let updated = false;

  const nav = ctx.nav;

  async function render() {
    if (ctx.nav !== nav) return;
    if (ctx.member && !(await ctx.store.get('myName'))) return askName(ctx, render);
    await applyWaitingPack(ctx).catch(() => {});
    updated = updated || ctx.linesUpdated;
    ctx.linesUpdated = false;
    await ctx.refreshEvents();
    const plan = ctx.plan();
    const percent = learntPercent(ctx.model, ctx.getState);
    const lights = sceneLights(ctx.model, ctx.getState);
    const fading = fadingCount(plan.ready, ctx.getState);
    const seen = (await ctx.store.get('seen')) || { percent: 0, lit: [], notes: 0 };
    const body = [];

    if (ctx.update) body.push(h('div', { class: 'notice' }, h('p', {}, 'A new version is ready.'), button('Update now', () => ctx.applyUpdate(), { class: 'btn' })));
    if (updated) body.push(h('p', { class: 'message', role: 'status' }, 'Your lines have been updated.'));
    if (ctx.member) body.push(h('p', { class: 'who' }, `Learning as ${ctx.member.name}`));

    // Each moment comes once ever, however the % goes up and down. A scene lit shows beside a
    // milestone; if several light at once, one comes each time.
    const best = seen.best ?? seen.percent;
    const milestone = crossed(best, percent);
    const lit = lights.find((l) => l.percent >= 100 && !seen.lit.includes(l.scene));
    const litWords = lit ? `${lit.heading} is lit. You know every line in it.` : null;
    const moment = [milestone ? `${milestone}%. ${MOMENTS[milestone]}` : null, litWords].filter(Boolean).join(' ');
    if (moment) body.push(h('div', { class: 'moment', role: 'status' }, milestone ? [h('p', { class: 'moment-big' }, `${milestone}%`), h('p', {}, MOMENTS[milestone])] : null, lit ? h('p', {}, litWords) : null));

    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': `${percent}% learnt` }, h('span', { class: 'ring-num', 'aria-hidden': 'true' }, `${percent}%`), h('span', { class: 'ring-word', 'aria-hidden': 'true' }, 'learnt'));
    ring.style.setProperty('--pc', String(percent));
    body.push(ring);

    dipped = dipped || percent < seen.percent;
    if (dipped) body.push(h('p', { class: 'fading' }, DIPPED));
    else if (percent === 0) body.push(h('p', { class: 'fading' }, AT_ZERO));

    if (fading) body.push(h('p', { class: 'fading' }, 'Some lines are ready for another go.'));
    else if (percent >= 100) body.push(h('p', { class: 'fading' }, 'You know every line. Keep them: lines fade if you stop using them.'));
    else if (plan.done) body.push(h('p', { class: 'fading' }, 'All caught up for now. Your brain needs the gap: it is part of how this works.'));

    // Above the scenes, where it is seen without scrolling.
    body.push(await reminderOffer(ctx));
    body.push(h('h2', {}, 'Your scenes'), lightsOf(lights));

    const runIsMain = plan.done && !plan.ahead.length;
    const run = (opts) => button('Run through', () => ctx.go('choose', { run: true }), opts);
    const main = runIsMain
      ? run({ class: 'btn primary' })
      : plan.done
        ? button('Learn more now', () => ctx.go('sprint', { extra: 'new' }), { class: 'btn primary' })
        : button(percent ? 'Next round' : 'Start learning', () => ctx.go('sprint'), { class: 'btn primary' });
    const footer = [
      main,
      h('div', { class: 'row' }, button('Walk', () => ctx.go('walk')), plan.done ? null : button('Quick round', () => ctx.go('sprint', { scope: plan.tests.length ? 'tests' : 'all', minutes: 2 }))),
      h('div', { class: 'row' }, runIsMain ? null : run(), button('Choose', () => ctx.go('choose'))),
      h('div', { class: 'row' }, button('Read my lines', () => ctx.go('scenes')), button('Settings', () => ctx.go('settings'))),
    ];
    if (ctx.nav !== nav) return; // they have moved on while this was drawing
    clear(ctx.root).append(screen({ title: 'Your lines', body, footer, className: 'today' }));
    // Marked now it is on show, not before: only what was shown counts as seen.
    if (percent !== seen.percent || percent > best || lit) await ctx.store.set('seen', { ...seen, percent, best: Math.max(best, percent), lit: lit ? [...seen.lit, lit.scene] : seen.lit });
    if (moment) announce(moment);
    report(ctx);
    if (!refreshed) {
      refreshed = true;
      if (ctx.keys) {
        refreshPack(ctx, () => ctx.nav === nav).then((changed) => {
          if (changed && ctx.nav === nav) redraw();
          if (ctx.model) sync(ctx);
        });
      }
    }
  }

  // Drawing again drops the focus, so it goes to the top.
  const redraw = () => render().then(() => ctx.nav === nav && focusHeading(ctx.root));
  const onVisible = () => {
    if (document.visibilityState === 'visible') redraw();
  };
  const onUpdate = () => redraw();
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('offscript:update', onUpdate);
  return render().then(() => () => {
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('offscript:update', onUpdate);
  });
}

export { scienceNote };
