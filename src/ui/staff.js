// The director's page: who has started, and how far they have got. The worker sends numbers under
// coded names; the cast list, opened here with the company code, turns them into names on this phone.
import { h, clear, button, plural } from './dom.js';
import { openCast, staffNumbers } from '../cast/client.js';
import { cleanCode, deriveKeys, openText } from '../cast/pack.js';
import { dayKey } from '../dates.js';

const SAVED = 'castStaff';
const DAY = 86400000;
const root = document.getElementById('app');

const remembered = () => {
  try {
    return JSON.parse(localStorage.getItem(SAVED));
  } catch {
    return null;
  }
};
const remember = (codes) => {
  try {
    if (codes) localStorage.setItem(SAVED, JSON.stringify(codes));
    else localStorage.removeItem(SAVED);
  } catch {
    // private browsing: the codes are asked for next time
  }
};

const page = (title, body) => clear(root).append(h('main', { class: 'staff' }, h('h1', {}, title), ...body));

const whenText = (day, today = dayKey(new Date())) => {
  const days = Math.round((new Date(today) - new Date(day)) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

// One row a person who has started, by the name they typed, and one for each part nobody has started
// yet: those first, then the lowest %. An understudy shows beside the part they are learning.
export function staffRows(members, rows) {
  const parts = new Map(members.map((m) => [m.file, m.name]));
  const people = rows.filter((r) => parts.has(r.pack)).map((r) => ({ ...r, name: r.who ?? parts.get(r.pack), part: parts.get(r.pack) }));
  const taken = new Set(people.map((r) => r.pack));
  const nobody = members.filter((m) => !taken.has(m.file)).map((m) => ({ name: m.name, part: m.name }));
  return [...nobody, ...people].sort((a, b) => (a.percent ?? -1) - (b.percent ?? -1) || a.name.localeCompare(b.name));
}

function rowView(r) {
  const learning = r.name.toLowerCase() === r.part.toLowerCase() ? '' : `Learning ${r.part}. `;
  const said = r.percent === undefined
    ? 'Not started'
    : `${learning}${r.learnt} of ${plural(r.total, 'line')} learnt, ${r.fading} fading. ${r.lastDay ? `Practised ${whenText(r.lastDay)}.` : 'Opened the app, no practice yet.'}`;
  return h(
    'li',
    {},
    h('p', { class: 'staff-name' }, h('strong', {}, r.name), h('span', {}, r.percent === undefined ? '' : `${r.percent}%`)),
    h('p', { class: 'help' }, said),
    h('div', { class: 'timebar', role: 'img', 'aria-label': `${r.percent ?? 0}% learnt` }, h('div', { class: 'timebar-fill', style: { width: `${r.percent ?? 0}%` } })),
  );
}

function codesScreen(problem = null) {
  const company = h('input', { id: 'company', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const staff = h('input', { id: 'staff', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  page('Cast progress', [
    h('div', { class: 'field' }, h('label', { for: 'company' }, 'Company code'), company),
    h('div', { class: 'field' }, h('label', { for: 'staff' }, 'Staff code'), staff),
    problem ? h('p', { class: 'message', role: 'alert' }, problem) : null,
    button('Open', () => load({ company: company.value, staff: staff.value }), { class: 'btn primary' }),
  ]);
}

const PROBLEMS = {
  'wrong-code': 'That company code is not right.',
  'wrong-staff': 'That staff code is not right.',
  'too-many': 'Too many tries. Wait a minute, then try again.',
};

async function load(codes) {
  page('Cast progress', [h('p', { class: 'lead', role: 'status' }, 'Opening…')]);
  try {
    const rows = await staffNumbers(codes.staff);
    const keys = await deriveKeys(cleanCode(codes.company));
    const cast = await openCast(keys);
    const named = await Promise.all(rows.map(async (r) => ({ ...r, who: await openText(keys.key, r.who).catch(() => null) })));
    remember(codes);
    show(codes, staffRows(cast.members, named));
  } catch (err) {
    codesScreen(PROBLEMS[err.code] || 'That did not work. Check you have signal, then try again.');
  }
}

function show(codes, rows) {
  const started = rows.filter((r) => r.percent !== undefined).length;
  const parts = rows.length - started;
  const average = Math.floor(rows.reduce((n, r) => n + (r.percent ?? 0), 0) / rows.length);
  page('Cast progress', [
    h('p', { class: 'lead' }, `${started} started, ${plural(parts, 'part')} not started. ${average}% on average.`),
    h('ul', { class: 'staff-list' }, rows.map(rowView)),
    h('p', { class: 'help' }, 'A phone updates this when it next has signal, so an offline pupil may be further on than this shows.'),
    h('div', { class: 'stack' }, button('Refresh', () => load(codes), { class: 'btn primary' }), button('Forget this phone', () => (remember(null), codesScreen()))),
  ]);
}

if (root) {
  const codes = remembered();
  if (codes) load(codes);
  else codesScreen();
}
