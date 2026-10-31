// Checking answers. Type mode: one key per word, first letter or digit. A wrong key, or the ? key,
// shows the right word at once and marks it missed, so there is never any letter guessing.
// Say mode: after saying the line aloud he taps the words he missed or changed.

// The Type keypad's rows, each centred under the one above, keys of one width.
export const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm?'];
const KEY_AT = new Map(KEY_ROWS.flatMap((row, y) => [...row].map((k, i) => [k, { x: i + (10 - row.length) / 2, y }])));

// Two different keys that touch, side by side or diagonally: a slip of the finger from one to the
// other is easy.
export function neighbours(a, b) {
  const p = KEY_AT.get(a);
  const q = KEY_AT.get(b);
  return !!p && !!q && a !== b && Math.abs(p.y - q.y) <= 1 && Math.abs(p.x - q.x) <= 1;
}

// Letters that are easily swapped by someone who knows the word: mirror images, and first sounds
// spelt another way (one, know, write, phone, gem, city, hour). A first letter is there to show the
// line was remembered, not spelt. Said digits count too: 2 is also t. The app never says so.
const ALIKE = ['bd', 'pq', 'ck', 'cs', 'cq', 'kq', 'fp', 'gj', 'kn', 'rw', 'ow', 'ho', 'sz', 'xz', 'uy', 'o1', 't2', 't3', 'f4', 'f5', 's6', 's7', 'e8', 'n9', 'z0'];
const ALIKE_KEYS = new Set(ALIKE.flatMap((p) => [p, p[1] + p[0]]));
export const sameKey = (a, b) => a === b || ALIKE_KEYS.has(a + b);

export function createTypeCheck(tokens) {
  const keyed = [];
  tokens.forEach((t, i) => {
    if (t.k !== null) keyed.push(i);
  });
  let pos = 0;
  const misses = [];
  const slips = []; // missed with a key touching the right one: perhaps a slip of the finger

  const step = (correct, key = null) => {
    const index = keyed[pos];
    if (!correct) misses.push(index);
    if (!correct && key !== null && neighbours(key, tokens[index].k)) slips.push(index);
    pos += 1;
    return { index, correct, done: pos >= keyed.length };
  };

  return {
    get done() {
      return pos >= keyed.length;
    },
    // Tokens before this index are on show (words answered so far, plus any [direction] before the next word).
    get shownUpTo() {
      return pos >= keyed.length ? tokens.length : keyed[pos];
    },
    get misses() {
      return [...misses];
    },
    get slips() {
      return [...slips];
    },
    press(key) {
      if (pos >= keyed.length) return null;
      const k = String(key).toLowerCase();
      return step(sameKey(k, tokens[keyed[pos]].k), k);
    },
    reveal() {
      if (pos >= keyed.length) return null;
      return step(false);
    },
  };
}

// A line of this many words or more can have a slip of the finger; on a shorter one a key is too
// much of the line to wave through.
export const SLIP_WORDS = 4;

// One wrong key, touching the right one, and nothing else wrong: he may say it was only a slip.
export const onlySlip = (check, words, speakerWrong = false) => !speakerWrong && words >= SLIP_WORDS && check.misses.length === 1 && check.slips.includes(check.misses[0]);

export function sayMisses(tokens, tapped) {
  return [...tapped].filter((i) => tokens[i] && tokens[i].k !== null).sort((a, b) => a - b);
}

// A finished line of this many words or more still passes with one word wrong. The app never says so:
// the aim on screen is always every word.
export const CLOSE_WORDS = 8;

// ms: from the answer starting (the keypad or Reveal on show) to the last key or Reveal. firstMs: to
// the first key (Type). slip: counted right by him after a slip of the finger. words: the line's
// length, on a test of a line already taught; left out, every word counts.
export function makeResult({ misses, speakerWrong = false, mode, ms = null, firstMs = null, slip = false, words = 0 }) {
  const close = misses.length === 1 && words >= CLOSE_WORDS;
  const result = { pass: (misses.length === 0 || close) && !speakerWrong, misses, speakerWrong, mode };
  if (ms != null) result.ms = ms;
  if (firstMs != null) result.firstMs = firstMs;
  if (slip) result.slip = true;
  return result;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const bare = (d) => d.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, '');

// One plain sentence for the screen and for VoiceOver.
export function describeResult(result, tokens, speaker) {
  const parts = [];
  if (result.pass && result.misses.length) return `Nearly word perfect. Watch out for: ${bare(tokens[result.misses[0]].d)}`;
  if (result.pass) return 'Word perfect';
  if (result.speakerWrong) parts.push(`It was ${speaker}`);
  const n = result.misses.length;
  if (n) {
    const count = n <= 10 ? NUMBER_WORDS[n] : String(n);
    const list = result.misses.slice(0, 5).map((i) => bare(tokens[i].d)).join(', ');
    parts.push(`${count} ${n === 1 ? 'miss' : 'misses'}: ${list}${n > 5 ? ' and more' : ''}`);
  }
  return parts.join('. ');
}

// Trouble words: of the words missed now, those missed in the same line before (events from Release 7
// on say which words were missed). Token indices.
export function repeatMisses(events, id, misses) {
  const before = new Set();
  for (const e of events) if (e.id === id && e.missed) for (const i of e.missed) before.add(i);
  return misses.filter((i) => before.has(i));
}

export function troubleNote(tokens, indices) {
  if (!indices.length) return null;
  return `Tricky words for you: ${indices.slice(0, 5).map((i) => bare(tokens[i].d)).join(', ')}.`;
}
