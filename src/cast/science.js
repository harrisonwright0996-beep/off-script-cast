// Short notes on why this works, in plain words. One shows after each round, a different one each time.
export const SCIENCE = [
  'Trying to remember is what makes a line stick. Reading it again feels easier and does much less.',
  'If it felt hard, it was working. Struggling to find a line makes the memory stronger.',
  'Forgetting a bit is good. Bringing a line back just as it starts to fade makes it last much longer.',
  'Little and often beats one long go. Your brain stores lines while you sleep, so several short rounds work better than cramming.',
  'Getting a line wrong and seeing the right one helps you more than getting it right too easily.',
  'Speaking a line aloud sticks far more than going over it silently.',
  'Lines come back out of order so that you learn them from the cue, not from the line before. On stage, the cue is all you get.',
  'Walking and saying your lines works well: moving while you learn gives your brain more to hold on to.',
  'Knowing a line today does not mean you will know it next week. Memories fade unless you use them.',
];

export const scienceNote = (n) => SCIENCE[n % SCIENCE.length];
