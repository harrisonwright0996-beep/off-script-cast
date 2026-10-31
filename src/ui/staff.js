// The director's page: who has started, and how far they have got. The worker sends numbers under
// coded names; the cast list, opened here with the company code, turns them into names on this phone.
import { h, clear, button, plural } from './dom.js';
import { openCast, staffNumbers, staffRemove } from '../cast/client.js';
import { cleanCode, deriveKeys, openText } from '../cast/pack.js';
import { dayKey } from '../dates.js';

const SAVED = 'castStaff';
const DAY = 86400000;
const QUIET = 7; // days with no practice before a pupil needs a word
const CHASE = 2; // days with no practice before they are worth a mention
const FADING = 5; // lines going before they are worth a mention
const root = typeof document === 'undefined' ? null : document.getElementById('app');

// The codes last for this visit, in case the phone is shared. Kept for good only if asked.
const remembered = () => {
  for (const place of ['sessionStorage', 'localStorage']) {
    try {
      const codes = JSON.parse(window[place].getItem(SAVED));
      if (codes) return codes;
    } catch {
      // private browsing: the codes are asked for next time
    }
  }
  return null;
};
const remember = (codes, keep = false) => {
  try {
    sessionStorage.removeItem(SAVED);
    localStorage.removeItem(SAVED);
    if (codes) (keep ? localStorage : sessionStorage).setItem(SAVED, JSON.stringify(codes));
  } catch {
    // private browsing: the codes are asked for next time
  }
};
const keeping = () => {
  try {
    return !!localStorage.getItem(SAVED);
  } catch {
    return false;
  }
};

// Draws a page and takes focus to its heading, so a screen reader hears what has changed.
const page = (title, body) => {
  const heading = h('h1', { tabindex: '-1' }, title);
  clear(root).append(h('main', { class: 'staff' }, heading, ...body));
  heading.focus({ preventScroll: true });
};

