// Settings and their defaults. The dates are hidden: they only set how fast new lines come, and no
// screen shows them. Every day up to lastNewDay is plain learning; new lines carry on after it.
export const DEFAULT_SETTINGS = {
  deadline: '2026-11-05', // the day after the hidden pace ends
  lastNewDay: '2026-11-04', // the hidden pace aims to have every line started by this day
  showDay: '2026-12-14', // show week starts
  proofs: true, // a learned line not yet typed right counts as ready to check
  mode: 'say', // 'type' or 'say'; some cards insist on type whatever this says
  askSpeaker: false, // a pupil knows who they are: the card says which character it is
  sprintMinutes: 5,
  breakMinutes: 3,
  autoAdvance: false,
  textSize: 100, // percent, 90 to 200
  lineSpacing: 1.5, // 1.5, 1.8 or 2
  letterSpacing: 'normal', // 'normal', 'wide' or 'wider'
  theme: 'stage', // 'stage', 'cream', 'light', 'dark' or 'auto'
  walkGap: 'normal', // 'shorter', 'normal' or 'longer'
  voiceURI: null,
  rate: 1,
  focusScene: null, // "Learn this scene next"
  practice: null, // the last choices on Choose what to practise: { scene, which, help }
  runThrough: null, // the last choices on Run through: { scene, which, help }
};

export function withDefaults(saved) {
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
