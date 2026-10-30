// Saying a line is on trust; typing it is proof. A line only counts towards % learnt once it has
// been typed right from its cue alone, in a round. Walks never prove a line, and the ladder does not
// either: it is too soon after seeing it. Nor does chosen practice or a run (session.js), or a slip
// of the finger counted right. Any miss loses the proof (applyResult), and a line typed right in
// Already know some? waits for another day. So a pupil who says they know everything still has to
// show it.
import { fnv1a } from '../items.js';
import { isWordPerfect, knownToday } from '../state.js';

// A wrong key he calls a slip of the finger is counted right, but proves nothing.
export const earnsProof = ({ pass, mode, help, ladder, slip = false }) => !!pass && mode === 'type' && !help && !ladder && !slip;

// Right at least once and not yet proved: this go is typed. day: today, for a line typed right in
// Already know some?, which cannot be proved the same day.
export const needsProof = (s, day) => s.passes >= 1 && !s.proved && !knownToday(s, day);

// About one in three of the other checks of learned lines, chosen so it cannot be guessed.
export const spotCheck = (s, goes, id) => s.status === 'review' && !needsProof(s) && parseInt(fnv1a(`spot:${goes}:${id}`), 36) % 3 === 0;

export const isLearnt = (s) => isWordPerfect(s) && !!s.proved;

const share = (items, getState) => {
  const total = items.reduce((n, it) => n + it.words, 0);
  const learnt = items.filter((it) => isLearnt(getState(it.id))).reduce((n, it) => n + it.words, 0);
  // Rounded down: 100% only when every line is there.
  return total ? Math.floor((100 * learnt) / total) : 0;
};

export const learntPercent = (model, getState) => share(model.items, getState);

export function sceneLights(model, getState) {
  return model.scenes
    .filter((sc) => sc.itemIds.length)
    .map((sc) => ({ scene: sc.index, heading: sc.heading, percent: share(model.items.filter((it) => it.scene === sc.index), getState) }));
}

// Lines the curve says are starting to go: learnt, and ready to check. Not lines ready only because of
// the date (readyLines in plan.js): nothing has changed for them, and the date is not for showing.
export const fadingCount = (ready, getState) => [...ready.keys()].filter((id) => !ready.forced?.has(id) && isLearnt(getState(id))).length;

// Milestones crossed going from one % to another, highest first: for the moment after a round.
export const MILESTONES = [100, 75, 50, 25];
export const crossed = (before, after) => MILESTONES.find((m) => before < m && after >= m) ?? null;

// What a round gained, for its last screen: the rise in %, or else the lines on their way. A first
// round on a big part can leave the % where it was, and that is still a good round.
export function gainLine(before, after, onWay) {
  if (after > before) return `Up ${after - before}% to ${after}%.`;
  if (onWay === 1) return '1 line on its way.';
  return onWay ? `${onWay} lines on their way.` : null;
}
