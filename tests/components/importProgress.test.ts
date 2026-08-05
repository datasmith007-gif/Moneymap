import { describe, expect, it } from 'vitest';
import { importProgressStep } from '../../src/pages/ImportPage.tsx';

describe('import progress', () => {
  it('derives all three steps from the existing queue state', () => {
    expect(importProgressStep(0, false, false)).toBe(1);
    expect(importProgressStep(2, false, false)).toBe(2);
    expect(importProgressStep(2, true, true)).toBe(3);
  });
});
