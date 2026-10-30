// Already know some? A typed check of lines not yet learned, scene by scene, so nobody has to start
// from the top. Right: the line is learned, and comes back as a normal check. Wrong: nothing is held
// against it, and it is taught as new. Two misses in a row end that scene.
import { h, clear, screen, button, announce, focusHeading, plural, settled } from './dom.js';
import { createTypeCheck, makeResult } from '../grade.js';
import { keypad } from './keypad.js';
import { cueBlock, tokenView } from './sprint.js';
import { cueOf } from '../items.js';
import { applyKnown } from '../state.js';
import { dayKey } from '../dates.js';
import { learntPercent } from '../cast/proof.js';

const STOP_AFTER = 2; // misses in a row that end a scene

export const linesToCheck = (model, getState) => model.items.filter((it) => getState(it.id).status === 'new').map((it) => it.id);

export function showCheckin(ctx, { intro = false } = {}) {
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

  const queue = linesToCheck(ctx.model, ctx.getState);
  let right = 0;
  let asked = 0;

  function ask() {
    show(
      'Already know some?',
      [
        h('p', { class: 'lead' }, intro ? 'Have you already learnt any of your lines?' : 'Check what you know, and skip what you have already learnt.'),
        h('p', {}, 'If you have, a quick check will start you in the right place. You get each cue, and you type the first letter of every word. Any you do not know yet, you will just learn.'),
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
      draw();
      announce(`${r.correct ? '' : 'Missed: '}${tokens[r.index].d}`);
      if (!r.done) return;
      quiet();
      saved(pos, missesInRow, item, makeResult({ misses: check.misses, mode: 'type' }));
    });
    show(
      ctx.model.scenes[item.scene].heading,
      [h('p', { class: 'where' }, `Checking your lines: ${asked + 1}`), cueBlock(cueOf(ctx.index, item)), h('p', { class: 'speaker' }, item.speaker), line, h('p', { class: 'help' }, 'Tap the first letter of each word. ? shows the next word.')],
      [pad.el, button('That is enough, teach me', settled(finish), { class: 'btn link' })],
      'keyboard',
    );
    removeKeys = pad.remove;
  }

  async function saved(pos, missesInRow, item, result) {
    asked += 1;
    if (result.pass) {
      right += 1;
      const time = Date.now();
      const prev = ctx.getState(item.id);
      const state = applyKnown(prev, { day: dayKey(new Date(time)), time });
      await ctx.saveAnswer({ event: { time, day: state.lastDay, id: item.id, pass: true, mode: 'type', queue: 'known', misses: 0, speakerWrong: false, relearn: false, prev }, state });
    }
    const inRow = result.pass ? 0 : missesInRow + 1;
    if (inRow < STOP_AFTER) return next(pos + 1, inRow);
    const skip = queue.findIndex((id, i) => i > pos && ctx.index.byId.get(id).scene !== item.scene);
    next(skip < 0 ? queue.length : skip, 0);
  }

  function finish() {
    const percent = learntPercent(ctx.model, ctx.getState);
    show(
      'All checked',
      [h('p', { class: 'lead' }, right ? `You already know ${plural(right, 'line')}. That makes you ${percent}% learnt.` : 'No problem. You will learn them all from here, one step at a time.'), right ? h('p', {}, 'Those lines will come back later, to check they have stuck.') : null],
      [button('Start learning', settled(() => ctx.go('today')), { class: 'btn primary' })],
    );
  }

  ask();
  return quiet;
}
