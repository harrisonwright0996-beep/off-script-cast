// Settings: how it looks, how practice works, the voice, reminders, and progress files. Every change
// is saved at once.
import { h, clear, screen, button, announce, focusHeading, plural, pickFile, settled } from './dom.js';
import { canPush, disable, enable, liveSub } from '../cast/reminders.js';
import { forgetRow } from '../cast/progress.js';
import { mustInstall, thisDevice } from '../device.js';
import { makeBackup, readBackup } from '../backup.js';
import { withDefaults } from '../settings.js';
import { dayKey, formatDay } from '../dates.js';
import { canSpeak, voices, onVoicesChanged, speak } from '../tts.js';
import { SEEN, askName } from './unlock.js';

const OPTIONS = {
  textSize: [90, 100, 115, 130, 150, 175, 200].map((n) => [n, `${n}%`]),
  lineSpacing: [[1.5, 'Normal'], [1.8, 'More'], [2, 'Most']],
  letterSpacing: [['normal', 'Normal'], ['wide', 'Wide'], ['wider', 'Extra wide']],
  theme: [['stage', 'Stage'], ['cream', 'Cream'], ['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match the phone']],
  mode: [['type', 'Type: first letters on the keypad'], ['say', 'Say: aloud, then tap any misses']],
  walkGap: [['shorter', 'Shorter'], ['normal', 'Normal'], ['longer', 'Longer']],
  rate: [[0.8, 'Slower'], [0.9, 'A little slower'], [1, 'Normal'], [1.1, 'A little faster'], [1.2, 'Faster']],
};

const BACKUP_PROBLEMS = {
  'not-json': 'That file is not an Off Script backup.',
  'not-backup': 'That file is not an Off Script backup.',
  newer: 'That backup is from a newer version of Off Script. Update the app first.',
  'other-member': 'That backup belongs to someone else in the cast, so it cannot go on this phone.',
  'no-lines': 'That backup has none of your lines in it, so nothing was changed.',
};

const FORGET_WAIT = 3000; // no signal must not hold up removing everything
const BROWSER_FLAG = 'off-script-cast-in-browser';

// Everything off this phone. Reminders and the director's row go first, so the worker forgets them.
// A director's codes on this phone are theirs, not the pupil's, and stay (staff.js).
export async function wipePhone(ctx) {
  await Promise.race([Promise.allSettled([disable(ctx), forgetRow(ctx)]), new Promise((done) => setTimeout(done, FORGET_WAIT))]);
  await ctx.store.removeEverything();
  try {
    localStorage.removeItem(BROWSER_FLAG);
  } catch {
    // nothing stored there
  }
}

const when = (ms) => {
  const d = new Date(ms);
  return `${formatDay(dayKey(d))} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

// Saves a backup of his progress: to Files by the share sheet where there is one, else a download.
export async function saveBackup(ctx) {
  const events = await ctx.store.allEvents();
  const data = makeBackup({ model: ctx.model, states: ctx.states.values(), events, settings: ctx.settings, member: ctx.member && ctx.member.name });
  const name = `Off Script progress ${formatDay(dayKey())}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Off Script progress' });
      announce('Backup ready');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name, class: 'visually-hidden' }, 'Download');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  announce('Backup saved');
}

