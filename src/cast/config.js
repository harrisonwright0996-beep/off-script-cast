// Where the cast's worker is, and its public push key. Neither is secret. tools/set-worker.mjs fills
// these in once the worker is up, and the same address goes in the page's Content Security Policy.
export const WORKER = 'https://off-script-cast.off-script-lines.workers.dev';
export const VAPID_PUBLIC = 'BHn96EnCyS1b_jRR7DOiPuvnwcKMztcBGMoyE0cDfi_gqPR11gLI12q98JXm7AB0CuzqcT5JOJWW00NEIZtNDiM';
// The day after this, the show is over: the app removes the lines from the phone.
export const ENDS = '2027-01-31';
