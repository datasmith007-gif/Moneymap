import { describe, expect, it } from 'vitest';
import { accountLastFour, formatAccountLabel } from '../../src/model/accountDisplay.ts';

describe('account display', () => {
  it('shows only the institution and final four account digits', () => {
    expect(accountLastFour('XXXXXXXXXXX4530')).toBe('4530');
    expect(formatAccountLabel('Axis Bank', 'XXXXXXXXXXX4530')).toBe('Axis Bank 4530');
  });
});
