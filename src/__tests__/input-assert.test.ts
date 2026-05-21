/**
 * Unit tests for the input-validation helpers added in validation.ts
 * (InputError + assert* family). These cover the IMPROVEMENT_NOTES item B
 * fix surface: every required-field check, every optional-field passthrough,
 * every type-mismatch path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  InputError,
  assertString,
  assertOptionalString,
  assertStringArray,
  assertOptionalStringArray,
  assertNumber,
  assertOptionalNumber,
  assertOptionalBoolean,
  assertOptionalEnum,
  assertEnum,
  assertObjectArray,
  assertOptionalRecord,
} from '../validation.js';

describe('InputError', () => {
  it('has a name property set to InputError', () => {
    const err = new InputError('foo', 'string', undefined);
    assert.strictEqual(err.name, 'InputError');
  });

  it('captures field, expected, and got descriptions', () => {
    const err = new InputError('foo', 'non-empty string', 42);
    assert.strictEqual(err.field, 'foo');
    assert.strictEqual(err.expected, 'non-empty string');
    assert.ok(err.got.includes('number'));
  });

  it('describes undefined inputs as "undefined" not "object"', () => {
    const err = new InputError('foo', 'string', undefined);
    assert.strictEqual(err.got, 'undefined');
  });

  it('describes null inputs as "null"', () => {
    const err = new InputError('foo', 'string', null);
    assert.strictEqual(err.got, 'null');
  });

  it('describes arrays distinctly from objects', () => {
    const errArr = new InputError('foo', 'string', [1, 2, 3]);
    const errObj = new InputError('foo', 'string', { a: 1 });
    assert.ok(errArr.got.startsWith('array'));
    assert.ok(errObj.got.startsWith('object'));
  });

  it('truncates large object payloads in the description', () => {
    const big = { x: 'a'.repeat(500) };
    const err = new InputError('foo', 'string', big);
    assert.ok(err.got.length < 200, 'truncated payload should be short');
  });
});

describe('assertString', () => {
  it('returns the string when present and non-empty', () => {
    assert.strictEqual(assertString({ q: 'hello' }, 'q'), 'hello');
  });

  it('throws InputError when missing', () => {
    assert.throws(() => assertString({}, 'q'), { name: 'InputError' });
  });

  it('throws InputError when empty string', () => {
    assert.throws(() => assertString({ q: '' }, 'q'), { name: 'InputError' });
  });

  it('throws InputError when wrong type (number)', () => {
    assert.throws(() => assertString({ q: 42 }, 'q'), { name: 'InputError' });
  });

  it('throws InputError when null', () => {
    assert.throws(() => assertString({ q: null }, 'q'), { name: 'InputError' });
  });
});

describe('assertOptionalString', () => {
  it('returns undefined when absent', () => {
    assert.strictEqual(assertOptionalString({}, 'q'), undefined);
  });

  it('returns undefined when null', () => {
    assert.strictEqual(assertOptionalString({ q: null }, 'q'), undefined);
  });

  it('returns the string when present', () => {
    assert.strictEqual(assertOptionalString({ q: 'hi' }, 'q'), 'hi');
  });

  it('allows empty string (optional field)', () => {
    assert.strictEqual(assertOptionalString({ q: '' }, 'q'), '');
  });

  it('throws InputError on wrong type', () => {
    assert.throws(() => assertOptionalString({ q: 42 }, 'q'), { name: 'InputError' });
  });
});

describe('assertStringArray', () => {
  it('returns the array when valid', () => {
    assert.deepStrictEqual(assertStringArray({ qs: ['a', 'b'] }, 'qs'), ['a', 'b']);
  });

  it('throws when missing', () => {
    assert.throws(() => assertStringArray({}, 'qs'), { name: 'InputError' });
  });

  it('throws when not an array', () => {
    assert.throws(() => assertStringArray({ qs: 'not-array' }, 'qs'), { name: 'InputError' });
  });

  it('throws when array contains non-strings', () => {
    assert.throws(() => assertStringArray({ qs: ['a', 42] }, 'qs'), { name: 'InputError' });
  });

  it('throws when array contains empty strings', () => {
    assert.throws(() => assertStringArray({ qs: ['a', ''] }, 'qs'), { name: 'InputError' });
  });

  it('enforces minLen', () => {
    assert.throws(() => assertStringArray({ qs: [] }, 'qs', { minLen: 1 }), {
      name: 'InputError',
    });
    assert.throws(() => assertStringArray({ qs: ['a'] }, 'qs', { minLen: 2 }), {
      name: 'InputError',
    });
  });
});

describe('assertOptionalStringArray', () => {
  it('returns undefined when absent', () => {
    assert.strictEqual(assertOptionalStringArray({}, 'qs'), undefined);
  });

  it('returns the array when present', () => {
    assert.deepStrictEqual(assertOptionalStringArray({ qs: ['a'] }, 'qs'), ['a']);
  });

  it('throws on wrong type', () => {
    assert.throws(() => assertOptionalStringArray({ qs: 'str' }, 'qs'), { name: 'InputError' });
  });
});

describe('assertNumber', () => {
  it('returns the number when valid', () => {
    assert.strictEqual(assertNumber({ n: 42 }, 'n'), 42);
  });

  it('throws when missing', () => {
    assert.throws(() => assertNumber({}, 'n'), { name: 'InputError' });
  });

  it('throws on NaN', () => {
    assert.throws(() => assertNumber({ n: NaN }, 'n'), { name: 'InputError' });
  });

  it('throws on Infinity', () => {
    assert.throws(() => assertNumber({ n: Infinity }, 'n'), { name: 'InputError' });
  });

  it('enforces min', () => {
    assert.throws(() => assertNumber({ n: 0 }, 'n', { min: 1 }), { name: 'InputError' });
  });

  it('enforces max', () => {
    assert.throws(() => assertNumber({ n: 101 }, 'n', { max: 100 }), { name: 'InputError' });
  });
});

describe('assertOptionalNumber', () => {
  it('returns undefined when absent', () => {
    assert.strictEqual(assertOptionalNumber({}, 'n'), undefined);
  });

  it('returns the number when present', () => {
    assert.strictEqual(assertOptionalNumber({ n: 5 }, 'n'), 5);
  });

  it('respects min/max bounds', () => {
    assert.throws(() => assertOptionalNumber({ n: 5 }, 'n', { min: 10 }), {
      name: 'InputError',
    });
  });
});

describe('assertOptionalBoolean', () => {
  it('returns undefined when absent', () => {
    assert.strictEqual(assertOptionalBoolean({}, 'b'), undefined);
  });

  it('returns true/false when present', () => {
    assert.strictEqual(assertOptionalBoolean({ b: true }, 'b'), true);
    assert.strictEqual(assertOptionalBoolean({ b: false }, 'b'), false);
  });

  it('throws on non-boolean', () => {
    assert.throws(() => assertOptionalBoolean({ b: 'true' }, 'b'), { name: 'InputError' });
    assert.throws(() => assertOptionalBoolean({ b: 1 }, 'b'), { name: 'InputError' });
  });
});

describe('assertOptionalEnum', () => {
  it('returns undefined when absent', () => {
    assert.strictEqual(assertOptionalEnum({}, 'm', ['flash', 'pro', 'auto'] as const), undefined);
  });

  it('returns the allowed value', () => {
    assert.strictEqual(
      assertOptionalEnum({ m: 'flash' }, 'm', ['flash', 'pro', 'auto'] as const),
      'flash'
    );
  });

  it('throws on disallowed value', () => {
    assert.throws(
      () => assertOptionalEnum({ m: 'turbo' }, 'm', ['flash', 'pro', 'auto'] as const),
      { name: 'InputError' }
    );
  });
});

describe('assertEnum', () => {
  it('throws when absent', () => {
    assert.throws(() => assertEnum({}, 'm', ['a', 'b'] as const), { name: 'InputError' });
  });

  it('returns the value when present and valid', () => {
    assert.strictEqual(assertEnum({ m: 'a' }, 'm', ['a', 'b'] as const), 'a');
  });
});

describe('assertObjectArray', () => {
  it('returns mapped items', () => {
    const result = assertObjectArray(
      { items: [{ path: 'a.ts', description: 'A' }] },
      'items',
      (item) => {
        const i = item as { path: string; description: string };
        return { path: i.path, description: i.description };
      }
    );
    assert.deepStrictEqual(result, [{ path: 'a.ts', description: 'A' }]);
  });

  it('throws when not an array', () => {
    assert.throws(() => assertObjectArray({ items: 'not array' }, 'items', (item) => item), {
      name: 'InputError',
    });
  });

  it('enforces minLen', () => {
    assert.throws(() => assertObjectArray({ items: [] }, 'items', (item) => item, { minLen: 1 }), {
      name: 'InputError',
    });
  });

  it('propagates per-item validation errors', () => {
    assert.throws(
      () =>
        assertObjectArray({ items: [{}] }, 'items', (item, idx) => {
          const i = item as Record<string, unknown>;
          if (typeof i.path !== 'string') {
            throw new InputError(`items[${idx}].path`, 'string', i.path);
          }
          return i;
        }),
      { name: 'InputError' }
    );
  });
});

describe('assertOptionalRecord', () => {
  it('returns undefined when absent', () => {
    assert.strictEqual(assertOptionalRecord({}, 'r'), undefined);
  });

  it('returns the record when present', () => {
    assert.deepStrictEqual(assertOptionalRecord({ r: { a: 1 } }, 'r'), { a: 1 });
  });

  it('throws on array (not a plain object)', () => {
    assert.throws(() => assertOptionalRecord({ r: [1, 2] }, 'r'), { name: 'InputError' });
  });

  it('throws on primitive', () => {
    assert.throws(() => assertOptionalRecord({ r: 'str' }, 'r'), { name: 'InputError' });
  });
});
