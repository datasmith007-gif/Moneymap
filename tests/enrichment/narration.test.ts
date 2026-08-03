import { describe, expect, it } from 'vitest';
import {
  compact,
  containsPattern,
  equalsPattern,
  normalise,
  startsWithPattern,
  tokens,
} from '../../src/enrichment/narration.ts';

describe('normalise', () => {
  it('uppercases and turns every delimiter run into one space', () => {
    expect(normalise('UPI/swiggy--9876@ybl/PAY')).toBe('UPI SWIGGY 9876 YBL PAY');
  });

  it('trims and collapses, so leading and trailing punctuation leave no blanks', () => {
    expect(normalise('  /NEFT-  ')).toBe('NEFT');
    expect(normalise('')).toBe('');
  });
});

describe('compact', () => {
  it('removes the spaces normalise introduced', () => {
    expect(compact('CULT.FIT')).toBe('CULTFIT');
  });
});

describe('containsPattern — token tier', () => {
  it('matches a whole token sequence regardless of the delimiters around it', () => {
    expect(containsPattern('UPI/SWIGGY/9876/PAY', 'SWIGGY')).toBe('token');
    expect(containsPattern('POS 1234 CULT.FIT BLR', 'CULT FIT')).toBe('token');
  });

  it('does NOT match a short pattern hiding inside a longer word', () => {
    // The case that makes this whole tier worth having: filing a bank charge on
    // a current account as housing would be silently wrong.
    expect(containsPattern('CURRENT ACCOUNT CHARGES', 'RENT')).toBeNull();
    expect(containsPattern('HOUSE RENT AUG', 'RENT')).toBe('token');
  });

  it('rejects an empty pattern rather than matching everything', () => {
    expect(containsPattern('ANYTHING', '')).toBeNull();
    expect(containsPattern('ANYTHING', '///')).toBeNull();
  });
});

describe('containsPattern — infix tier', () => {
  it('finds a long pattern inside a concatenated merchant string', () => {
    expect(containsPattern('UPI SWIGGYINSTAMART BLR', 'SWIGGY')).toBe('infix');
  });

  it('refuses the infix fallback below the minimum length', () => {
    // 'SIP' is 3 characters; allowing it to match inside words would file
    // 'GOSSIP' as an investment.
    expect(containsPattern('GOSSIP MERCHANT', 'SIP')).toBeNull();
  });

  it('prefers the token tier when both would match', () => {
    expect(containsPattern('UPI SWIGGY 123', 'SWIGGY')).toBe('token');
  });
});

describe('startsWithPattern', () => {
  it('matches only on a token boundary at the start', () => {
    expect(startsWithPattern('NEFT-HDFC0001234-S IYER', 'NEFT')).toBe('token');
    expect(startsWithPattern('XNEFT TRANSFER', 'NEFT')).toBeNull();
  });

  it('matches a narration that is exactly the pattern', () => {
    expect(startsWithPattern('NEFT', 'NEFT')).toBe('token');
  });

  it('does not match the pattern in the middle', () => {
    expect(startsWithPattern('UPI/NEFT/123', 'NEFT')).toBeNull();
  });
});

describe('equalsPattern', () => {
  it('ignores case and punctuation but nothing else', () => {
    expect(equalsPattern('atm-wdl', 'ATM WDL')).toBe('token');
    expect(equalsPattern('ATM WDL 1234', 'ATM WDL')).toBeNull();
  });
});

describe('tokens', () => {
  it('splits normalised narration, and returns nothing for an empty string', () => {
    expect(tokens('UPI/RAHUL SHARMA/98')).toEqual(['UPI', 'RAHUL', 'SHARMA', '98']);
    expect(tokens('///')).toEqual([]);
  });
});
