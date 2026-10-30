// Where the cast's worker is, and its public push key. Neither is secret. tools/set-worker.mjs fills
// these in once the worker is up, and the same address goes in the page's Content Security Policy.
export const WORKER = 'https://off-script-cast.example.workers.dev';
export const VAPID_PUBLIC = '';
