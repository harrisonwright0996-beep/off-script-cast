// One member's pack, from the whole play's model and audio. Used by tools/make-packs.mjs on the
// laptop and by the browser tests: the part of the job that holds no private data.
import { sceneKey } from './proof.js';
import { zipSync, strToU8 } from '../../vendor/fflate.js';
import { PACK_VERSION } from '../audiopack.js';
import { noteKey } from '../tape.js';
import { memberModel } from './subset.js';

// The speaker label that is the member themselves, if they have one.
export const selfOf = (model, name) => (model.items.find((it) => it.speaker.toLowerCase() === name.toLowerCase()) || {}).speaker ?? null;

// audio: { manifest, clips (a Map of name to bytes) } for the whole play, and coach and notes
// (name to { file, duration }), whose clips are in the same Map.
export function memberPack(model, member, audio, { coach = {}, notes = {} } = {}) {
  const sub = memberModel(model, member.ids, { self: selfOf(model, member.name) });
  const m = audio.manifest;
  const items = Object.fromEntries(sub.items.map((it) => [it.id, m.items[it.id]]).filter(([, x]) => x));
  const speakers = {};
  for (const it of sub.items) if (it.askSpeaker && m.speakers[it.speaker]) speakers[it.speaker] = m.speakers[it.speaker];
  const headings = {};
  for (const it of sub.items) if (it.cue.speaker === null && m.headings[it.scene]) headings[it.scene] = m.headings[it.scene];
  // A longer cue (uniqueCues) plays the lines before a line, often someone else's: their clips come
  // too, and what leads into the first of them.
  for (const it of sub.items) {
    const cue = sub.cues[it.id];
    if (!cue) continue;
    cue.lead.forEach((id, i) => {
      if (!m.items[id]) return;
      items[id] ||= { line: m.items[id].line, cue: null };
      if (i === 0) items[id] = { ...items[id], cue: m.items[id].cue };
    });
    if (cue.lines[0].speaker === null && m.headings[it.scene]) headings[it.scene] = m.headings[it.scene];
  }
  const ownNotes = new Set(sub.items.flatMap((it) => it.cue.notes.map(noteKey)));
  const usedNotes = Object.fromEntries(Object.entries(notes).filter(([k]) => ownNotes.has(k)));
  const manifest = { version: PACK_VERSION, scriptHash: sub.hash, sampleRate: m.sampleRate, bitrate: m.bitrate, made: m.made, silence: m.silence, items, speakers, headings, coach, notes: usedNotes };
  const refs = [manifest.silence, ...Object.values(items).flatMap((x) => [x.line, x.cue].filter(Boolean)), ...Object.values(speakers), ...Object.values(headings), ...Object.values(coach), ...Object.values(usedNotes)];
  const files = { 'model.json': strToU8(JSON.stringify(sub)), 'manifest.json': strToU8(JSON.stringify(manifest)) };
  for (const ref of refs) files[ref.file] = audio.clips.get(ref.file);
  return { sub, zip: zipSync(files, { level: 0 }), clips: refs.length };
}

export const castList = (members, version) => strToU8(JSON.stringify({ version, members }));

// How many lines each pack has in each scene, so the director's page can count every part in a scene,
// started or not. Counts and scene names only. packs: [{ file, model }].
export function sceneLines(packs) {
  const names = new Map();
  const parts = {};
  for (const { file, model } of packs) {
    parts[file] = {};
    for (const sc of model.scenes) {
      const lines = model.items.filter((it) => it.scene === sc.index).length;
      if (!lines) continue;
      names.set(sc.index, sceneKey(sc.heading));
      parts[file][sceneKey(sc.heading)] = lines;
    }
  }
  return strToU8(JSON.stringify({ scenes: [...names].sort((a, b) => a[0] - b[0]).map(([, key]) => key), parts }));
}
