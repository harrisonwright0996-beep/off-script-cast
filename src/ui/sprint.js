// The sprint: one card at a time from the session (session.js), answered on the keypad (Type) or by
// tapping the words missed (Say); a card with help on it is always said. Every answer is saved at once,
// and so is the sprint, so closing the app loses nothing. Time is a slim bar that only moves when he
// does something; at time up nothing new comes, only the lines still to finish, then Sprint done.
import { h, clear, screen, button, announce, focusHeading, num, plural, drawn, settled } from './dom.js';
import { gainLine, isLearnt, learntPercent } from '../cast/proof.js';
import { createSession } from '../session.js';
import { createTypeCheck, onlySlip, sayMisses, makeResult, describeResult, repeatMisses, troubleNote } from '../grade.js';
import { blankOf, firstLettersOf, gapsOf, lettersShown } from '../tokens.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';
import { rewardCard, roundMinutesLine } from './badges.js';
import { hearCue } from './hearcue.js';
import { keypad, TYPE_HINT } from './keypad.js';
import { reminderOffer } from './offer.js';
import { sync } from '../cast/reminders.js';
import { scienceNote } from '../cast/science.js';

const SAVED = 'sprint';
const AGAIN = 'Come back for another round later today. Several rounds a day, spread out, is what makes lines stick.';
export const PRACTICE = 'practice'; // a chosen practice, saved apart from the day's sprint
const IDLE_CAP = 150000; // a longer pause between taps was a break: it is not counted as sprint time
const AUTO_ADVANCE_MS = 1200;
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

// The line as it has been answered so far, misses marked with a cross as well as colour.
export function tokenView(tokens, upTo = tokens.length, misses = new Set()) {
  const out = [];
  for (let i = 0; i < upTo; i++) {
    const t = tokens[i];
    if (misses.has(i)) {
      out.push(h('span', { class: 'tok miss' }, t.d, h('span', { class: 'cross', 'aria-hidden': 'true' }, '✕'), h('span', { class: 'visually-hidden' }, ' (missed)')));
    } else out.push(h('span', { class: t.k === null ? 'tok note' : 'tok' }, t.d));
    out.push(t.a);
  }
  return out;
}

// The cue: who speaks and what they say, or the start of a scene. A cue made longer, so that only
// one line fits, shows the lines before it too, and which time it comes if the exchange repeats.
export function cueBlock(cue, hear = null) {
  const say = (l) => (l.speaker === null ? h('p', {}, `Start of ${l.text}`) : h('p', {}, h('strong', {}, l.speaker), ': ', l.text));
  const nth = cue.nth ? h('p', { class: 'note' }, `The ${ORDINALS[cue.nth - 1] || `number ${cue.nth}`} time these lines come in the scene.`) : null;
  return h('div', { class: 'cue' }, h('div', { class: 'cue-top' }, h('p', { class: 'cue-label' }, 'Cue'), hear), (cue.lines || [cue]).map(say), cue.notes.map((n) => h('p', { class: 'note' }, n)), nth);
}

const blankView = (t, drawn = blankOf(t)) => h('span', { class: 'blank' }, h('span', { 'aria-hidden': 'true' }, drawn), h('span', { class: 'visually-hidden' }, ` ${blankOf(t).replace('_', 'blank')} `));

// A first letters card's line: the first letters where the card shows them, a blank for each other
// word (session.js says how many to show).
export function lettersView(tokens, shown) {
  const out = [];
  tokens.forEach((t, i) => {
    out.push(t.k === null || shown.has(i) ? firstLettersOf(t) : blankView(t));
    if (i < tokens.length - 1) out.push(t.a);
  });
  return out;
}

// A gaps card's line: every word but those taken out, each a gap long enough to see among whole words.
export function gapsView(tokens, gaps) {
  const out = [];
  tokens.forEach((t, i) => {
    out.push(gaps.has(i) ? blankView(t, blankOf(t).replace('_', '____')) : h('span', { class: t.k === null ? 'tok note' : 'tok' }, t.d));
    if (i < tokens.length - 1) out.push(t.a);
  });
  return out;
}

export function statsLine(st) {
  const parts = [`${plural(st.answered, 'answer')}, ${num(st.perfect)} word perfect.`];
  if (st.learnedItems) parts.push(`${plural(st.learnedItems, 'line')} learnt (${plural(st.learnedWords, 'word')}).`);
  return parts.join(' ');
}

