// Progress backups: a file he keeps in Files (OneDrive, say). It holds line ids, results and
// settings, never the script's words, so it is safe to keep anywhere. A file can be edited, so nothing
// in it is trusted: every state is checked, and every line comes back unproved, so the % is earned
// again by typing.
import { DEFAULT_SETTINGS } from './settings.js';
import { newState } from './state.js';

export const BACKUP_VERSION = 1;

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'not-json' | 'not-backup' | 'newer' | 'other-member' | 'no-lines'
  }
}

// Undo needs the whole earlier state, but only within a sprint; the plan and the forgetting curve
// fit need just these three fields.
const slim = (prev) => prev && { status: prev.status, stability: prev.stability, lastTime: prev.lastTime };

// member: the name of the cast member it belongs to.
export function makeBackup({ model, states, events, settings, member = null, now = Date.now() }) {
  return {
    app: 'off-script-cast',
    version: BACKUP_VERSION,
    made: now,
    member,
    scriptHash: model.hash,
    settings: { ...settings },
    states: [...states],
    events: events.map(({ key, prev, ...e }) => ({ ...e, prev: slim(prev) })),
  };
}

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isTime = (n) => Number.isFinite(n) && n >= 0 && n <= 8.64e15; // the last moment a Date can hold
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isDays = (list) => Array.isArray(list) && list.every(isDay);
const isHours = (n) => Number.isFinite(n) && n > 0;
const STATUSES = ['new', 'learning', 'review'];
const MODES = ['type', 'say', 'walk'];

// Everything the plan and a card read from a state, of the right kind.
function goodState(s) {
  if (!s || typeof s !== 'object' || !STATUSES.includes(s.status)) return false;
  if (![s.passes, s.misses, s.helped ?? 0, s.lapses ?? 0].every(isCount) || !isDays(s.passDays) || !isDays(s.missDays)) return false;
  if (s.knownDay != null && !isDay(s.knownDay)) return false;
  const answered = s.passes + s.misses > 0; // a line right only with the first letters has no last day
  if (s.status === 'new') return !answered;
  if (!isDay(s.firstDay) || !['pass', 'miss', null].includes(s.lastResult ?? null)) return false;
  if (answered && (!isDay(s.lastDay) || !isTime(s.lastTime) || s.lastResult == null)) return false;
  if (s.stability != null && !isHours(s.stability)) return false;
  return s.status !== 'review' || (answered && isDay(s.learnedDay) && isHours(s.stability));
}

const STATE_KEYS = Object.keys(newState(''));
const cleanState = (s) => ({ ...newState(s.id), ...Object.fromEntries(STATE_KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])), proved: false });

const goodPrev = (p) => p == null || (typeof p === 'object' && STATUSES.includes(p.status) && (p.stability == null || isHours(p.stability)) && (p.lastTime == null || isTime(p.lastTime)));
const orNull = (test) => (v) => v == null || test(v);
const goodWords = (list) => Array.isArray(list) && list.every(isCount);
const goodEvent = (e) => !!e && isTime(e.time) && isDay(e.day) && typeof e.pass === 'boolean' && MODES.includes(e.mode) && goodPrev(e.prev) && orNull(goodWords)(e.missed) && [e.misses, e.ms, e.firstMs, e.active].every(orNull(isTime));

// Settings a file may bring back: only those the app knows, of the kind it expects, and in range.
// Whether lines need typing to count (proofs) is never one of them.
const inRange = (lo, hi) => (n) => Number.isFinite(n) && n >= lo && n <= hi;
const oneOf = (...list) => (v) => list.includes(v);
const CHECKS = {
  deadline: isDay,
  lastNewDay: isDay,
  showDay: isDay,
  mode: oneOf('type', 'say'),
  sprintMinutes: inRange(1, 60),
  breakMinutes: inRange(1, 60),
  textSize: inRange(90, 200),
  lineSpacing: inRange(1, 3),
  letterSpacing: oneOf('normal', 'wide', 'wider'),
  theme: oneOf('stage', 'cream', 'light', 'dark', 'auto'),
  walkGap: oneOf('shorter', 'normal', 'longer'),
  rate: inRange(0.5, 2),
};
const OR_NULL = { voiceURI: 'string', focusScene: 'number', practice: 'object', runThrough: 'object' };
function cleanSettings(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const ok = ([key, v]) => {
    if (key in OR_NULL) return v === null || typeof v === OR_NULL[key];
    if (key === 'proofs' || !(key in DEFAULT_SETTINGS)) return false;
    return CHECKS[key] ? CHECKS[key](v) : typeof v === typeof DEFAULT_SETTINGS[key];
  };
  return Object.fromEntries(Object.entries(saved).filter(ok));
}

// Reads a backup against the script on the phone: progress is kept for every line still in it.
// member: the name of the cast member on this phone. Another member's file is refused, and so is a
// file with nothing in it to keep.
export function readBackup(text, model, member = null) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('not-json');
  }
  if (!data || data.app !== 'off-script-cast' || !Array.isArray(data.states) || !Array.isArray(data.events)) throw new BackupError('not-backup');
  if (data.version > BACKUP_VERSION) throw new BackupError('newer');
  if (data.version !== BACKUP_VERSION || !isTime(data.made)) throw new BackupError('not-backup');
  if (member !== null && data.member !== member) throw new BackupError('other-member');
  const ids = new Set(model.items.map((it) => it.id));
  const kept = new Set();
  const states = [];
  for (const s of data.states) {
    if (!s || !ids.has(s.id) || kept.has(s.id) || !goodState(s)) continue;
    kept.add(s.id);
    states.push(cleanState(s));
  }
  if (!states.length) throw new BackupError('no-lines');
  const events = data.events.filter((e) => e && kept.has(e.id) && goodEvent(e));
  return {
    made: data.made,
    sameScript: data.scriptHash === model.hash,
    settings: cleanSettings(data.settings),
    states,
    events,
    kept: states.length,
    dropped: data.states.length - states.length,
  };
}
