// Your lines: how much is learnt, the streaks, a stage light for each scene, and one obvious next
// thing. No dates: only the %, what has been won and what to do now.
import { h, clear, screen, button, announce, focusHeading, settled } from './dom.js';
import { rewardCard, streakBlock } from './badges.js';
import { crossed, fadingCount, learntPercent, sceneLights } from '../cast/proof.js';
import { report } from '../cast/progress.js';
import { sync } from '../cast/reminders.js';
import { needsPrompt, reminderOffer, reminderPrompt } from './offer.js';
import { scienceNote } from '../cast/science.js';
import { applyWaitingPack, askName, refreshPack } from './unlock.js';
import { ENDS } from '../cast/config.js';

const MOMENTS = {
  25: 'A quarter of your lines learnt. The lights are coming up.',
  50: 'Halfway there. That is a lot of words you can say from memory.',
  75: 'Three quarters learnt. The end is in sight.',
  100: 'Every line learnt. Amazing work.',
};
const DIPPED = 'Your % dipped because a line slipped. That is normal. Get it right again on another day and it comes back.';
const AT_ZERO = 'Every line starts here. Your % grows as you learn. Several rounds a day works best.';
const ON_WAY = 'Your lines are on their way. Each one counts towards your % once you can still do it on another day.';

export function lightsOf(lights, open) {
  return h(
    'ul',
    { class: 'lights', 'aria-label': 'Your scenes' },
    lights.map((l) =>
      h(
        'li',
        {},
        button(
          [
            h('span', { class: 'lamp', 'aria-hidden': 'true' }, h('span', { class: 'lamp-fill', style: { opacity: String(0.25 + (0.75 * l.percent) / 100) } })),
            h('span', { class: 'light-name' }, l.heading),
            h('span', { class: 'light-pc' }, `${l.percent}%`),
          ],
          () => open(l.scene),
          { class: l.percent >= 100 ? 'light lit' : l.percent > 0 ? 'light warm' : 'light' },
        ),
      ),
    ),
  );
}

// What Your lines keeps out of the way: one thing to do there, and everything else a tap away.
export function showMore(ctx) {
  const plan = ctx.plan();
  const entry = (title, what, go) => h('li', {}, button([h('strong', {}, title), h('span', {}, what)], go));
  ctx.root.append(
    screen({
      title: 'More',
      back: () => ctx.go('today'),
      backLabel: 'Your lines',
      body: [
        h(
          'ul',
          { class: 'scene-list' },
          plan.done ? null : entry('Quick go', 'Two minutes, when you have no time for more. It adds to your next round.', () => ctx.go('sprint', { scope: plan.tests.length ? 'tests' : 'all', minutes: 2 })),
          runIsMain(plan) ? null : entry('Run through', 'What you know so far, in script order.', () => ctx.go('choose', { run: true })),
          entry('Choose', 'Pick a scene and how much help you want.', () => ctx.go('choose')),
          entry('Read my lines', 'Read a scene, or hear it read aloud.', () => ctx.go('scenes')),
          entry('Badges', 'What you have won, and what is still to win.', () => ctx.go('badges')),
          entry('Settings', 'Text size, colours, reminders and your name.', () => ctx.go('settings')),
        ),
      ],
    }),
  );
}

const runIsMain = (plan) => plan.done && !plan.ahead.length;

