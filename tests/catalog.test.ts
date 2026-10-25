import { describe, expect, it } from 'vitest';
import {
  BIN_DEFINITIONS,
  STAR_BYTES,
  binForMagnitude,
  tycDesignation,
} from '../src/data/catalog.ts';

describe('catalog records', () => {
  it('assigns every finite magnitude to one display bin', () => {
    expect(binForMagnitude(-1.5).id).toBe(0);
    expect(binForMagnitude(6).id).toBe(1);
    expect(binForMagnitude(8).id).toBe(2);
    expect(binForMagnitude(10).id).toBe(3);
    expect(binForMagnitude(11).id).toBe(4);
    expect(binForMagnitude(12).id).toBe(5);
    expect(BIN_DEFINITIONS[0]?.maxFov).toBe(180);
    expect(STAR_BYTES).toBe(40);
  });

  it('retains exact TYC components in float32 storage', () => {
    const record = new Float32Array(10);
    record[8] = 5949;
    record[9] = 2777 * 4 + 1;
    expect(tycDesignation(record)).toBe('TYC 5949-2777-1');
  });
});
