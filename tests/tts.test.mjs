import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speak, voices } from '../src/tts.js';

const LOCAL = { voiceURI: 'local', name: 'On the phone', lang: 'en-GB', localService: true };
const NETWORK = { voiceURI: 'net', name: 'Over the network', lang: 'en-GB', localService: false };
const FRENCH = { voiceURI: 'fr', name: 'Français', lang: 'fr-FR', localService: true };

function phone(list) {
  const spoken = [];
  globalThis.speechSynthesis = {
    getVoices: () => list,
    speak: (u) => {
      spoken.push(u);
      u.onend();
    },
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  return spoken;
}

test('only voices that run on the phone are offered', () => {
  phone([NETWORK, LOCAL, FRENCH]);
  assert.deepEqual(voices(), [LOCAL]);
});

test('a network voice is never used, even one saved in settings', async () => {
  const spoken = phone([NETWORK, LOCAL]);
  await speak('A line.', { voiceURI: 'net' });
  assert.equal(spoken[0].voice, LOCAL);
});

test('with no voice on the phone, none is chosen', async () => {
  const spoken = phone([NETWORK]);
  await speak('A line.', { voiceURI: 'net' });
  assert.equal(spoken[0].voice, undefined);
  assert.equal(spoken[0].lang, 'en-GB');
});
