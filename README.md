# Off Script for the cast

Learn your part, word for word and cue by cue, on your phone.

This is the company version of Off Script. A cast member adds it to their Home Screen, types the company code, picks their name, and learns every line they speak. It shows one number: how much is learnt. Lines come back just before they would fade, and a line only counts once it has been typed right from its cue.

## What is here and what is not

* This repository holds code only: no script, no names, no audio and no company code. A privacy check runs before every push.
* The packs are sealed on a laptop and held on a small worker. The worker cannot open them: it keeps only a hash of the token that the company code gives.
* Progress stays on the phone. There is no staff view, no account and no analytics.
* A reminder is an empty push. The phone writes the words itself, so the worker never sees a message, a name or a line.

## Make and send the packs

These need the script, the casting and an audio pack, all of which stay on the laptop. `--out` must be a private folder outside this repository.

```bash
node tools/make-packs.mjs --script <script.docx> --cast <cast.json> --audio <audio pack.zip> --out <private folder>
```

```bash
npx wrangler login
```

```bash
node tools/worker-setup.mjs --out <private folder> --sub <the app's address>
```

```bash
node tools/set-worker.mjs --url https://off-script-cast.<name>.workers.dev --vapid <public key>
```

## Develop

* `npm test` runs the unit tests.
* `npx playwright test` runs the browser tests in WebKit and Chromium, on an invented play, with a local stand in for the worker.
* `npm run serve` serves the app at http://localhost:4173/off-script-cast/
* `npm run privacy` checks that no listed name, script or audio file is in the repository.
* Change `VERSION` in `sw.js` with every release, so phones pick up the update.
* `npm run publish:app` publishes the app to Cloudflare Pages, at https://off-script-cast.pages.dev/

No build step and no runtime dependencies: plain ES modules, with fflate (MIT) vendored for zip files. The worker has a single file and no dependencies.