export function showSettings(ctx) {
  const s = ctx.settings;
  const save = async (patch) => {
    await ctx.saveSettings(patch);
    announce('Saved');
  };

  function select(key, label, options, help) {
    const id = `set-${key}`;
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id }, label),
      h(
        'select',
        { id, onChange: (e) => save({ [key]: options[e.target.selectedIndex][0] }) },
        options.map(([v, text]) => h('option', { value: String(v), selected: String(s[key]) === String(v) }, text)),
      ),
      help ? h('p', { class: 'help' }, help) : null,
    );
  }

  function check(key, label) {
    const id = `set-${key}`;
    return h('label', { class: 'check', for: id }, h('input', { id, type: 'checkbox', checked: !!s[key], onChange: (e) => save({ [key]: e.target.checked }) }), label);
  }

  function voiceField() {
    if (!canSpeak()) return h('p', { class: 'help' }, 'This phone cannot read aloud here.');
    const box = h('div', {});
    const draw = () => {
      const list = [['', 'The phone’s usual voice'], ...voices().map((v) => [v.voiceURI, `${v.name} (${v.lang})`])];
      clear(box).append(select('voiceURI', 'Voice for reading aloud', list.map(([v, t]) => [v || null, t])));
    };
    draw();
    onVoicesChanged(draw);
    return [box, select('rate', 'Reading speed', OPTIONS.rate), h('div', { class: 'stack' }, button('Try the voice', () => speak('This is how lines will sound when they are read aloud.', { voiceURI: s.voiceURI, rate: s.rate })))];
  }

  // Progress.
  function page(title, body, footer) {
    clear(ctx.root).append(screen({ title, back: () => ctx.go('settings'), body, footer }));
    focusHeading(ctx.root);
  }

  async function restore() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let b;
    try {
      b = readBackup(await file.text(), ctx.model, ctx.member && ctx.member.name);
    } catch (err) {
      return page('That did not work', [h('p', { class: 'lead' }, BACKUP_PROBLEMS[err.code] || BACKUP_PROBLEMS['not-backup'])], [
        button('Back to Settings', () => ctx.go('settings'), { class: 'btn primary' }),
      ]);
    }
    page(
      'Restore this backup?',
      [
        h('p', { class: 'lead' }, `Backup from ${when(b.made)}: progress for ${plural(b.kept, 'line')}.`),
        b.dropped ? h('p', {}, `${plural(b.dropped, 'line')} in the backup are not in this script, so they are left out.`) : null,
        h('p', {}, 'It replaces the progress on this phone. Your % starts again from 0, and each line comes back to it when you next type it right.'),
      ],
      [
        button('Restore', async () => {
          await ctx.store.clearStates();
          await ctx.store.putStates(b.states);
          await ctx.store.clearEvents();
          await ctx.store.putEvents(b.events);
          await ctx.store.del('sprint');
          await ctx.store.del('practice');
          if (b.settings) await ctx.saveSettings(withDefaults(b.settings));
          ctx.states = new Map(b.states.map((st) => [st.id, st]));
          ctx.eventsFrom = null;
          await ctx.settleSeen();
          announce('Backup restored');
          ctx.go('today');
        }, { class: 'btn primary' }),
        button('Keep what is here', () => ctx.go('settings')),
      ],
    );
  }

  function removeAll() {
    page(
      'Remove everything?',
      [
        h('p', { class: 'lead' }, 'This deletes your lines, your progress and the audio from this phone. You would need the company code to get them back.'),
        h('p', {}, 'Back up your progress first if you might want it again.'),
      ],
      [
        button('Keep everything', () => ctx.go('settings'), { class: 'btn primary' }),
        button('Remove everything', settled(async () => {
          await wipePhone(ctx);
          location.reload();
        })),
      ],
    );
  }

  // Reminders: on or off. On a phone that cannot have them, it says why.
  const reminderBox = h('div', { class: 'stack' });
  let turning = false;
  async function drawReminders(problem = null, focus = false) {
    if (!canPush()) return clear(reminderBox).append(h('p', { class: 'help' }, 'Reminders need Off Script installed on your Home Screen, on an up to date phone.'));
    const on = !!(await liveSub(ctx).catch(() => null));
    const toggle = button(on ? 'Turn reminders off' : 'Turn reminders on', settled(async () => {
      if (turning) return; // a second tap is not a second subscription
      turning = true;
      let trouble = null;
      if (on) {
        await disable(ctx);
        await ctx.store.set('pushAsked', true); // their answer: not offered again on Your lines
      } else if (!(await enable(ctx).catch(() => false))) trouble = 'Reminders did not switch on. Check notifications are allowed for Off Script in your phone settings.';
      turning = false;
      await drawReminders(trouble, true);
    }));
    clear(reminderBox).append(h('p', { class: 'help', role: 'status' }, on ? 'Reminders are on.' : 'Reminders are off.'), problem ? h('p', { class: 'message', role: 'alert' }, problem) : null, toggle);
    if (focus) toggle.focus();
  }
  drawReminders();

  // The name the director sees, and a way to put a slip right.
  const nameBox = h('div', { class: 'stack' });
  ctx.store.get('myName').then((name) => {
    if (!name) return;
    nameBox.append(h('p', { class: 'help' }, `Your name: ${name}.`), button('Change my name', settled(() => askName(ctx, () => ctx.go('settings'), null, name, () => ctx.go('settings')))));
  }).catch(() => {}); // another tab has removed everything: Remove everything here still has to show

  ctx.root.append(
    screen({
      title: 'Settings',
      back: () => ctx.go('today'),
      backLabel: 'Your lines',
      body: [
        mustInstall(thisDevice()) ? h('div', { class: 'stack' }, button('Install Off Script', () => ctx.go('install'))) : null,
        h('h2', {}, 'Look'),
        h(
          'div',
          { class: 'group' },
          select('textSize', 'Text size', OPTIONS.textSize),
          select('lineSpacing', 'Line spacing', OPTIONS.lineSpacing),
          select('letterSpacing', 'Letter spacing', OPTIONS.letterSpacing),
          select('theme', 'Colours', OPTIONS.theme),
        ),
        h('h2', {}, 'Practice'),
        h(
          'div',
          { class: 'group' },
          select('mode', 'Answer by', OPTIONS.mode),
          check('autoAdvance', 'Move on by itself after a word perfect answer'),
        ),
        h('h2', {}, 'Reading aloud and Walk'),
        h('div', { class: 'group' }, voiceField(), select('walkGap', 'Time to say each line on a walk', OPTIONS.walkGap)),
        h('h2', {}, 'Reminders'),
        h('div', { class: 'group' }, reminderBox),
        h('h2', {}, 'Your progress'),
        h(
          'div',
          { class: 'group' },
          ctx.member ? h('p', { class: 'help' }, `Learning as ${ctx.member.name}.`) : null,
          nameBox,
          h('p', { class: 'help' }, 'A backup holds your results, never your lines. Save it somewhere safe if you are changing phone.'),
          h(
            'div',
            { class: 'stack' },
            button('Back up progress', () => saveBackup(ctx)),
            button('Restore a backup', restore),
            ctx.states.size ? button('Start again from 0%', settled(() => ctx.go('again'))) : null,
            button('Remove everything from this phone', settled(removeAll)),
          ),
        ),
        h('p', { class: 'help' }, `Your lines stay on this phone. ${SEEN} If reminders are on, the time of your next one is sent too.`),
      ],
    }),
  );
}