const daysSince = (day, today = dayKey(new Date())) => Math.round((new Date(today) - new Date(day)) / DAY);
const whenText = (day, today) => {
  const days = daysSince(day, today);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const firstName = (name) => name.trim().split(/\s+/)[0].toLowerCase().replace(/[‘’]/g, "'");
// Whether someone is the pupil a part is named after, not an understudy on it: Ella Brown on Ella B.
export const sameFirstName = (a, b) => firstName(a) === firstName(b);

// Not heard of, or not practised, for a week: worth asking. A phone offline a while looks the same.
const lastHeard = (r) => dayKey(new Date(Math.max(r.seen || 0, r.lastDay ? new Date(r.lastDay).getTime() : 0)));
export const isQuiet = (r, today) => r.percent !== undefined && (r.lastDay ? daysSince(r.lastDay, today) >= QUIET : !!r.seen && daysSince(lastHeard(r), today) >= QUIET);

// One row a person who has started, by the name they typed, and one for each part whose own pupil has
// not started yet, even with an understudy on it: those first, then anyone quiet, then the lowest %.
// A row for someone no longer in the cast stays, so it can be seen and removed.
export function staffRows(members, rows, today = dayKey(new Date())) {
  const parts = new Map(members.map((m) => [m.file, m.name]));
  const people = rows.map((r) => {
    const part = parts.get(r.pack) ?? null;
    return { ...r, name: r.who ?? part ?? 'Someone', part };
  });
  const taken = new Set(people.filter((r) => r.part && sameFirstName(r.name, r.part)).map((r) => r.pack));
  const nobody = members.filter((m) => !taken.has(m.file)).map((m) => ({ name: m.name, part: m.name }));
  const rank = (r) => (r.percent === undefined ? 0 : isQuiet(r, today) ? 1 : 2);
  return [...nobody, ...people].sort((a, b) => rank(a) - rank(b) || (a.percent ?? -1) - (b.percent ?? -1) || a.name.localeCompare(b.name));
}

// 1=40|2=100|Prologue=0, as a phone sealed it (progress.js).
export const sceneList = (text) =>
  !text ? [] : text.split('|').map((s) => s.split('=')).map(([label, pc]) => ({ label: /^\d+$/.test(label) ? `Scene ${label}` : label, percent: Number(pc) }));

// Who to talk to first, and why, in the order it matters. Parts with no one on them go in one line.
export function chaseList(rows, today = dayKey(new Date())) {
  const waiting = rows.filter((r) => r.percent === undefined).map((r) => r.name);
  const chase = rows.filter((r) => r.percent !== undefined).flatMap((r) => {
    const gone = r.lastDay ? daysSince(r.lastDay, today) : null;
    if (gone === null) return [{ name: r.name, why: 'Opened the app, no practice yet.' }];
    if (gone >= CHASE) return [{ name: r.name, why: `No practice for ${gone} days.` }];
    return r.fading >= FADING ? [{ name: r.name, why: `${r.fading} lines fading.` }] : [];
  });
  return { waiting, chase };
}

// Each scene across everyone working on it, in the order of the first pupil who has it.
export function sceneAverages(rows) {
  const scenes = new Map();
  for (const r of rows) {
    for (const { label, percent } of sceneList(r.scenes)) scenes.set(label, [...(scenes.get(label) || []), percent]);
  }
  return [...scenes].map(([label, all]) => ({ label, percent: Math.floor(all.reduce((a, b) => a + b, 0) / all.length), pupils: all.length }));
}

const barOf = (percent) => h('div', { class: 'timebar', role: 'img', 'aria-label': `${percent}% learnt` }, h('div', { class: 'timebar-fill', style: { width: `${percent}%` } }));

function rowView(r, codes) {
  const left = !r.part ? 'No longer on the cast list. ' : sameFirstName(r.name, r.part) ? '' : `On ${r.part}'s lines. `;
  const onWay = r.onWay ? `, ${r.onWay} more on the way` : '';
  const practised = r.lastDay ? `Practised ${whenText(r.lastDay)}.` : 'Opened the app, no practice yet.';
  const heard = r.seen && daysSince(lastHeard(r)) >= 2 ? ` Last heard from ${whenText(lastHeard(r))}.` : '';
  const said = r.percent === undefined ? 'Not started' : `${left}${r.learnt} of ${plural(r.total, 'line')} learnt${onWay}, ${r.fading} fading. ${practised}${heard}`;
  let sure = false;
  const remove = r.id
    ? button('Remove', async () => {
        if (!sure) {
          sure = true;
          remove.textContent = `Remove ${r.name} from this page?`;
          return;
        }
        try {
          await staffRemove(codes.staff, r.id);
          load(codes);
        } catch {
          remove.textContent = 'Could not remove. Check you have signal.';
          sure = false;
        }
      }, { class: 'btn link' })
    : null;
  return h(
    'li',
    {},
    h('p', { class: 'staff-name' }, h('strong', {}, r.name), h('span', {}, r.percent === undefined ? '' : `${r.percent}%`)),
    isQuiet(r) ? h('p', { class: 'needs-word' }, 'Needs a word') : null,
    h('p', { class: 'help' }, said),
    barOf(r.percent ?? 0),
    r.scenes
      ? h('details', { class: 'scene-pcs' }, h('summary', {}, 'Scene by scene'), h('ul', {}, sceneList(r.scenes).map((s) => h('li', {}, h('span', {}, s.label), h('span', {}, `${s.percent}%`)))))
      : null,
    remove,
  );
}

const COMPANY_WRONG = ['wrong-code'];

function codesScreen(problem = null, typed = {}, wrong = null) {
  const field = (id, value) => h('input', { id, type: 'text', value: value ?? '', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-invalid': wrong === id ? 'true' : null, 'aria-describedby': wrong === id ? 'codes-problem' : null });
  const company = field('company', typed.company);
  const staff = field('staff', wrong === 'staff' ? '' : typed.staff);
  const keep = h('input', { id: 'keep-codes', type: 'checkbox' });
  page('Cast progress', [
    h('div', { class: 'field' }, h('label', { for: 'company' }, 'Company code'), company),
    h('div', { class: 'field' }, h('label', { for: 'staff' }, 'Staff code'), staff),
    h('div', { class: 'field check' }, h('label', { for: 'keep-codes' }, keep, ' Remember on this phone (only if it is yours alone)')),
    problem ? h('p', { class: 'message', id: 'codes-problem', role: 'alert' }, problem) : null,
    button('Open', () => load({ company: company.value, staff: staff.value }, null, keep.checked), { class: 'btn primary' }),
  ]);
  if (wrong) (wrong === 'staff' ? staff : company).focus();
}

const PROBLEMS = {
  'wrong-code': 'That company code is not right.',
  'wrong-staff': 'That staff code is not right.',
  'too-many': 'Too many tries. Wait a minute, then try again.',
  gone: 'The show is over, so pupils\' progress has been removed.',
};

// shown: the rows on the page, kept there if a refresh does not work. keep: remember the codes for good.
async function load(codes, shown = null, keep = keeping()) {
  page('Cast progress', [h('p', { class: 'lead', role: 'status' }, 'Opening…')]);
  try {
    const rows = await staffNumbers(codes.staff);
    const keys = await deriveKeys(cleanCode(codes.company));
    const cast = await openCast(keys);
    const named = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        who: await openText(keys.key, r.who).catch(() => undefined),
        scenes: r.scenes ? await openText(keys.key, r.scenes).catch(() => undefined) : undefined,
      })),
    );
    remember(codes, keep);
    show(codes, staffRows(cast.members, named));
  } catch (err) {
    const known = PROBLEMS[err.code];
    if (shown && !known) return show(codes, shown, 'Could not refresh. Check you have signal.');
    codesScreen(known || 'That did not work. Check you have signal, then try again.', codes, err.code === 'wrong-staff' ? 'staff' : COMPANY_WRONG.includes(err.code) ? 'company' : null);
  }
}

