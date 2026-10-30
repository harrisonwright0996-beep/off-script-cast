#!/usr/bin/env node
// Makes the sealed packs on the laptop: one for each cast member, and the cast list. Everything
// private comes in by argument and goes out to a folder outside this repository. It prints counts
// only, never a name, a line or the code. Audio comes from an existing audio pack; only the coach,
// the stage directions and roles played as someone else are spoken here. Needs say and LAME.
//
//   node tools/make-packs.mjs --script <script.docx> --cast <cast.json> --audio <audio pack.zip> --out <folder>
//
// In --out: code.txt (kept between runs, so a remake keeps the same code), token-hash.txt, files/.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomInt } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocxParagraphs } from '../src/docx.js';
import { parseScript } from '../src/parse.js';
import { buildModel, displayRole, fnv1a } from '../src/items.js';
import { readAudioPack } from '../src/audiopack.js';
import { parseMp3 } from '../src/mp3.js';
import { COACH } from '../src/coach.js';
import { noteKey, spokenRole } from '../src/tape.js';
import { castList, memberPack, selfOf } from '../src/cast/build.js';
import { deriveKeys, seal, tokenHash } from '../src/cast/pack.js';
import { WORDS } from './words.mjs';

const run = promisify(execFile);
const REPO = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const VOICE = 'Daniel';
const spoken = (note) => note.replace(/[[\]]/g, '').trim();

// The roles whose clip in the audio pack leaves out who they are playing.
export const asRoles = (model) => [...new Set(model.items.map((it) => it.speaker))].filter((label) => spokenRole(label) !== label);

export function makeCode(pick = randomInt) {
  return Array.from({ length: 4 }, () => WORDS[pick(WORDS.length)]).join(' ');
}

// One clip in the audio pack's format.
async function say(text, work, name) {
  const txt = join(work, `${name}.txt`);
  const wav = join(work, `${name}.wav`);
  const mp3 = join(work, `${name}.mp3`);
  await writeFile(txt, text);
  await run('say', ['-v', VOICE, '--data-format=LEI16@22050', '-o', wav, '-f', txt]);
  await run('lame', ['--quiet', '-t', '-m', 'm', '-b', '32', '--cbr', '--resample', '22.05', wav, mp3]);
  return parseMp3(new Uint8Array(await readFile(mp3)));
}

export async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!opt.script || !opt.cast || !opt.audio || !opt.out) throw new Error('Usage: node tools/make-packs.mjs --script <docx> --cast <json> --audio <zip> --out <folder outside this repository>');
  const out = resolve(opt.out);
  await mkdir(join(out, 'files'), { recursive: true });
  const rel = relative(REPO, realpathSync(out));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('Choose an --out folder outside the repository.');

  const model = buildModel(parseScript(readDocxParagraphs(new Uint8Array(await readFile(resolve(opt.script))))));
  const cast = JSON.parse(await readFile(resolve(opt.cast), 'utf8'));
  if (cast.hash !== model.hash) throw new Error('The casting was made from a different version of the script. Run make-cast again.');
  const audio = readAudioPack(new Uint8Array(await readFile(resolve(opt.audio))));
  if (audio.manifest.scriptHash !== model.hash) throw new Error('The audio pack is from a different version of the script.');

  const codeFile = join(out, 'code.txt');
  const code = existsSync(codeFile) ? (await readFile(codeFile, 'utf8')).trim() : makeCode();
  await writeFile(codeFile, `${code}\n`);
  await chmod(codeFile, 0o600);
  const keys = await deriveKeys(code);
  await writeFile(join(out, 'token-hash.txt'), `${await tokenHash(keys.token)}\n`);

  const work = await mkdtemp(join(tmpdir(), 'off-script-packs-'));
  const coach = {};
  const notes = {};
  const roles = asRoles(model);
  try {
    for (const [key, text] of Object.entries(COACH)) {
      const mp3 = await say(text, work, `coach-${key}`);
      const file = `k-${key}.mp3`;
      audio.clips.set(file, mp3.bytes);
      coach[key] = { file, duration: mp3.duration };
    }
    const all = new Set(model.items.flatMap((it) => it.cue.notes));
    for (const note of all) {
      if (!spoken(note)) continue;
      const key = noteKey(note);
      const mp3 = await say(spoken(note), work, `note-${key}`);
      const file = `n-${key}.mp3`;
      audio.clips.set(file, mp3.bytes);
      notes[key] = { file, duration: mp3.duration };
    }
    for (const label of roles) {
      const key = fnv1a(label);
      const mp3 = await say(spokenRole(label), work, `role-${key}`);
      const file = `r-${key}.mp3`;
      audio.clips.set(file, mp3.bytes);
      audio.manifest.speakers[label] = { file, duration: mp3.duration };
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  // Phones fetch their pack again when this changes, so it covers what is spoken here.
  const version = fnv1a(`${model.hash}|${cast.members.map((m) => m.ids.join()).join('|')}|${JSON.stringify(COACH)}|${roles.length}`);
  const list = [];
  let total = 0;
  for (const member of cast.members) {
    const { sub, zip } = memberPack(model, member, audio, { coach, notes });
    const file = `p${fnv1a(`${code}|${member.name}`)}`;
    const sealed = await seal(keys.key, zip);
    await writeFile(join(out, 'files', file), sealed);
    total += sealed.length;
    const name = selfOf(model, member.name) || displayRole(member.name);
    list.push({ name, file, lines: sub.items.length });
    console.log(`Pack ${list.length}: ${sub.items.length} lines, ${(sealed.length / 1e6).toFixed(1)} MB`);
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  await writeFile(join(out, 'files', 'cast'), await seal(keys.key, castList(list, version)));
  console.log(`${list.length} packs, ${(total / 1e6).toFixed(1)} MB in all, ${Object.keys(notes).length} stage directions and ${roles.length} roles spoken. Code and files are in the --out folder.`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Packs failed: ${err.message}`);
    process.exit(1);
  });
}
