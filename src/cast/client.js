// Talks to the worker, and turns what comes back into what the phone keeps.
import { WORKER } from './config.js';
import { deriveKeys, unseal } from './pack.js';
import { readAudioPack } from '../audiopack.js';
import { unzipSync, strFromU8 } from '../../vendor/fflate.js';

export class CastError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'wrong-code' | 'too-many' | 'offline' | 'damaged'
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

export const post = (path, token, body) =>
  fetch(`${WORKER}${path}`, { method: 'POST', headers: { 'x-cast-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