export function showStage(ctx) {
  let refreshed = false;
  let dipped = false; // these stay said for as long as this screen is up
  let updated = false;
  let asking = false;

  const nav = ctx.nav;

  async function render() {
    if (ctx.nav !== nav) return;
    if (asking) return; // what they are typing stays
    if (ctx.member && !(await ctx.store.get('myName'))) {
      asking = true;
      return askName(ctx, () => {
        asking = false;
        render();
      });
    }
    if (ctx.member && (await needsPrompt(ctx))) {
      asking = true;
      return reminderPrompt(ctx, {
        title: 'Don’t lose your streak',
        words: 'Enable reminders to help you keep your lines fresh and ready.',
        then: () => {
          asking = false;
          render();
        },
      });
    }
    await applyWaitingPack(ctx).catch(() => {});
    updated = updated || ctx.linesUpdated;
    ctx.linesUpdated = false;
    await ctx.refreshEvents();
    ctx.refit();
    const plan = ctx.plan();
    const percent = learntPercent(ctx.model, ctx.getState);
    const lights = sceneLights(ctx.model, ctx.getState);
    const fading = fadingCount(plan.ready, ctx.getState);
    const seen = (await ctx.store.get('seen')) || { percent: 0, lit: [], notes: 0 };
    const started = [...ctx.states.values()].some((s) => s.status !== 'new');
    const body = [];

    if (ctx.update) body.push(h('div', { class: 'notice' }, h('p', {}, 'A new version is ready.'), button('Update now', () => ctx.applyUpdate(), { class: 'btn' })));
    if (updated) body.push(h('p', { class: 'message', role: 'status' }, 'Your lines have been updated.'));
    if (ctx.memberGone) body.push(h('p', { class: 'message' }, 'These lines are no longer on the cast list. Ask your director.'));
    if (ctx.member) body.push(h('p', { class: 'who' }, `Learning as ${ctx.member.name}`));

    // Each moment comes once ever, however the % goes up and down. A scene lit shows beside a
    // milestone; if several light at once, one comes each time.
    const best = seen.best ?? seen.percent;
    const milestone = crossed(best, percent);
    const lit = lights.find((l) => l.percent >= 100 && !seen.lit.includes(l.scene));
    const litWords = lit ? `${lit.heading} is lit. You know every line in it.` : null;
    const moment = [milestone ? `${milestone}%. ${MOMENTS[milestone]}` : null, litWords].filter(Boolean).join(' ');
    if (moment) body.push(h('div', { class: 'moment', role: 'status' }, milestone ? [h('p', { class: 'moment-big' }, `${milestone}%`), h('p', {}, MOMENTS[milestone])] : null, lit ? h('p', {}, litWords) : null));

    const rewardAt = body.length;
    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': `${percent}% learnt` }, h('span', { class: 'ring-num', 'aria-hidden': 'true' }, `${percent}%`), h('span', { class: 'ring-word', 'aria-hidden': 'true' }, 'learnt'));
    ring.style.setProperty('--pc', String(percent));
    body.push(ring);

    dipped = dipped || percent < seen.percent;
    if (dipped) body.push(h('p', { class: 'fading' }, DIPPED));
    else if (percent === 0) body.push(h('p', { class: 'fading' }, started ? ON_WAY : AT_ZERO));

    if (fading) body.push(h('p', { class: 'fading' }, 'Some lines are ready for another go.'));
    else if (percent >= 100) body.push(h('p', { class: 'fading' }, 'You know every line. Keep them: lines fade if you stop using them.'));
    else if (plan.done) body.push(h('p', { class: 'fading' }, 'All caught up for now. Have a break, then come back for another round: several rounds a day, spread out, is what works.'));

    body.push(streakBlock(ctx));

    // Above the scenes, where it is seen without scrolling.
    body.push(await reminderOffer(ctx));
    body.push(h('h2', {}, 'Your scenes'), lightsOf(lights, (scene) => ctx.go('scene', { scene })));

    const main = runIsMain(plan)
      ? button('Run through', () => ctx.go('choose', { run: true }), { class: 'btn primary' })
      : plan.done
        ? button('Learn more now', () => ctx.go('sprint', { extra: 'new' }), { class: 'btn primary' })
        : button(started ? 'Next round' : 'Start learning', () => ctx.go('sprint'), { class: 'btn primary' });
    const footer = [main, h('div', { class: 'row' }, button('Walk', () => ctx.go('walk')), button('More', () => ctx.go('more')))];
    if (ctx.nav !== nav) return; // they have moved on while this was drawing
    body.splice(rewardAt, 0, rewardCard(ctx));
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
    if (document.visibilityState !== 'visible') return;
    if (ctx.today() > ENDS) ctx.go('ended');
    else redraw();
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
