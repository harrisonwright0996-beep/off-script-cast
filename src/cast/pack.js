// The locks on the packs. The company code gives two things: the key that opens a pack, and a token
// the worker asks for before it hands one over. The worker holds only a hash of the token, so it
// can never open a pack. Runs the same in the browser and in Node.
const SALT = new TextEncoder().encode('off-script-cast-v1');
export const ROUNDS = 600000;
const IV = 12;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g), (x) => parseInt(x, 16));

// Case, spaces, dashes and any stray marks do not matter: 'Otter lamp-River  nine' is 'otter lamp river nine'.
export const cleanCode = (s) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

export async function deriveKeys(code, rounds = ROUNDS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(cleanCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: rounds }, base, 512));
  return { key: hex(bits.subarray(0, 32)), token: hex(bits.subarray(32)) };
}

const aes = (key) => crypto.subtle.importKey('raw', unhex(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(key), bytes));
  const out = new Uint8Array(IV + body.length);
  out.set(iv);
  out.set(body, IV);
  return out;
}

// Throws if the key is wrong or the file has changed.
export async function unseal(key, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, IV) }, await aes(key), u8.subarray(IV)));
}

// A short text, sealed the same way, as text the worker can keep and cannot read.
export const sealText = async (key, text) => btoa(String.fromCharCode(...(await seal(key, new TextEncoder().encode(text)))));
export const openText = async (key, sealed) => new TextDecoder().decode(await unseal(key, Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0))));

export async function tokenHash(token) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}
