// Saying a line is on trust; typing it is proof. A line only counts towards % learnt once it has
// been typed right from its cue alone. Walks never prove a line, and the ladder does not either: it
// is too soon after seeing it. So a pupil who says they know everything still has to show it.
import { fnv1a } from '../items.js';
import { isWordPerfect } from '../state.js';

export const earnsProof = ({ pass, mode, help, ladder }) => !!pass && mode === 'type' && !help && !ladder;

// Right at least once and not yet proved: this go is typed.
export const needsProof = (s) => s.passes >= 1 && !s.proved;

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

// Lines the curve says are starting to go: learnt, and ready to check.
export const fadingCount = (ready, getState) => [...ready.keys()].filter((id) => isLearnt(getState(id))).length;

// Milestones crossed going from one % to another, highest first: for the moment after a round.
export const MILESTONES = [100, 75, 50, 25];
export const crossed = (before, after) => MILESTONES.find((m) => before < m && after >= m) ?? null;
