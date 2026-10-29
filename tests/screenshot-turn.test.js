import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

// The side to move is the user's explicit decision: never defaulted, never guessed.
async function mountScreenshotUi() {
  const { window, document } = parseHTML(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  Object.assign(globalThis, { window, document });
  const applied = [];
  const { initScreenshotFeature } = await import('../src/screenshot.js?turn=' + Math.random());
  initScreenshotFeature({ onApplyFen: fen => applied.push(fen), onStatus: () => {} });
  const $ = id => document.getElementById(id);
  return { $, applied, document };
}

test('no side to move is preselected and evaluation is blocked until the user picks one', async () => {
  const { $, applied } = await mountScreenshotUi();
  assert.equal($('turn-white-btn').classList.contains('active'), false);
  assert.equal($('turn-black-btn').classList.contains('active'), false);
  assert.equal($('screenshot-evaluate-btn').disabled, true);
  assert.match($('turn-hint').textContent, /\S/);
  assert.equal($('screenshot-fen-input').value.includes(' w '), false);
  assert.equal($('screenshot-fen-input').value.includes(' b '), false);

  $('screenshot-evaluate-btn').click();
  assert.equal(applied.length, 0);

  $('turn-black-btn').click();
  assert.equal($('turn-black-btn').classList.contains('active'), true);
  assert.equal($('turn-white-btn').classList.contains('active'), false);
  assert.equal($('screenshot-evaluate-btn').disabled, false);
  assert.equal($('turn-hint').textContent, '');
  assert.match($('screenshot-fen-input').value, / b - - 0 1$/);

  $('screenshot-evaluate-btn').click();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].split(' ')[1], 'b');
});

test('choosing the other side re-enables the correct turn and reset forgets the choice', async () => {
  const { $ } = await mountScreenshotUi();
  $('turn-white-btn').click();
  assert.match($('screenshot-fen-input').value, / w - - 0 1$/);
  $('screenshot-reset-btn').click();
  assert.equal($('turn-white-btn').classList.contains('active'), false);
  assert.equal($('screenshot-evaluate-btn').disabled, true);
});
