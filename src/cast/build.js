// One member's pack, from the whole play's model and audio. Used by tools/make-packs.mjs on the
// laptop and by the browser tests: the part of the job that holds no private data.
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
  const ownNotes = new Set(sub.items.flatMap((it) => it.cue.notes.map(noteKey)));
  const usedNotes = Object.fromEntries(Object.entries(notes).filter(([k]) => ownNotes.has(k)));
  const manifest = { version: PACK_VERSION, scriptHash: sub.hash, sampleRate: m.sampleRate, bitrate: m.bitrate, made: m.made, silence: m.silence, items, speakers, headings, coach, notes: usedNotes };
  const refs = [manifest.silence, ...Object.values(items).flatMap((x) => [x.line, x.cue].filter(Boolean)), ...Object.values(speakers), ...Object.values(headings), ...Object.values(coach), ...Object.values(usedNotes)];
  const files = { 'model.json': strToU8(JSON.stringify(sub)), 'manifest.json': strToU8(JSON.stringify(manifest)) };
  for (const ref of refs) files[ref.file] = audio.clips.get(ref.file);
  return { sub, zip: zipSync(files, { level: 0 }), clips: refs.length };
}

export const castList = (members, version) => strToU8(JSON.stringify({ version, members }));
