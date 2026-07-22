import { describe, it, expect } from 'vitest';
import { extractStatement } from '../../src/ingestion/extract.ts';

describe('extractStatement failure paths', () => {
  it('reports an empty file as unreadable/empty', async () => {
    const result = await extractStatement(new Uint8Array(0));
    expect(result.kind).toBe('unreadable');
    if (result.kind === 'unreadable') expect(result.reason).toBe('empty');
  });

  it('reports non-PDF bytes as unreadable/corrupt', async () => {
    const result = await extractStatement(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result.kind).toBe('unreadable');
    if (result.kind === 'unreadable') expect(result.reason).toBe('corrupt');
  });

  it('rejects oversized files before decoding', async () => {
    // A sparse 26 MB buffer trips the size guard without any PDF work.
    const result = await extractStatement(new Uint8Array(26 * 1024 * 1024));
    expect(result.kind).toBe('unreadable');
    if (result.kind === 'unreadable') expect(result.reason).toBe('too_large');
  });
});
