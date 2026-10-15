import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditError, applyEdits, minimalReplacement } from './edits.js';

test('applies edits in order', () => {
  const out = applyEdits('a\nb\nc\n', [
    { search: 'b\n', replace: 'B\n' },
    { search: 'B\nc', replace: 'B\nC' },
  ]);
  assert.equal(out, 'a\nB\nC\n');
});

test('rejects missing and ambiguous search text', () => {
  assert.throws(() => applyEdits('abc', [{ search: 'x', replace: 'y' }]), EditError);
  assert.throws(() => applyEdits('aa', [{ search: 'a', replace: 'b' }]), /more than once/);
  assert.throws(() => applyEdits('aa', [{ search: '', replace: 'b' }]), /empty/);
});

test('adapts LF edits to CRLF files', () => {
  const out = applyEdits('one\r\ntwo\r\n', [{ search: 'one\ntwo', replace: 'one\n2' }]);
  assert.equal(out, 'one\r\n2\r\n');
});

test('minimalReplacement finds the changed span', () => {
  const before = 'const x = 1;\nconst y = 2;\n';
  const after = 'const x = 1;\nconst y = 3;\n';
  const r = minimalReplacement(before, after);
  assert.equal(before.slice(0, r.start) + r.text + before.slice(r.end), after);
  assert.equal(r.text, '3');
});

test('minimalReplacement handles repeated characters at the boundary', () => {
  const before = 'aaa';
  const after = 'aaaa';
  const r = minimalReplacement(before, after);
  assert.equal(before.slice(0, r.start) + r.text + before.slice(r.end), after);
});
