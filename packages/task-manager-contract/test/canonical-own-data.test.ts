import { describe, expect, test } from 'bun:test';
import {
  canonicalOwnDataBytes,
  canonicalOwnDataDigest,
  deepFrozenCanonicalOwnDataClone,
  sha256Hex,
} from '../src/index.js';

describe('closed canonical own-data authority', () => {
  test('clones enumerable data properties without invoking code and preserves dangerous keys safely', () => {
    const source = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(source, '__proto__', {
      value: { safe: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(source, 'answer', {
      value: 42,
      enumerable: true,
      configurable: true,
      writable: false,
    });

    const clone = deepFrozenCanonicalOwnDataClone(source) as Record<string, unknown>;

    expect(Object.getPrototypeOf(clone)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(clone, '__proto__')).toBe(true);
    expect(clone.__proto__).toEqual({ safe: true });
    expect(clone.answer).toBe(42);
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(clone.__proto__)).toBe(true);
    expect(new TextDecoder().decode(canonicalOwnDataBytes(source))).toBe('{"__proto__":{"safe":true},"answer":42}');
    expect(canonicalOwnDataDigest(source)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('rejects every value outside the closed JSON own-data subset', () => {
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
    const symbolKey = { value: 1 } as Record<PropertyKey, unknown>;
    symbolKey[Symbol('hidden')] = 2;
    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    customPrototype.value = 1;
    const sparse = Array(2);
    sparse[1] = 'present';
    const extended = ['value'] as string[] & { extra?: string };
    extended.extra = 'hidden';
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const candidate of [
      accessor,
      symbolKey,
      customPrototype,
      sparse,
      extended,
      { value: undefined },
      [undefined],
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      cyclic,
    ]) {
      expect(() => deepFrozenCanonicalOwnDataClone(candidate)).toThrow();
    }
  });
});
