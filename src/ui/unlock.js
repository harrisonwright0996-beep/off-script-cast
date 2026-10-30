// The first screens after install: the company code, then who you are, then your lines come down.
import { h, clear, screen, button, focusHeading, plural, settled } from './dom.js';
import { CastError, fetchPack, openCast, unlock } from '../cast/client.js';
import { askToPersist } from '../store.js';

const PROBLEMS = {
  'wrong-code': 'That code is not right. Check it and try again.',
  'too-many': 'Too many tries. Wait an hour, then try again.',
  offline: 'Could not reach Off Script. Check you have signal, then try again.',
  damaged: 'Something went wrong getting your lines. Try again in a minute.',
};

export function showUnlock(ctx) {
  const show = (title, body, footer) => {
    clear(ctx.root).append(screen({ title, body, footer }));
    focusHeading(ctx.root);
  };

  function codeScreen(problem = null) {
    const input = h('input', { id: 'code', type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' });
    const go = settled(async () => {
      if (!input.value.trim()) return input.focus();
      show('Unlocking', [h('p', { class: 'lead', role: 'status' }, 'Checking your code…')], []);
      try {
        const { keys, cast } = await unlock(input.value);
        pick(keys, cast);
      } catch (err) {
        codeScreen(PROBLEMS[err instanceof CastError ? err.code : 'offline']);
      }
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    show(
      'Welcome to Off Script',
      [
        h('p', { class: 'lead' }, 'This is your app for learning your lines. Your lines are locked, so that only the company can see them.'),
        h('div', { class: 'field' }, h('label', { for: 'code' }, 'Company code'), input, h('p', { class: 'help' }, 'Four words. Your director will give you it.')),
        problem ? h('p', { class: 'message', role: 'alert' }, problem) : null,
      ],
      [button('Unlock', go, { class: 'btn primary' })],
    );
  }

  function pick(keys, cast) {
    show(
      'Who are you?',
      [
        h('p', { class: 'lead' }, 'Pick your name. You will only get your own lines.'),
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
    show('Getting your lines', [h('p', { class: 'lead', role: 'status' }, 'Getting your lines and audio. This can take a minute.')], []);
    try {
      const { model, manifest, clips } = await fetchPack(keys, member.file);
      await ctx.store.clearAudio();
      await ctx.store.putClips(clips);
      await ctx.store.set('manifest', manifest);
      await ctx.store.set('keys', keys);
      await ctx.store.set('member', { name: member.name, file: member.file, version: cast.version });
      ctx.keys = keys;
      ctx.member = { name: member.name, file: member.file, version: cast.version };
      ctx.manifest = manifest;
      await ctx.setModel(model, { importedAt: Date.now() });
      await askToPersist();
      ctx.go('checkin', { intro: true });
    } catch (err) {
      show('That did not work', [h('p', { class: 'message', role: 'alert' }, PROBLEMS[err instanceof CastError ? err.code : 'damaged'])], [button('Try again', settled(() => download(keys, cast, member)), { class: 'btn primary' })]);
    }
  }

  codeScreen();
}

// When the app opens with signal: if the script or casting has changed, fetch this pupil's new pack.
// Progress is kept for every line that has not changed. Waits for no one: offline, nothing happens.
// stillHere: a new pack is only put in while Your lines is on show, never in the middle of a round.
// Returns whether it changed anything.
export async function refreshPack(ctx, stillHere = () => true) {
  try {
    const cast = await openCast(ctx.keys);
    if (cast.version === ctx.member.version) return false;
    const member = cast.members.find((m) => m.name === ctx.member.name);
    if (!member) return false;
    const { model, manifest, clips } = await fetchPack(ctx.keys, member.file);
    if (!stillHere()) return false;
    await ctx.store.clearAudio();
    await ctx.store.putClips(clips);
    await ctx.store.set('manifest', manifest);
    ctx.member = { name: member.name, file: member.file, version: cast.version };
    await ctx.store.set('member', ctx.member);
    ctx.manifest = manifest;
    await ctx.setModel(model, { importedAt: Date.now() });
    return true;
  } catch {
    return false; // no signal, or a bad moment: try again next time
  }
}