function show(codes, rows, problem = null) {
  const started = rows.filter((r) => r.percent !== undefined).length;
  const parts = rows.length - started;
  const average = Math.floor(rows.reduce((n, r) => n + (r.percent ?? 0), 0) / (rows.length || 1));
  const quiet = rows.filter((r) => isQuiet(r)).length;
  const { waiting, chase } = chaseList(rows);
  const averages = sceneAverages(rows);
  page('Cast progress', [
    problem ? h('p', { class: 'message', role: 'alert' }, problem) : null,
    h('p', { class: 'lead', role: 'status' }, `${started} started, ${plural(parts, 'part')} not started. ${average}% on average.${quiet ? ` ${quiet} ${quiet === 1 ? 'needs' : 'need'} a word.` : ''}`),
    h('h2', {}, 'Chase first'),
    chase.length ? h('ul', { class: 'chase-list' }, chase.map((c) => h('li', {}, h('strong', {}, c.name), ` ${c.why}`))) : h('p', {}, 'No one who has started needs chasing.'),
    waiting.length ? h('p', {}, h('strong', {}, 'Not started yet: '), waiting.join(', '), '.') : null,
    averages.length ? h('h2', {}, 'Scenes') : null,
    averages.length
      ? h('ul', { class: 'scene-averages' }, averages.map((s) => h('li', {}, h('p', { class: 'staff-name' }, h('strong', {}, s.label), h('span', {}, `${s.percent}%`)), barOf(s.percent))))
      : null,
    h('h2', {}, 'Everyone'),
    h('ul', { class: 'staff-list' }, rows.map((r) => rowView(r, codes))),
    h('p', { class: 'help' }, 'A line counts once a pupil can still type it on a later day. A phone updates this when it next has signal, so a pupil offline may be further on than this shows.'),
    h('div', { class: 'stack' }, button('Refresh', () => load(codes, rows), { class: 'btn primary' }), h('p', { class: 'help' }, "Pupils' progress stays safe."), button('Remove my codes from this phone', () => (remember(null), codesScreen()))),
  ]);
}

if (root) {
  const codes = remembered();
  if (codes) load(codes);
  else codesScreen();
}
