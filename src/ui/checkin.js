// Already know some? A typed check of lines not yet learned, scene by scene, so nobody has to start
// from the top. Each line gets one try, for good. Right: the line is not taught, and has to be typed
// right once more on another day to count towards the %, since nothing here stops a script being open
// on the desk. Wrong: nothing is held against it, and it is taught as new. Two misses in a row end
// that scene.
import { h, clear, screen, button, announce, focusHeading, plural, settled } from './dom.js';
import { createTypeCheck, makeResult } from '../grade.js';
import { keypad } from './keypad.js';
import { cueBlock, keepInView, newestWord, tokenView } from './sprint.js';
import { cueOf } from '../items.js';
import { applyKnown } from '../state.js';
import { dayKey } from '../dates.js';

const STOP_AFTER = 2; // misses in a row that end a scene
const TRIED = 'checkTried'; // the ids of lines already tried here; kept when a pupil starts again

export const linesToCheck = (model, getState, tried = new Set()) => model.items.filter((it) => getState(it.id).status === 'new' && !tried.has(it.id)).map((it) => it.id);

export async function showCheckin(ctx, { intro = false } = {}) {
  let removeKeys = null;
  const quiet = () => {
    if (removeKeys) removeKeys();
    removeKeys = null;
  };
  const show = (title, body, footer, footerClass = '') => {
    quiet();
    clear(ctx.root).append(screen({ title, body, footer, footerClass, back: intro ? null : settled(() => ctx.go('today')) }));
    focusHeading(ctx.root);
  };

  const tried = new Set((await ctx.store.get(TRIED)) || []);
  const queue = linesToCheck(ctx.model, ctx.getState, tried);
  let right = 0;
  let last = null; // how the line before went: { pass, text }

  // A key on a line uses its one try, so leaving part way cannot save it for another go.
  function markTried(id) {
    if (tried.has(id)) return;
    tried.add(id);
    ctx.store.set(TRIED, [...tried]);
  }

  // How the line before went, on the screen that follows it, and said aloud.
  function lastResult() {
    if (!last) return null;
    announce(last.text);
    return h('p', { class: `result ${last.pass ? 'perfect' : 'misses'}` }, h('span', { class: 'icon', 'aria-hidden': 'true' }, last.pass ? '✓' : '✕'), h('span', {}, last.text));
  }

  function ask() {
    if (!queue.length) {
      return show('Already know some?', [h('p', { class: 'lead' }, 'You have checked all you can.'), h('p', {}, 'Each line gets one try, and the rest are ready for you to learn.')], [button('Back to your lines', settled(() => ctx.go('today')), { class: 'btn primary' })]);
    }
    show(
      'Already know some?',
      [
        h('p', { class: 'lead' }, intro ? 'Have you already learnt any of your lines?' : 'Check what you know, and skip what you have already learnt.'),
        h('p', {}, 'If you have, a quick check will start you in the right place. You get each cue, and you type the first letter of every word. Each line gets one try. Any you do not know yet, you will just learn.'),
      ],
      [button('Yes, check what I know', settled(() => next(0, 0)), { class: 'btn primary' }), button(intro ? 'No, start from the beginning' : 'Not now', settled(() => ctx.go('today')))],
    );
  }

  function next(pos, missesInRow) {
    if (pos >= queue.length) return finish();
    const item = ctx.index.byId.get(queue[pos]);
    const tokens = item.tokens;
    const check = createTypeCheck(tokens);
    const line = h('p', { class: 'line answer' });
    const draw = () => clear(line).append(...tokenView(tokens, check.shownUpTo, new Set(check.misses)));
    draw();
    const pad = keypad((key) => {
      const r = key === '?' ? check.reveal() : check.press(key);
      if (!r) return;
      markTried(item.id);
      draw();
      keepInView(ctx.root, newestWord(line));
      announce(`${r.correct ? '' : 'Missed: '}${tokens[r.index].d}`);
      if (!r.done) return;
      quiet();
      saved(pos, missesInRow, item, makeResult({ misses: check.misses, mode: 'type' }));
    });
    show(
      ctx.model.scenes[item.scene].heading,
      [lastResult(), h('p', { class: 'where' }, `Checking your lines: ${pos + 1} of ${queue.length}`), cueBlock(cueOf(ctx.index, item)), h('p', { class: 'speaker' }, item.speaker), line, h('p', { class: 'help' }, 'Tap the first letter of each word. ? shows the next word.')],
      [pad.el, button('That is enough, teach me', settled(finish), { class: 'btn link' })],
      'keyboard',
    );
    removeKeys = pad.remove;
  }

  async function saved(pos, missesInRow, item, result) {
    if (result.pass) {
      right += 1;
      const time = Date.now();
      const prev = ctx.getState(item.id);
      const state = applyKnown(prev, { day: dayKey(new Date(time)), time });
      await ctx.saveAnswer({ event: { time, day: state.lastDay, id: item.id, pass: true, mode: 'type', queue: 'known', misses: 0, speakerWrong: false, relearn: false, prev }, state });
    }
    const inRow = result.pass ? 0 : missesInRow + 1;
    last = { pass: result.pass, text: result.pass ? 'Word perfect.' : 'Not this one yet. You will learn it.' };
    if (inRow < STOP_AFTER) return next(pos + 1, inRow);
    const skip = queue.findIndex((id, i) => i > pos && ctx.index.byId.get(id).scene !== item.scene);
    const to = skip < 0 ? queue.length : skip;
    if (to > pos + 1) last.text += ' That is two in a row, so we will skip the rest of this scene.';
    next(to, 0);
  }

  function finish() {
    show(
      'All checked',
      [
        lastResult(),
        h('p', { class: 'lead' }, right ? `You already know ${plural(right, 'line')}.` : 'No problem. You will learn them all from here, one step at a time.'),
        right ? h('p', {}, 'These lines will not need teaching. Type each one once more on another day and it counts towards your %.') : null,
      ],
      [button('Start learning', settled(() => ctx.go('today')), { class: 'btn primary' })],
    );
  }

  ask();
  return quiet;
}
