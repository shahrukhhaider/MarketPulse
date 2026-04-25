import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('Project Setup', () => {
  it('should have vitest working', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have fast-check working', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { numRuns: 100 }
    );
  });
});
