import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineWithNano, isGrounded } from '../src/lib/parser/nano.js';
import { parseTracklist } from '../src/lib/parser/index.js';

function mockNano(answer) {
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({
      prompt: async () => JSON.stringify(answer),
      destroy() {},
    }),
  };
}

test('grounding check rejects invented text', () => {
  assert.ok(isGrounded('Mariya Takeuchi', 'Mariya Takeuchi Plastic Love'));
  assert.ok(!isGrounded('Tatsuro Yamashita', 'Mariya Takeuchi Plastic Love'));
});

test('Nano splits separator-less lines and hallucinations fall back', async () => {
  const { tracks } = parseTracklist(`0:00 Mariya Takeuchi Plastic Love\n4:00 Anri Last Summer Whisper\n8:00 ID - ID`);
  assert.equal(tracks[0].left, null); // heuristics can't split these

  mockNano({
    tracks: [
      { line: 0, artist: 'Mariya Takeuchi', title: 'Plastic Love', unknown: false },
      { line: 1, artist: 'Tatsuro Yamashita', title: 'Last Summer Whisper', unknown: false }, // wrong artist
    ],
  });
  const refined = await refineWithNano(tracks);
  assert.equal(refined[0].left, 'Mariya Takeuchi');
  assert.equal(refined[0].right, 'Plastic Love');
  assert.equal(refined[0].nano, true);
  assert.equal(refined[1].left, null, 'ungrounded answer is ignored');
  assert.equal(refined[1].nano, undefined);
  assert.equal(refined[2].status, 'unknown');
  delete globalThis.LanguageModel;
});

test('a failing Nano chunk keeps the heuristic parse', async () => {
  const { tracks } = parseTracklist(`Bonobo - Kerala\nTycho - Awake`);
  globalThis.LanguageModel = {
    create: async () => ({ prompt: async () => { throw new Error('boom'); }, destroy() {} }),
  };
  const refined = await refineWithNano(tracks);
  assert.deepEqual(refined.map((t) => t.left), ['Bonobo', 'Tycho']);
  delete globalThis.LanguageModel;
});
