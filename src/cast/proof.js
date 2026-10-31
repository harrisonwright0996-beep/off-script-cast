// Saying a line is on trust; typing it is proof. A line only counts towards % learnt once it has
// been typed right from its cue alone, in a round, on a day after it was first met and not on a day
// it was missed: being able to type it minutes after seeing it says little about tomorrow. Walks never
// prove a line, and the ladder does not either. Nor does chosen practice or a run (session.js), or a
// slip of the finger counted right. A miss in a round loses the proof (applyResult), and a line typed
// right in Already know some? waits for another day. So a pupil who says they know everything still
// has to show it.
import { fnv1a } from '../items.js';
import { isWordPerfect, knownToday } from '../state.js';

// A wrong key he calls a slip of the finger is counted right, but proves nothing.
export const earnsProof = ({ pass, mode, help, ladder, slip = false }) => !!pass && mode === 'type' && !help && !ladder && !slip;

// Right at least once and not yet proved: this go is typed. day: today, for a line typed right in
// Already know some?, which cannot be proved the same day.
export const canProve = (s, day) => !!s.firstDay && s.firstDay < day && !(s.missDays || []).includes(day) && !knownToday(s, day);
export const needsProof = (s, day) => s.passes >= 1 && !s.proved && canProve(s, day);

// A line on show (Reveal, or Read my lines) cannot be proved for this long after: long enough that
// typing it is remembering it, not copying it. Times are kept by the app (ctx.peek).
export const PEEK_GAP = 3600000;

// About one in three of the other checks of learned lines, chosen so it cannot be guessed.
export const spotCheck = (s, goes, id, day) => s.status === 'review' && !needsProof(s, day) && parseInt(fnv1a(`spot:${goes}:${id}`), 36) % 3 === 0;

export const isLearnt = (s) => isWordPerfect(s) && !!s.proved;

const share = (items, getState) => {
  const total = items.reduce((n, it) => n + it.words, 0);
  const learnt = items.filter((it) => isLearnt(getState(it.id))).reduce((n, it) => n + it.words, 0);
  // Rounded down: 100% only when every line is there.
  return total ? Math.floor((100 * learnt) / total) : 0;
};

export const learntPercent = (model, getState) => share(model.items, getState);

// A scene's short name: 2 for Scene 2, otherwise the start of its heading.
export const sceneKey = (heading) => /^Scene (\d+)/i.exec(heading)?.[1] ?? heading.split(':')[0].slice(0, 12).replace(/[|=]/g, ' ');

export function sceneLights(model, getState) {
  return model.scenes
    .filter((sc) => sc.itemIds.length)
    .map((sc) => ({ scene: sc.index, heading: sc.heading, percent: share(model.items.filter((it) => it.scene === sc.index), getState) }));
}

// Lines the curve says are starting to go: learnt, and ready to check. Not lines ready only because of
// the date (readyLines in plan.js): nothing has changed for them, and the date is not for showing.
export const onWayCount = (model, getState) => model.items.filter((it) => { const s = getState(it.id); return s.status !== 'new' && !isLearnt(s); }).length;

export const fadingCount = (ready, getState) => [...ready.keys()].filter((id) => !ready.forced?.has(id) && isLearnt(getState(id))).length;

// Milestones crossed going from one % to another, highest first: for the moment after a round.
export const MILESTONES = [100, 75, 50, 25];
export const crossed = (before, after) => MILESTONES.find((m) => before < m && after >= m) ?? null;

// What a round gained, for its last screen: the rise in %, or else the lines on their way. A first
// round on a big part can leave the % where it was, and that is still a good round.
export function gainLine(before, after, onWay) {
  if (after > before) return `Up to ${after}%.`;
  if (onWay === 1) return '1 line on its way. It counts towards your % once you can still do it on another day.';
  return onWay ? `${onWay} lines on their way. They count towards your % once you can still do them on another day.` : null;
}
