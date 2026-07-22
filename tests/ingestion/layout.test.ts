import { describe, it, expect } from 'vitest';
import { documentLines } from '../../src/ingestion/layout.ts';
import type { StatementDocument } from '../../src/ingestion/document.ts';

const doc: StatementDocument = {
  pages: [
    {
      pageNumber: 1,
      width: 595,
      height: 842,
      words: [
        // Two words on one line, given out of x-order.
        { text: 'world', x: 120, y: 100, width: 30, height: 8 },
        { text: 'hello', x: 40, y: 101, width: 30, height: 8 },
        // A second line further down.
        { text: 'next', x: 40, y: 140, width: 20, height: 8 },
      ],
    },
    {
      pageNumber: 2,
      width: 595,
      height: 842,
      words: [{ text: 'page2', x: 40, y: 50, width: 30, height: 8 }],
    },
  ],
};

describe('documentLines', () => {
  const lines = documentLines(doc);

  it('groups words within the y-tolerance into one line, sorted left to right', () => {
    expect(lines[0]!.words.map((w) => w.text)).toEqual(['hello', 'world']);
  });

  it('separates words beyond the tolerance into different lines', () => {
    expect(lines[1]!.words.map((w) => w.text)).toEqual(['next']);
  });

  it('returns lines in reading order across pages', () => {
    expect(lines.map((l) => l.page)).toEqual([1, 1, 2]);
    expect(lines.at(-1)!.words[0]!.text).toBe('page2');
  });
});
