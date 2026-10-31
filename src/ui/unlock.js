// The first screens after install: the company code, then who you are, then your lines come down.
import { h, clear, screen, button, focusHeading, plural, settled } from './dom.js';
import { CastError, fetchPack, openCast, unlock } from '../cast/client.js';
import { cleanCode } from '../cast/pack.js';
import { askToPersist } from '../store.js';

const PROBLEMS = {
  'wrong-code': 'That code is not right. Check it and try again.',
  'too-many': 'Too many tries. Wait a minute, then try again.',
  offline: 'Could not reach Off Script. Check you have signal, then try again.',
  damaged: 'Something went wrong getting your lines. Try again in a minute.',
  gone: 'The show is over, so these lines are no longer here. Well done.',
};
const NOT_FOUR = 'That is not quite it: the code is four words.';
const TROUBLE_AFTER = 20000;

// A code as pasted from a message: Code: "otter lamp river nine".
const QUOTES = /^["'“”‘’\s]+|["'“”‘’\s]+$/g;
export const tidyCode = (text) => text.replace(QUOTES, '').replace(/^code\s*:/i, '').replace(QUOTES, '');
export const isFourWords = (text) => cleanCode(tidyCode(text)).split(' ').length === 4;

export function showUnlock(ctx) {
  let tries = 0; // of getting the pack; the newest one speaks
  let landed = false; // a slow try that gets there first still counts

  const show = (title, body, footer) => {
    clear(ctx.root).append(screen({ title, body, footer }));
    focusHeading(ctx.root);
  };

  // After a problem, what was typed stays, ready to change.
  function codeScreen(problem = null, typed = '') {
    const input = h('input', { id: 'code', type: 'text', value: typed, autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-invalid': problem ? 'true' : null, 'aria-describedby': problem ? 'code-problem' : null });
    const go = settled(async () => {
      const text = input.value;
      if (!text.trim()) return input.focus();
      if (!isFourWords(text)) return codeScreen(NOT_FOUR, text);
      show('Unlocking', [h('p', { class: 'lead', role: 'status' }, 'Checking your code…')], []);
      try {
        const { keys, cast } = await unlock(tidyCode(text));
        pick(keys, cast);
      } catch (err) {
        codeScreen(PROBLEMS[err instanceof CastError ? err.code : 'offline'], text);
      }
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    show(
      'Welcome to Off Script',
      [
        h('p', { class: 'lead' }, 'This is your app for learning your lines. Your lines are locked, so that only the company can see them.'),
        h('div', { class: 'field' }, h('label', { for: 'code' }, 'Company code'), input, h('p', { class: 'help' }, 'Four words. Your director will give you it.')),
        problem ? h('p', { class: 'message', id: 'code-problem', role: 'alert' }, problem) : null,
      ],
      [button('Unlock', go, { class: 'btn primary' })],
    );
    if (problem) input.focus();
  }

  function pick(keys, cast) {
    show(
      'Who are you?',
      [
        h('p', { class: 'lead' }, 'Pick your name to get your lines.'),
        h('p', { class: 'help' }, SEEN),
        h('ul', { class: 'scene-list' }, cast.members.map((m) => h('li', {}, button(m.name, settled(() => confirm(keys, cast, m)))))),
      ],
      [],
    );
  }

  function confirm(keys, cast, member) {
    show(
      `Are you ${member.name}?`,
      [h('p', { class: 'lead' }, `You have ${plural(member.lines, 'line')} to learn, for every character you play.`)],
      [button(`Yes, I am ${member.name}`, settled(() => download(keys, cast, member)), { class: 'btn primary' }), button('No, go back', settled(() => pick(keys, cast)))],
    );
  }

  async function download(keys, cast, member) {
    tries += 1;
    const mine = tries;
    const trouble = h('div', { class: 'stack' });
    show('Getting your lines', [h('p', { class: 'lead', role: 'status' }, 'Getting your lines and audio. This can take a minute.'), trouble], []);
    const timer = setTimeout(() => trouble.append(button('Having trouble? Try again', settled(() => download(keys, cast, member)))), TROUBLE_AFTER);
    try {
      // Saved first, so a phone that gives up here does not need the code again.
      await ctx.store.set('keys', keys);
      ctx.keys = keys;
      const { model, manifest, clips } = await fetchPack(keys, member.file);
      if (landed) return;
      landed = true;
      await ctx.store.clearAudio();
      await ctx.store.putClips(clips);
      await ctx.store.set('manifest', manifest);
      await ctx.store.set('member', { name: member.name, file: member.file, version: cast.version });
      ctx.member = { name: member.name, file: member.file, version: cast.version };
      ctx.manifest = manifest;
      await ctx.setModel(model, { importedAt: Date.now() });
      await askToPersist();
      ctx.go('checkin', { intro: true });
    } catch (err) {
      if (mine !== tries) return;
      landed = false;
      show('That did not work', [h('p', { class: 'message', role: 'alert' }, PROBLEMS[err instanceof CastError ? err.code : 'damaged'])], [button('Try again', settled(() => download(keys, cast, member)), { class: 'btn primary' })]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The code was given before and the lines never came: on to the names, with no code to find again.
  async function carryOn() {
    show('Unlocking', [h('p', { class: 'lead', role: 'status' }, 'Checking your code…')], []);
    try {
      const late = new Promise((_, reject) => setTimeout(reject, TROUBLE_AFTER));
      pick(ctx.keys, await Promise.race([openCast(ctx.keys), late]));
    } catch {
      codeScreen();
    }
  }

  if (ctx.keys) carryOn();
  else codeScreen();
}

// What goes off the phone, said before a name is picked and in Settings.
export const SEEN = 'Your director can see how much you have learnt and when you last practised.';

// The pupil's own words, to tell a new script from a change to someone else's part or the audio.
const wordsOf = (model) => JSON.stringify(model.items.map((it) => [it.id, it.text]));

// Puts a new pack in place of the old one.
async function applyPack(ctx, { model, manifest, clips, member }) {
  ctx.linesUpdated = wordsOf(model) !== wordsOf(ctx.model);
  await ctx.store.del('newPack');
  await ctx.store.clearAudio();
  await ctx.store.putClips(clips);
  await ctx.store.set('manifest', manifest);
  ctx.member = member;
  await ctx.store.set('member', member);
  ctx.manifest = manifest;
  await ctx.setModel(model, { importedAt: Date.now() });
}

// A pack that came during a round waits here, safe on the phone, for the next Your lines.
export async function applyWaitingPack(ctx) {
  const pack = await ctx.store.get('newPack');
  if (!pack) return;
  if (pack.member.version === ctx.member.version) return ctx.store.del('newPack');
  await applyPack(ctx, pack);
}

// When the app opens with signal: if the script or casting has changed, fetch this pupil's new pack.
// Progress is kept for every line that has not changed. Waits for no one: offline, nothing happens.
// stillHere: a new pack is only put in while Your lines is on show, never in the middle of a round:
// it waits for the next Your lines. Returns whether it changed anything. The worker saying the show
// is over ends the app, but that too waits for Your lines.
export async function refreshPack(ctx, stillHere = () => true) {
  try {
    const cast = await openCast(ctx.keys);
    if (cast.version === ctx.member.version) return false;
    const member = cast.members.find((m) => m.name === ctx.member.name);
    if (!member) return false;
    const { model, manifest, clips } = await fetchPack(ctx.keys, member.file);
    const pack = { model, manifest, clips, member: { name: member.name, file: member.file, version: cast.version } };
    if (!stillHere()) {
      await ctx.store.set('newPack', pack);
      return false;
    }
    await applyPack(ctx, pack);
    return true;
  } catch (err) {
    if (err instanceof CastError && err.code === 'gone' && stillHere()) await ctx.go('ended');
    return false; // no signal, or a bad moment: try again next time
  }
}
