import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeParameter, decodeParameter } from '../src/core.js';

test('encode plain ASCII short value returns single fragment', () => {
  assert.deepEqual(encodeParameter('filename', 'report.txt'), [
    { name: 'filename', value: 'report.txt' },
  ]);
});

test('encode long ASCII value splits into continuation fragments', () => {
  const longValue = 'a'.repeat(200);
  const fragments = encodeParameter('name', longValue);
  assert.equal(fragments.length > 1, true);
  assert.equal(fragments[0].name, 'name*0');
  assert.equal(fragments[1].name, 'name*1');
  const combined = fragments.map((f) => f.value).join('');
  assert.equal(combined, longValue);
});

test('encode non-ASCII value uses extended syntax with UTF-8 percent-encoding', () => {
  const fragments = encodeParameter('filename', 'café.txt');
  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].name, 'filename*0*');
  assert.equal(fragments[0].value, "utf-8''caf%C3%A9.txt");
});

test('encode non-ASCII long value splits extended syntax across fragments', () => {
  const longValue = 'é'.repeat(100);
  const fragments = encodeParameter('filename', longValue);
  assert.equal(fragments.length > 1, true);
  assert.equal(fragments[0].name, 'filename*0*');
  assert.equal(fragments[0].value.startsWith("utf-8''"), true);
  assert.equal(fragments[1].name, 'filename*1');
  const encodedValues = fragments.map((f) => f.value.replace(/^utf-8''/, '')).join('');
  assert.equal(utf8PercentDecodeForTest(encodedValues), longValue);
});

test('encode empty value returns one fragment', () => {
  const fragments = encodeParameter('filename', '');
  assert.deepEqual(fragments, [{ name: 'filename', value: '' }]);
});

test('decode plain parameter returns value unchanged', () => {
  assert.equal(decodeParameter('filename', 'report.txt'), 'report.txt');
});

test('decode extended parameter decodes UTF-8 percent-encoding', () => {
  assert.equal(decodeParameter('filename*', "utf-8''caf%C3%A9.txt"), 'café.txt');
});

test('decode extended parameter with unsupported charset throws', () => {
  assert.throws(() => decodeParameter('filename*', "iso-8859-1''caf%E9.txt"), /Unsupported charset/);
});

test('decode malformed extended value without apostrophes throws', () => {
  assert.throws(() => decodeParameter('filename*', 'caf%C3%A9.txt'), /Malformed extended parameter/);
});

test('encode rejects invalid parameter name', () => {
  assert.throws(() => encodeParameter('bad name', 'value'), /Invalid parameter name/);
});

test('encode rejects non-string arguments', () => {
  assert.throws(() => encodeParameter(123, 'value'), TypeError);
  assert.throws(() => encodeParameter('name', 123), TypeError);
});

test('decode rejects non-string arguments', () => {
  assert.throws(() => decodeParameter(123, 'value'), TypeError);
  assert.throws(() => decodeParameter('name', 123), TypeError);
});

// Helper to mirror the internal decoder for testing combined encoded values.
function utf8PercentDecodeForTest(encoded) {
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i];
    if (ch === '%') {
      const hex = encoded.slice(i + 1, i + 3);
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
}
