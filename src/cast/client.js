// Talks to the worker, and turns what comes back into what the phone keeps.
import { WORKER } from './config.js';
import { deriveKeys, unseal } from './pack.js';
import { readAudioPack } from '../audiopack.js';
import { unzipSync, strFromU8 } from '../../vendor/fflate.js';

export class CastError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'wrong-code' | 'wrong-staff' | 'too-many' | 'offline' | 'damaged' | 'gone'
  }
}

async function fetchFile(name, token) {
  let res;
  try {
    res = await fetch(`${WORKER}/f/${name}`, { headers: { 'x-cast-token': token } });
  } catch {
    throw new CastError('offline');
  }
  if (res.status === 401) throw new CastError('wrong-code');
  if (res.status === 429) throw new CastError('too-many');
  if (res.status === 410) throw new CastError('gone');
  if (!res.ok) throw new CastError('offline');
  return res.arrayBuffer();
}

async function openFile(name, keys) {
  const sealed = await fetchFile(name, keys.token);
  try {
    return await unseal(keys.key, sealed);
  } catch {
    throw new CastError('damaged');
  }
}

export async function openCast(keys) {
  return JSON.parse(strFromU8(await openFile('cast', keys)));
}

// How many lines each part has in each scene, for the director's page.
export async function openSceneLines(keys) {
  return JSON.parse(strFromU8(await openFile('scene-lines', keys)));
}

// The company code: the keys, and the list of who is in the cast. The list stays on the phone only
// until a name is picked.
export async function unlock(code) {
  const keys = await deriveKeys(code);
  return { keys, cast: await openCast(keys) };
}

// A member's pack: { model, manifest, clips }.
export async function fetchPack(keys, file) {
  const bytes = await openFile(file, keys);
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'model.json' });
    const model = JSON.parse(strFromU8(files['model.json']));
    const { manifest, clips } = readAudioPack(bytes);
    return { model, manifest, clips };
  } catch {
    throw new CastError('damaged');
  }
}

// Every pupil's numbers, for the director's page.
export async function staffNumbers(code) {
  let res;
  try {
    res = await fetch(`${WORKER}/staff`, { headers: { 'x-staff-token': code.trim() } });
  } catch {
    throw new CastError('offline');
  }
  if (res.status === 401) throw new CastError('wrong-staff');
  if (res.status === 429) throw new CastError('too-many');
  if (!res.ok) throw new CastError('offline');
  return res.json();
}

// Takes a row off the director's page: a wrong part, a typing slip, or someone who has left.
export async function staffRemove(code, id) {
  const res = await fetch(`${WORKER}/staff/remove`, { method: 'POST', headers: { 'x-staff-token': code.trim(), 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  if (!res.ok) throw new CastError('offline');
}

export const post = (path, token, body) =>
  fetch(`${WORKER}${path}`, { method: 'POST', headers: { 'x-cast-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
