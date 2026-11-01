import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// src/redirect.js is the script the build puts at the top of the Korean page. It runs here the same way, with a
// stand-in for what it reads (the stored language, the browser language, the address) and for its one act.
const source = readFileSync(new URL('../../src/redirect.js', import.meta.url), 'utf8');

/* stored: the value localStorage gives back, or Error to have it throw (blocked storage). languages / language: the
   browser's. Returns what location.replace was called with (an array of arguments), [] if it was not called. */
function visit({ stored, languages, language, search = '', hash = '' }) {
  const replaced = [];
  const ctx = vm.createContext({
    localStorage: { getItem(key) {
      assert.equal(key, 'nocturne.lang');
      if (stored instanceof Error) throw stored;
      return stored === undefined ? null : stored;
    } },
    navigator: { languages, language },
    location: { search, hash, replace: (to) => replaced.push(to) },
  });
  vm.runInContext(source, ctx);
  return replaced;
}

const EN = { languages: ['en-US', 'en'], language: 'en-US' };
const KO = { languages: ['ko-KR', 'ko'], language: 'ko-KR' };
const blocked = new Error('SecurityError');

test('English was chosen before: go to the English page, keeping the hash', () => {
  assert.deepEqual(visit({ stored: 'en', ...KO, hash: '#river' }), ['en/#river']);
  assert.deepEqual(visit({ stored: 'en', ...KO }), ['en/']);
});

test('Korean was chosen before: stay, whatever the browser speaks', () => {
  assert.deepEqual(visit({ stored: 'ko', ...EN }), []);
});

test('nothing chosen: the browser language decides', () => {
  assert.deepEqual(visit({ stored: undefined, ...KO }), []);
  assert.deepEqual(visit({ stored: undefined, ...EN }), ['en/']);
  assert.deepEqual(visit({ stored: undefined, languages: [], language: 'ko' }), []);  // no list: the single language
  assert.deepEqual(visit({ stored: undefined, languages: undefined, language: undefined }), ['en/']);  // none at all
});

test('blocked storage counts as nothing chosen', () => {
  assert.deepEqual(visit({ stored: blocked, ...EN }), ['en/']);
  assert.deepEqual(visit({ stored: blocked, ...KO }), []);
});

test('?lang=ko: the reader just chose Korean, so stay (storage may be blocked)', () => {
  assert.deepEqual(visit({ stored: blocked, ...EN, search: '?lang=ko' }), []);
  assert.deepEqual(visit({ stored: 'en', ...EN, search: '?lang=ko' }), []);
  assert.deepEqual(visit({ stored: undefined, ...EN, search: '?a=1&lang=ko' }), []);
  assert.deepEqual(visit({ stored: undefined, ...EN, search: '?lang=ko&a=1' }), []);
});

test('only lang=ko as a parameter of its own counts', () => {
  for (const search of ['?xlang=ko', '?lang=kor', '?lang=en', '?a=lang=ko', '']) {
    assert.deepEqual(visit({ stored: blocked, ...EN, search }), ['en/'], search);
  }
});