// The page scrolls behind the bar and the footer (the keypad, or the buttons), so a long cue and a
// long line can push the line being answered out of sight. Scrolls down just enough to show `el`
// above the footer, keeping its top below the bar.
export function keepInView(root, el) {
  if (!el || !el.isConnected) return;
  const bar = root.querySelector('.bar');
  const foot = root.querySelector('footer');
  const top = bar ? bar.getBoundingClientRect().bottom : 0;
  const bottom = foot ? foot.getBoundingClientRect().top : window.innerHeight;
  const r = el.getBoundingClientRect();
  const by = Math.min(r.bottom + 8 - bottom, r.top - 8 - top);
  if (by > 0) window.scrollBy(0, by);
}

// The word just answered: on a long line the whole line may not fit above the keypad.
export const newestWord = (line) => line.lastElementChild || line;

const minus = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - (b[k] || 0)]));

// After an answer that leaves a line still to finish: how it comes back.
const COMES_BACK = {
  help: 'It comes back later with the first letters, then without.',
  clean: 'It comes back later without the first letters.',
  read: 'It comes back later to read first.',
};
const comesBack = (rec) => (rec.back ? 'Once more, with a little more help.' : rec.later ? COMES_BACK[rec.need] : null);
// A go with help on it, right.
const RIGHT_WITH = { gaps: 'Right with the gaps', help: 'Right with the first letters' };

