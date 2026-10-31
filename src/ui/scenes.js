// Scenes: the play scene by scene, and a reader for each: speech numbers, speakers in bold,
// directions in square brackets (never italics), on screen text marked as such.
import { h, screen, button, announce, settled } from './dom.js';
import { linesToCheck } from './checkin.js';
import { sceneLights } from '../cast/proof.js';
import { progressOf } from '../plan.js';
import { bracketParens } from '../items.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';

// A scene tapped on Your lines: what to do with it, in the fewest words. A new line learnt here is a
// normal round, so it counts. Going over lines already started is practice: it says so.
export function showScene(ctx, { scene: index }) {
  const scene = ctx.model.scenes[index];
  const percent = sceneLights(ctx.model, ctx.getState).find((l) => l.scene === index)?.percent ?? 0;
  const fresh = scene.itemIds.some((id) => ctx.getState(id).status === 'new');
  const started = scene.itemIds.some((id) => ctx.getState(id).status !== 'new');
  const learn = settled(async () => {
    await ctx.saveSettings({ focusScene: index });
    ctx.go('sprint');
  });
  const practise = () => ctx.go('sprint', { custom: { scene: index, itemIds: [...scene.itemIds] } });
  ctx.root.append(
    screen({
      title: scene.heading,
      back: () => ctx.go('today'),
      backLabel: 'Your lines',
      body: [h('p', { class: 'lead' }, `${percent}% learnt`), started ? h('p', { class: 'help' }, 'Practising a scene gets you ready. Your % moves in your next round.') : null],
      footer: [
        fresh ? button('Learn this scene', learn, { class: 'btn primary' }) : null,
        started ? button('Practise this scene', practise, { class: fresh ? 'btn' : 'btn primary' }) : null,
        button('Read this scene', () => ctx.go('reader', { scene: index, from: 'scene' })),
      ].filter(Boolean),
    }),
  );
}

export function showScenes(ctx) {
  const progress = progressOf(ctx.model, ctx.index, ctx.getState);
  const focus = ctx.settings.focusScene;
  const check = button('Already know some? Check them', () => ctx.go('checkin'));
  // Each line has one try, so the offer goes once none is left to try.
  ctx.store.get('checkTried').then((tried) => {
    if (!linesToCheck(ctx.model, ctx.getState, new Set(tried || [])).length) check.remove();
  });
  ctx.root.append(
    screen({
      title: 'Read my lines',
      back: () => ctx.go('today'),
      backLabel: 'Your lines',
      footer: [check],
      body: [
        h(
          'ul',
          { class: 'scene-list' },
          progress.scenes.filter((sc) => sc.words).map((sc) =>
            h(
              'li',
              {},
              button(
                [
                  h('strong', {}, sc.heading),
                  h('span', {}, `${sc.perfectSpeeches} of ${sc.speeches} lines word perfect`),
                  focus === sc.scene ? h('span', {}, 'Learning this scene next') : null,
                ],
                () => ctx.go('reader', { scene: sc.scene }),
              ),
            ),
          ),
        ),
      ],
    }),
  );
}

// Each part of the scene as the reader shows it, and what read aloud says for it (null: skipped).
function parts(scene) {
  return scene.reader.map((ev) => {
    if (ev.t === 'speech') {
      return {
        el: h('p', { class: 'speech' }, h('span', { class: 'n' }, String(ev.n)), h('strong', {}, ev.speaker), ' ', bracketParens(ev.text)),
        say: ev.itemIds.length ? `${ev.speaker}. ${ev.text}` : null,
      };
    }
    if (ev.t === 'screen') return { el: h('p', { class: 'on-screen' }, `[On screen] `, h('strong', {}, ev.speaker), ' ', ev.text), say: null };
    if (ev.t === 'placard') return { el: h('p', { class: 'dir' }, `[Placard: ${ev.text}]`), say: null };
    return { el: h('p', { class: 'dir' }, `[${ev.text}]`), say: null };
  });
}

export function showReader(ctx, { scene: index, from = 'scenes' }) {
  const scene = ctx.model.scenes[index];
  ctx.peek(scene.itemIds); // reading a line just before typing it would prove nothing
  const all = parts(scene);
  let reading = false;

  const readBtn = canSpeak()
    ? button('Read aloud', async () => {
        if (reading) return stopReading();
        reading = true;
        readBtn.textContent = 'Stop reading';
        for (const p of all) {
          if (!reading) break;
          if (!p.say) continue;
          p.el.classList.add('playing');
          p.el.scrollIntoView({ block: 'center' });
          await speak(p.say, { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate });
          p.el.classList.remove('playing');
        }
        stopReading();
      })
    : null;
  function stopReading() {
    reading = false;
    stopSpeaking();
    for (const p of all) p.el.classList.remove('playing');
    if (readBtn) readBtn.textContent = 'Read aloud';
  }

  const learned = scene.itemIds.some((id) => ctx.getState(id).status !== 'new');
  const allLearned = scene.itemIds.every((id) => ctx.getState(id).status === 'review');
  const focusBtn = allLearned
    ? null
    : button(
        'Learn this scene next',
        async () => {
          const on = ctx.settings.focusScene !== index;
          await ctx.saveSettings({ focusScene: on ? index : null });
          focusBtn.setAttribute('aria-pressed', String(on));
          announce(on ? `${scene.heading} comes next in new lines` : 'Back to running order');
        },
        { pressed: String(ctx.settings.focusScene === index) },
      );

  const footer = scene.itemIds.length
    ? [
        button(learned ? 'Run this scene' : 'Try a run of this scene', () => ctx.go('sprint', { custom: { scene: index, itemIds: [...scene.itemIds] } }), { class: 'btn primary' }),
        h('div', { class: 'row' }, [focusBtn, readBtn].filter(Boolean)),
      ]
    : [];

  ctx.root.append(
    screen({
      title: scene.heading,
      back: () => ctx.go(from, { scene: index }),
      body: [
        h('div', { class: 'reader' }, all.map((p) => p.el)),
        learned
          ? h(
              'div',
              { class: 'stack' },
              h('p', { class: 'help' }, 'Its lines go back to not started, to learn them again from the beginning.'),
              button('Start this scene again', settled(() => ctx.go('again', { scene: index }))),
            )
          : null,
      ],
      footer,
    }),
  );
  return () => stopReading();
}
