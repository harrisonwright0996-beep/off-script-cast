#!/usr/bin/env node
// Makes files/scene-lines from packs already made, with no need of the script or the audio: how many
// lines each pack has in each scene. Prints counts only. make-packs.mjs makes the same file.
//
//   node tools/scene-lines.mjs --out <folder>
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strFromU8, unzipSync } from '../vendor/fflate.js';
import { sceneLines } from '../src/cast/build.js';
import { cleanCode, deriveKeys, seal, unseal } from '../src/cast/pack.js';

const out = process.argv[process.argv.indexOf('--out') + 1];
const keys = await deriveKeys(cleanCode((await readFile(join(out, 'code.txt'), 'utf8')).trim()));
const open = async (name) => unseal(keys.key, new Uint8Array(await readFile(join(out, 'files', name))));
const { members } = JSON.parse(strFromU8(await open('cast')));
const packs = [];
for (const { file } of members) packs.push({ file, model: JSON.parse(strFromU8(unzipSync(await open(file))['model.json'])) });
const made = sceneLines(packs);
await writeFile(join(out, 'files', 'scene-lines'), await seal(keys.key, made));
const { scenes } = JSON.parse(strFromU8(made));
console.log(`${packs.length} parts, ${scenes.length} scenes.`);
