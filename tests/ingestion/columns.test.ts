import { describe, it, expect } from 'vitest';
import {
  centreX,
  headerX,
  hasLabels,
  splitColumns,
  joinText,
  firstParsed,
} from '../../src/ingestion/columns.ts';
import type { PositionedWord } from '../../src/ingestion/document.ts';
import type { Line } from '../../src/ingestion/layout.ts';
import { parseDmyDate, parseIndianAmount } from '../../src/ingestion/fields.ts';

function word(text: string, x: number, width = text.length * 6): PositionedWord {
  return { text, x, y: 100, width, height: 8 };
}
function line(words: PositionedWord[]): Line {
  return { page: 1, y: 100, words: [...words].sort((a, b) => a.x - b.x) };
}

describe('centreX', () => {
  it('is the horizontal midpoint of the token', () => {
    expect(centreX(word('x', 10, 20))).toBe(20);
  });
});

describe('headerX', () => {
  const header = line([word('DATE', 27), word('DEPOSITS', 387), word('BALANCE', 545)]);

  it('returns the left-x of the first token matching the prefix, case-insensitively', () => {
    expect(headerX(header, 'deposits')).toBe(387);
    expect(headerX(header, 'BAL')).toBe(545);
  });

  it('returns null when no token matches', () => {
    expect(headerX(header, 'WITHDRAWALS')).toBeNull();
  });
});

describe('hasLabels', () => {
  const header = line([word('Particulars', 10), word('Debit', 100), word('Balance', 200)]);

  it('is true only when every label is present, case-insensitively', () => {
    expect(hasLabels(header, ['PARTICULARS', 'BALANCE', 'DEBIT'])).toBe(true);
  });

  it('is false when any label is missing', () => {
    expect(hasLabels(header, ['PARTICULARS', 'CREDIT'])).toBe(false);
  });
});

describe('splitColumns', () => {
  it('buckets words into named regions by centre-x', () => {
    // boundaries [50, 100]; three regions: left (<50), mid ([50,100)), right (>=100)
    const row = line([
      word('a', 10, 10), // centre 15 -> left
      word('b', 60, 10), // centre 65 -> mid
      word('c', 120, 10), // centre 125 -> right
    ]);
    const cols = splitColumns(row, [50, 100], ['left', 'mid', 'right']);
    expect(cols.left!.map((w) => w.text)).toEqual(['a']);
    expect(cols.mid!.map((w) => w.text)).toEqual(['b']);
    expect(cols.right!.map((w) => w.text)).toEqual(['c']);
  });

  it('places a word whose centre equals a boundary in the region to its right', () => {
    const row = line([word('edge', 45, 10)]); // centre exactly 50
    const cols = splitColumns(row, [50, 100], ['left', 'mid', 'right']);
    expect(cols.left).toEqual([]);
    expect(cols.mid!.map((w) => w.text)).toEqual(['edge']);
  });

  it('throws when names do not cover all regions (boundaries + 1)', () => {
    expect(() => splitColumns(line([]), [50, 100], ['a', 'b'])).toThrow(/names/);
  });
});

describe('joinText', () => {
  it('joins words left-to-right with single spaces', () => {
    expect(joinText([word('UPI', 0), word('PAYMENT', 30)])).toBe('UPI PAYMENT');
  });
});

describe('firstParsed', () => {
  it('returns the first token the parser reads as non-null', () => {
    const words = [word('MODE', 0), word('12-08-2025', 30)];
    expect(firstParsed(words, parseDmyDate)).toBe('2025-08-12');
  });

  it('returns null when no token parses', () => {
    expect(firstParsed([word('NARRATION', 0)], parseIndianAmount)).toBeNull();
  });
});
