import { describe, it, expect } from 'vitest';

describe('toolchain smoke test', () => {
  it('runs vitest and typechecks', () => {
    expect(1 + 1).toBe(2);
  });
});