// scope: 'all' or 'tests' (Just 2 minutes). minutes: a Quick go's length. Otherwise a round ends as the
// day's good practice reaches a whole round, so minutes done in an earlier sitting are kept.
// custom: { scene, itemIds } for Run this scene. extra: 'new' or 'runs' to keep going after the plan.
// practice: a chosen practice ({ scene, which, help, itemIds, title, run }; run: a Run through), or
// 'resume' to carry on the one saved.
export async function showSprint(ctx, { scope = 'all', minutes = null, custom = null, extra = null, practice = null } = {}) {
  const today = ctx.today();
  const short = minutes != null;
  const perRound = ctx.settings.sprintMinutes * 60;
  const roundEnd = (Math.floor(ctx.practiceToday() / perRound) + 1) * perRound;
  const key = practice ? PRACTICE : SAVED;
  const resumable = !!practice || (scope === 'all' && !custom);
  const fresh = !!practice && practice !== 'resume'; // a new chosen practice starts afresh
  const saved = resumable && !fresh ? await ctx.store.get(key) : null;
  const usable = !!saved && saved.day === today && saved.hash === ctx.model.hash;
  if (practice === 'resume' && !usable) return ctx.go('choose');
  ctx.refit();

  const session = createSession({
    model: ctx.model,
    index: ctx.index,
    getPlan: () => ctx.plan(),
    getState: ctx.getState,
    settings: ctx.settings,
    scope,
    custom: fresh ? practice : custom,
    saved: usable ? saved.state : null,
    peeked: ctx.peeked,
  });
  const chosen = practice ? session.state.custom : null; // the chosen practice under way
  const startStats = { ...session.stats };
  const startPercent = learntPercent(ctx.model, ctx.getState);
  const practised = new Set(); // lines answered on this screen
  const undo = [];
  // A short round is a fresh go at the clock, even when it carries on a longer one that was stopped.
  let elapsed = usable && !short ? saved.elapsed || 0 : 0;
  let last = Date.now();
  let mode = ctx.settings.mode;
  let removeKeys = null;
  let autoTimer = null;
  let breakTimer = null;
  let finished = false;
  let held = null; // a miss being saved at its first wrong key
  let slipRec = null; // the last answer, when it may yet be counted a slip of the finger

  const heading = (scene) => ctx.model.scenes[scene].heading;
  const speakerName = (it) => (it.part > 0 ? `${it.speaker}, continuing` : it.speaker);

  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === 'visible') elapsed += Math.min(now - last, IDLE_CAP);
    last = now;
  };
  // A practice or a run they chose goes to its end, however long that takes.
  const timeUp = () => !practice && !custom && (short ? elapsed >= minutes * 60000 : ctx.practiceToday() >= roundEnd);

  let answeredAt = elapsed; // the sprint clock at the last answer
  let hiddenAt = 0; // when the app last went into the background
  let shownAt = 0; // and when it last came back
  // How long an answer took since `start`, or null when the app was away meanwhile or it was a break.
  const timed = (start) => {
    const ms = Date.now() - start;
    return hiddenAt >= start || shownAt > start || ms > IDLE_CAP ? null : ms;
  };

  // One thing at a time: while an answer or a step is being saved, other taps are let go, so a quick
  // second tap can never act on the card after, or on an answer already changed.
  let busy = false;
  async function once(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  }
  // A control's action. A touch on it just as it was drawn was the second tap of a double tap on
  // what was there before, and does nothing (dom.js).
  const act = (fn) => settled((...args) => once(() => fn(...args)));

  async function saveSprint() {
    if (!resumable) return;
    await ctx.store.set(key, { day: today, hash: ctx.model.hash, state: session.save(), elapsed: finished ? 0 : elapsed });
  }

  function quiet() {
    if (removeKeys) removeKeys();
    removeKeys = null;
    clearTimeout(autoTimer);
    autoTimer = null;
    stopSpeaking();
  }

  function where(c) {
    const it = c.item;
    const part = it.parts > 1 ? `, part ${it.part + 1} of ${it.parts}` : '';
    if (c.progress) return h('p', { class: 'where' }, `Line ${c.progress.pos} of ${c.progress.total}, line ${it.n}${part}`);
    const rung = c.rung ? `, step ${c.rung.pos} of ${c.rung.total}` : '';
    return h('p', { class: 'where' }, `${heading(it.scene)}, line ${it.n}${part}${rung}`);
  }

  const readAloud = (text) =>
    canSpeak() ? button('Read aloud', () => speak(text, { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate })) : null;

  // Draws a card: the bar, where it is, any message, then the card's own content and actions.
  function frame(c, content, footer, footerClass = '') {
    quiet();
    const actions = undo.length ? [button('Undo', act(doUndo), { class: 'btn link', aria: 'Undo last answer' })] : [];
    const body = [where(c), c.message ? h('p', { class: 'message', role: 'status' }, c.message) : null, ...content];
    clear(ctx.root).append(screen({ title: c.label, back: act(stop), backLabel: 'Stop', actions, body, footer, footerClass, className: 'sprint' }));
    window.scrollTo(0, 0); // each card starts at its cue
  }

  function showCard(c, focus = true) {
    ctx.card = c; // the card on show, for browser tests
    if (c.step === 'test') {
      frame(c, [cueBlock(c.cue, hearCue(ctx, c.item, c.cue)), h('p', { class: 'prompt' }, 'Do you know the next line?')], [
        button('Try it', act(() => choose('try')), { class: 'btn primary' }),
        button('Teach me', act(() => choose('teach'))),
      ]);
    } else if (c.step === 'front') {
      frame(
        c,
        [cueBlock(c.cue, hearCue(ctx, c.item, c.cue)), h('p', { class: 'speaker' }, c.item.speaker), h('p', { class: 'line' }, tokenView(c.item.tokens)), h('p', { class: 'prompt' }, c.prompt)],
        [button('Next', act(() => choose('next')), { class: 'btn primary' }), readAloud(c.item.text)].filter(Boolean),
      );
    } else if (c.step === 'help' || c.step === 'gaps') helpCard(c);
    else floor(c);
    if (focus) focusHeading(ctx.root);
  }

  async function choose(action) {
    tick();
    const c = session.choose(action);
    await saveSprint();
    showCard(c);
  }

  // Say: reveal the line, tap any word missed or changed, then Done with the words tapped.
  function sayCheck(tokens, answerArea, footBox, prompt, done, onReveal = () => {}) {
    const start = Date.now();
    answerArea.append(h('p', { class: 'prompt' }, prompt));
    clear(footBox).append(
      button('Reveal', act(() => {
        onReveal();
        const ms = timed(start);
        const tapped = new Set();
        const words = h('div', { class: 'words', role: 'group', 'aria-label': 'Tap any word you missed or changed' });
        tokens.forEach((t, i) => {
          if (t.k === null) {
            words.append(h('span', { class: 'word note-word' }, t.d));
            return;
          }
          const b = button(t.d, () => {
            if (tapped.has(i)) tapped.delete(i);
            else tapped.add(i);
            b.setAttribute('aria-pressed', String(tapped.has(i)));
          }, { class: 'word', pressed: 'false' });
          words.append(b);
        });
        clear(answerArea).append(h('p', { class: 'prompt' }, 'Tap any word you missed or changed.'), words);
        keepInView(ctx.root, answerArea);
        let sent = false; // a quick second tap is not a second answer
        clear(footBox).append(
          button('Done', act(() => {
            if (sent) return;
            sent = true;
            return done(sayMisses(tokens, tapped), ms);
          }), { class: 'btn primary' }),
        );
        drawn(); // Done comes up where Reveal was
        answerArea.focus({ preventScroll: true });
      }), { class: 'btn primary' }),
    );
  }

  // The words missed in a line before, from the answers the app keeps (token indices).
  const missedBefore = (id) => [...new Set(ctx.events.filter((e) => e.id === id && e.missed).flatMap((e) => e.missed))];

  // A line with help on it: the speaker and the line with some words taken out, or the first letters,
  // said aloud, then checked as in Say. On a long line the first letters thin out as it gets
  // stronger, with a blank for each word without its letter.
  function helpCard(c) {
    const item = c.item;
    const level = c.letters || 'all';
    const shown = lettersShown(item.tokens, level, level === 'missed' ? missedBefore(item.id) : []);
    const view = c.step === 'gaps' ? gapsView(item.tokens, gapsOf(item.tokens, c.turn)) : lettersView(item.tokens, shown);
    const answerArea = h('div', { class: 'answer-area', role: 'group', tabindex: '-1', 'aria-label': 'Your line' }, h('p', { class: 'line' }, view));
    const footBox = h('div', { class: 'stack-foot' });
    const blanks = item.tokens.some((t, i) => t.k !== null && !shown.has(i));
    const prompt = c.step === 'gaps' ? 'Say the whole line aloud, filling the gaps, then reveal it.' : blanks ? 'Say the whole line aloud, filling the blanks, then reveal it.' : 'Each letter starts a word. Say the whole line aloud, then reveal it.';
    frame(c, [cueBlock(c.cue, hearCue(ctx, c.item, c.cue)), h('p', { class: 'speaker' }, speakerName(item)), answerArea], [footBox]);
    sayCheck(item.tokens, answerArea, footBox, prompt, (misses, ms) => finish(c, makeResult({ misses, mode: 'say', ms })));
  }

  // Floor: from the cue alone. Who's next first (when the speaker changes), then the line.
  function floor(c) {
    const item = c.item;
    const tokens = item.tokens;
    let speakerWrong = false;
    const speakerArea = h('div', { class: 'speaker-area' });
    const answerArea = h('div', { class: 'answer-area', role: 'group', tabindex: '-1', 'aria-label': 'Your line' });
    const footBox = h('div', { class: 'stack-foot' });
    // Some goes have to be typed: saying a line is on trust, and these are the ones that count.
    const locked = !!(c.mustType || c.spot);
    const switchMode = locked
      ? null
      : button(mode === 'type' ? 'Say it instead' : 'Type it instead', act(() => {
          mode = mode === 'type' ? 'say' : 'type';
          ctx.saveSettings({ mode });
          floor(c);
          focusHeading(ctx.root);
        }), { class: 'btn link' });
    const spotText = c.spot ? 'Spot check: type this one.' : 'Type this one so it counts towards your %.';
    const spot = locked ? h('p', { class: 'spot' }, spotText) : null;

    frame(c, [cueBlock(c.cue, hearCue(ctx, c.item, c.cue)), spot, speakerArea, answerArea, switchMode], [footBox]);
    if (locked) announce(spotText);
    const foot = ctx.root.querySelector('footer');

    let answerStart = 0;
    const startAnswer = () => {
      answerStart = Date.now();
      if (locked || mode === 'type') typeAnswer();
      else sayAnswer();
      drawn(); // the keypad, or Reveal, comes up
    };

    if (c.askSpeaker) {
      speakerArea.append(h('p', { class: 'prompt', id: 'who' }, 'Who speaks next?'));
      const chips = h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'who' });
      for (const name of c.choices) {
        chips.append(
          button(name, act(() => {
            speakerWrong = name !== item.speaker;
            for (const b of chips.querySelectorAll('button')) {
              b.disabled = true;
              if (b.textContent === item.speaker) {
                b.classList.add('right');
                b.append(h('span', { 'aria-hidden': 'true' }, ' ✓'), h('span', { class: 'visually-hidden' }, ' (right)'));
              } else if (b.textContent === name) {
                b.classList.add('wrong');
                b.append(h('span', { 'aria-hidden': 'true' }, ' ✕'), h('span', { class: 'visually-hidden' }, ' (your choice)'));
              }
            }
            announce(speakerWrong ? `It was ${item.speaker}` : item.speaker);
            startAnswer();
            answerArea.focus({ preventScroll: true });
          }), { class: 'btn chip' }),
        );
      }
      speakerArea.append(chips);
      footBox.append(h('p', { class: 'help' }, 'Choose who speaks, then say or type the line.'));
    } else {
      speakerArea.append(h('p', { class: 'speaker' }, speakerName(item)));
      startAnswer();
    }

    function typeAnswer() {
      const check = createTypeCheck(tokens);
      const line = h('p', { class: 'line answer' });
      // Said or mouthed, a line is remembered better than in the head alone (the production effect).
      const hint = h('p', { class: 'help type-hint' }, TYPE_HINT);
      const draw = () => clear(line).append(...tokenView(tokens, check.shownUpTo, new Set(check.misses)));
      draw();
      answerArea.append(hint, line); // above the line, or the keypad would cover it on a small phone
      let firstMs;
      let missSaved = null;
      const pad = keypad((key) => {
        const r = key === '?' ? check.reveal() : check.press(key);
        if (!r) return;
        if (firstMs === undefined) firstMs = timed(answerStart);
        hint.remove();
        draw();
        keepInView(ctx.root, newestWord(line));
        announce(`${r.correct ? '' : 'Missed: '}${tokens[r.index].d}`);
        if (!r.correct && !missSaved) {
          if (switchMode) switchMode.remove();
          missSaved = holdMiss(makeResult({ misses: check.misses, speakerWrong, mode: 'type' }));
        }
        if (!r.done) return;
        const result = makeResult({ misses: check.misses, speakerWrong, mode: 'type', ms: timed(answerStart), firstMs, words: c.tested ? item.words : 0 });
        once(async () => {
          if (missSaved) await takeBack(await missSaved);
          await finish(c, result, { slipped: onlySlip(check, item.words, speakerWrong) });
        });
      });
      removeKeys = pad.remove;
      clear(footBox).append(pad.el);
      foot.className = 'foot keyboard';
      keepInView(ctx.root, hint);
    }

    function sayAnswer() {
      // The line on show, there is no typing it from memory now.
      const onReveal = () => {
        ctx.peek([item.id]);
        if (switchMode) switchMode.remove();
      };
      sayCheck(tokens, answerArea, footBox, 'Say it aloud, then reveal it.', (misses, ms) => finish(c, makeResult({ misses, speakerWrong, mode: 'say', ms, words: c.tested ? item.words : 0 })), onReveal);
    }
  }

  // Seconds on the cards since the answer before.
  const activeSeconds = () => Math.round((elapsed - answeredAt) / 100) / 10;

  // A wrong key shows the right word, so a miss counts from that moment. It is saved at once, so Stop,
  // a reload or the app closing cannot give him a clean card, and there is no Undo from here. If he
  // finishes the line, the whole answer takes its place (takeBack), with the chance to call it a slip.
  function holdMiss(result) {
    tick();
    const rec = session.answer(result);
    rec.event.active = activeSeconds();
    rec.before = answeredAt;
    undo.length = 0;
    for (const b of ctx.root.querySelectorAll('.bar-actions button')) b.remove();
    held = (async () => {
      await ctx.saveAnswer(rec);
      await saveSprint();
      return rec;
    })();
    return held;
  }

  async function takeBack(rec) {
    held = null;
    await ctx.undoAnswer(rec);
    session.restore(rec.snapshot);
  }

  async function finish(c, result, { slipped = false } = {}) {
    quiet();
    tick();
    const rec = session.answer(result);
    rec.event.active = activeSeconds();
    rec.before = answeredAt;
    answeredAt = elapsed;
    await ctx.saveAnswer(rec);
    practised.add(c.item.id);
    // Undo is for a wrong tap, not a look at the answer. A typed miss has shown the line, and so has a
    // slip counted right: going back would hand him a card he could now type word for word.
    const shownByKeys = result.misses.length > 0 && result.mode === 'type';
    slipRec = shownByKeys ? rec : null;
    // A miss takes a line out of the %, and only typing brings it back, so Undo cannot.
    const costProof = !result.pass && rec.event.prev.proved;
    if (shownByKeys || result.slip || costProof) undo.length = 0;
    else undo.push(rec);
    await saveSprint();
    const text = rec.help && result.pass ? RIGHT_WITH[c.step] : result.slip ? 'Counted right: a slip of the finger' : describeResult(result, c.item.tokens, c.item.speaker);
    const note = comesBack(rec);
    const earlier = ctx.events.filter((e) => e !== rec.event);
    const trouble = !result.misses.length ? null : troubleNote(c.item.tokens, repeatMisses(earlier, c.item.id, result.misses));
    announce([`${text}.`, trouble, note].filter(Boolean).join(' '));
    feedback(c, result, text, note, slipped && !result.pass, trouble, rec);
  }

  // He says the wrong key was only a slip of the finger: the answer is taken back and saved as right,
  // though it proves nothing. Only that answer: if it is no longer the last one saved, nothing happens.
  async function countRight(c, result, rec) {
    if (!rec || slipRec !== rec) return;
    slipRec = null;
    quiet();
    await ctx.undoAnswer(rec);
    answeredAt = rec.before;
    session.restore(rec.snapshot);
    await finish(c, makeResult({ misses: [], mode: result.mode, ms: result.ms, firstMs: result.firstMs, slip: true }));
  }

  function feedback(c, result, text, note, slipped = false, trouble = null, rec = null) {
    const misses = new Set(result.misses);
    const block = h(
      'p',
      { id: 'result', class: `result ${result.pass ? 'perfect' : 'misses'}` },
      h('span', { class: 'icon', 'aria-hidden': 'true' }, result.pass ? '✓' : '✕'),
      h('span', {}, text),
    );
    const nextButton = button('Next', act(next), { class: 'btn primary' });
    nextButton.setAttribute('aria-describedby', ['result', trouble && 'result-trouble', note && 'result-note'].filter(Boolean).join(' '));
    frame(
      { ...c, message: null },
      [
        cueBlock(c.cue, hearCue(ctx, c.item, c.cue)),
        h('p', { class: 'speaker' }, c.item.speaker),
        h('p', { class: 'line' }, tokenView(c.item.tokens, c.item.tokens.length, misses)),
        block,
        trouble ? h('p', { id: 'result-trouble', class: 'help trouble' }, trouble) : null,
        note ? h('p', { id: 'result-note', class: 'help' }, note) : null,
      ],
      [nextButton, slipped ? button('A slip of the finger? Count it right', act(() => countRight(c, result, rec))) : null].filter(Boolean),
    );
    ctx.root.querySelector('footer .btn').focus({ preventScroll: true });
    keepInView(ctx.root, block);
    if (result.pass && !result.misses.length && ctx.settings.autoAdvance) autoTimer = setTimeout(next, AUTO_ADVANCE_MS);
  }

  async function doUndo() {
    const rec = undo.pop();
    if (!rec) return;
    quiet();
    await ctx.undoAnswer(rec);
    answeredAt = rec.before;
    const c = session.restore(rec.snapshot, !rec.help && rec.event.mode === 'say' ? rec.event.id : null);
    await saveSprint();
    announce('Last answer undone');
    showCard(c);
  }

  // Shows the card `pick` gives. Once time is up nothing new comes: the lines the sprint still owes,
  // then Sprint done.
  function carryOn(pick) {
    if (timeUp()) session.close();
    const c = pick();
    if (!c) return session.closing ? timeIsUp() : planDone();
    saveSprint();
    showCard(c);
  }

  function next() {
    quiet();
    tick();
    carryOn(() => session.advance());
  }

  async function stop() {
    quiet();
    tick();
    await held;
    await saveSprint();
    ctx.go('today');
  }

  function plain(title, body, footer) {
    quiet();
    clear(ctx.root).append(screen({ title, back: act(stop), backLabel: 'Your lines', body: [rewardCard(ctx), ...body, roundMinutesLine(ctx)], footer }));
    focusHeading(ctx.root);
  }

  const done = () => minus(session.stats, startStats);

  // What the round gained, then `text`. With nothing to say, `text` is the headline.
  function headline(text) {
    const onWay = [...practised].filter((id) => !isLearnt(ctx.getState(id))).length;
    const gain = gainLine(startPercent, learntPercent(ctx.model, ctx.getState), onWay) || (practised.size ? 'That keeps your lines fresh.' : null);
    return [gain ? h('p', { class: 'lead' }, gain) : null, h('p', { class: gain ? null : 'lead' }, text)];
  }

  // One short note on why this works, a different one each round.
  async function science() {
    const seen = (await ctx.store.get('seen')) || { percent: 0, lit: [], notes: 0 };
    await ctx.store.set('seen', { ...seen, notes: seen.notes + 1 });
    sync(ctx);
    return h('p', { class: 'science' }, scienceNote(seen.notes));
  }

  function timeIsUp() {
    finished = true;
    session.finish();
    saveSprint();
    const st = done();
    const said = st.answered ? statsLine(st) : 'Nothing left in this round.';
    if (short) {
      return reminderOffer(ctx).then((offer) =>
        plain('Keep going?', [headline(said), h('p', {}, 'Starting is the hard part, and it is done.'), offer], [
          button('Another round', act(() => ctx.go('sprint')), { class: 'btn primary' }),
          button('Stop for now', act(() => ctx.go('today'))),
        ]),
      );
    }
    // Pupils do several rounds a day. Said lightly: there is no time to spend.
    const more = h('p', {}, AGAIN);
    Promise.all([science(), reminderOffer(ctx)]).then(([note, offer]) =>
      plain('Round done', [headline(said), more, offer, note], [
        button('Another round', act(() => ctx.go('sprint')), { class: 'btn primary' }),
        button('Back to your lines', act(() => ctx.go('today'))),
      ]),
    );
  }

  async function planDone() {
    const st = done();
    const plan = ctx.plan();
    const said = st.answered ? h('p', {}, statsLine(st)) : null;
    if (chosen) {
      const offer = await reminderOffer(ctx);
      return plain(chosen.run ? 'Run through done' : 'Practice done', [h('p', { class: 'lead' }, `${chosen.title}.`), said, offer], [
        chosen.run
          ? button('Run through again', act(() => ctx.go('choose', { run: true })), { class: 'btn primary' })
          : button('Choose again', act(() => ctx.go('choose')), { class: 'btn primary' }),
        button('Back to your lines', act(() => ctx.go('today'))),
      ]);
    }
    if (custom) {
      const offer = await reminderOffer(ctx);
      return plain('Run done', [h('p', { class: 'lead' }, `That was a run of ${heading(custom.scene)}.`), said, offer], [
        button('Back to the scene', act(() => ctx.go('scene', { scene: custom.scene })), { class: 'btn primary' }),
        button('Back to your lines', act(() => ctx.go('today'))),
      ]);
    }
    if (scope === 'tests') {
      return reminderOffer(ctx).then((offer) =>
        plain('Checks done', [headline('Everything ready to check is done.'), said, offer], [
          button('Another round', act(() => ctx.go('sprint')), { class: 'btn primary' }),
          button('Stop for now', act(() => ctx.go('today'))),
        ]),
      );
    }
    const keepGoing = (what) => carryOn(() => session.keepGoing(what));
    const footer = [
      plan.ahead.length ? button('Learn more now', act(() => keepGoing('new')), { class: 'btn primary' }) : null,
      plan.extraRuns.length ? button('An extra run', act(() => keepGoing('runs')), { class: plan.ahead.length ? 'btn' : 'btn primary' }) : null,
      button('Stop for now', act(() => ctx.go('today'))),
    ].filter(Boolean);
    Promise.all([science(), reminderOffer(ctx)]).then(([note, offer]) => plain('All caught up', [headline('Everything ready for now is done.'), said, offer, note], footer));
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      tick();
      saveSprint();
    } else {
      last = Date.now();
      shownAt = last;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  carryOn(() => (extra ? session.keepGoing(extra) : session.advance()));

  return () => {
    quiet();
    clearInterval(breakTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
