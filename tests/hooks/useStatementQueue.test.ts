// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseOutcome } from '../../src/ingestion/outcome.ts';
import { statement } from '../fixtures/canonical.ts';

/**
 * The batch import queue.
 *
 * `parseStatement` is mocked, not exercised: this file is about *sequencing* —
 * what order files are processed in, what is written and when, what is parked
 * and what is dropped. The parser itself has its own suite, and driving pdf.js
 * from here would test it a second time while making the sequencing impossible
 * to control.
 */

/** Outcomes keyed by file name, so a case can describe a mixed batch. */
const outcomes = new Map<string, ParseOutcome | 'throw'>();
/** Every `parseStatement` call that has started but not finished — the evidence
 *  for the "never overlapping" assertions. */
let inFlight = 0;
let maxInFlight = 0;
let parseOrder: string[] = [];
/** Passwords accepted by a locked file, keyed by file name. */
const passwords = new Map<string, string>();

vi.mock('../../src/ingestion/parseStatement.ts', () => ({
  parseStatement: vi.fn(async (bytes: Uint8Array, opts: { password?: string }) => {
    const name = new TextDecoder().decode(bytes);
    parseOrder.push(name);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield, so overlapping calls would actually overlap and be observed.
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;

    const required = passwords.get(name);
    if (required !== undefined && opts.password !== required) {
      return { kind: 'encrypted', message: 'This statement is password-protected.' } as ParseOutcome;
    }
    const outcome = outcomes.get(name);
    if (outcome === undefined) throw new Error(`no outcome configured for ${name}`);
    if (outcome === 'throw') throw new Error('boom');
    return outcome;
  }),
}));

// Imported after `vi.mock` is registered, so the hook picks up the mocked parser.
const { useStatementQueue } = await import('../../src/hooks/useStatementQueue.ts');
const { useSessionStore } = await import('../../src/hooks/useSessionStore.ts');

/** A `File` whose bytes are just its own name, so the mock can identify it. */
function file(name: string): File {
  return new File([new TextEncoder().encode(name)], name, { type: 'application/pdf' });
}

function parsed(over: Parameters<typeof statement>[0] = {}): ParseOutcome {
  return { kind: 'parsed', statement: statement(over) };
}

function flagged(issues: string[], over: Parameters<typeof statement>[0] = {}): ParseOutcome {
  return { kind: 'needs_review', statement: statement(over), issues };
}

/** A format nothing in the registry recognised. */
function unsupported(): ParseOutcome {
  return {
    kind: 'unsupported',
    message: 'No parser recognised this layout.',
    fingerprint: { bankGuess: null, signature: 'test' },
  };
}

/** The queue wired to a real session store — the write path is the thing under
 *  test, so it is not mocked. */
function setup() {
  return renderHook(() => {
    const session = useSessionStore();
    return { session, queue: useStatementQueue(session) };
  });
}

beforeEach(() => {
  outcomes.clear();
  passwords.clear();
  parseOrder = [];
  inFlight = 0;
  maxInFlight = 0;
});

describe('processing a batch', () => {
  it('parses files one at a time, never concurrently', async () => {
    // The money-critical property. Overlapping writes race on "is this row
    // already here?", which would make the new/duplicate split nondeterministic.
    for (const name of ['a', 'b', 'c', 'd']) {
      outcomes.set(name, parsed({ periodStart: `2025-0${name === 'a' ? 1 : 2}-01` }));
    }

    const { result } = setup();
    act(() => result.current.queue.addFiles(['a', 'b', 'c', 'd'].map(file)));

    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    expect(maxInFlight).toBe(1);
  });

  it('processes files in the order they were dropped', async () => {
    for (const name of ['first', 'second', 'third']) outcomes.set(name, unsupported());

    const { result } = setup();
    act(() => result.current.queue.addFiles(['first', 'second', 'third'].map(file)));

    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    expect(parseOrder).toEqual(['first', 'second', 'third']);
  });

  it('records every reconciled statement without being asked', async () => {
    outcomes.set('jan', parsed({ periodStart: '2025-01-01', periodEnd: '2025-01-31' }));
    outcomes.set('feb', parsed({ periodStart: '2025-02-01', periodEnd: '2025-02-28' }));

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('jan'), file('feb')]));

    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    await waitFor(() => expect(result.current.session.imports).toHaveLength(2));
    expect(result.current.queue.items.every((item) => item.status === 'done')).toBe(true);
  });

  it('records a statement exactly once, however many times it re-renders', async () => {
    outcomes.set('a', parsed());
    const { result, rerender } = setup();
    act(() => result.current.queue.addFiles([file('a')]));

    await waitFor(() => expect(result.current.session.imports).toHaveLength(1));
    rerender();
    rerender();
    expect(result.current.session.imports).toHaveLength(1);
  });

  it('reports a re-dropped statement as a duplicate rather than adding it twice', async () => {
    outcomes.set('same', parsed());
    const { result } = setup();

    act(() => result.current.queue.addFiles([file('same'), file('same')]));
    await waitFor(() => expect(result.current.queue.busy).toBe(false));

    const summaries = result.current.queue.items.map((item) => item.summary?.kind);
    expect(summaries).toEqual(['imported', 'duplicate_statement']);
    expect(result.current.session.imports).toHaveLength(1);
  });

  it('keeps going after a file throws, and records the rest', async () => {
    outcomes.set('ok1', parsed({ periodStart: '2025-01-01', periodEnd: '2025-01-31' }));
    outcomes.set('bad', 'throw');
    outcomes.set('ok2', parsed({ periodStart: '2025-02-01', periodEnd: '2025-02-28' }));

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('ok1'), file('bad'), file('ok2')]));

    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    expect(result.current.queue.items.map((item) => item.status)).toEqual([
      'done',
      'rejected',
      'done',
    ]);
    // The failure is surfaced, and never carries file content.
    expect(result.current.queue.items[1]?.message).toBe('boom');
    await waitFor(() => expect(result.current.session.imports).toHaveLength(2));
  });
});

describe('locked files', () => {
  it('parks an encrypted file instead of blocking the batch behind it', async () => {
    passwords.set('locked', 'hunter2');
    outcomes.set('locked', parsed({ periodStart: '2025-03-01', periodEnd: '2025-03-31' }));
    outcomes.set('open', parsed({ periodStart: '2025-01-01', periodEnd: '2025-01-31' }));

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('locked'), file('open')]));

    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    expect(result.current.queue.items.map((item) => item.status)).toEqual(['locked', 'done']);
    // The unlocked one is already in the store — the batch did not stall.
    await waitFor(() => expect(result.current.session.imports).toHaveLength(1));
  });

  it('opens every file sharing one password', async () => {
    // The reason there is one field rather than a prompt per file: statements
    // from one bank usually share a password.
    for (const name of ['s1', 's2']) {
      passwords.set(name, 'pan1234');
      outcomes.set(name, parsed({ periodStart: `2025-0${name === 's1' ? 1 : 2}-01` }));
    }

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('s1'), file('s2')]));
    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    expect(result.current.queue.items.every((item) => item.status === 'locked')).toBe(true);

    await act(async () => {
      await result.current.queue.unlockAll('pan1234');
    });

    expect(result.current.queue.items.every((item) => item.status === 'done')).toBe(true);
    await waitFor(() => expect(result.current.session.imports).toHaveLength(2));
  });

  it('leaves a file locked when the password does not open it', async () => {
    passwords.set('a', 'right');
    outcomes.set('a', parsed());

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('a')]));
    await waitFor(() => expect(result.current.queue.busy).toBe(false));

    await act(async () => {
      await result.current.queue.unlockAll('wrong');
    });

    expect(result.current.queue.items[0]?.status).toBe('locked');
    expect(result.current.session.imports).toHaveLength(0);
  });
});

describe('flagged statements', () => {
  it('does not record a flagged statement on its own', async () => {
    // Its figures failed a reconciliation check; feeding them into the net
    // position would break the dashboard's promise in the quietest possible way.
    outcomes.set('icici', flagged(['Other ledgers were not imported.']));

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('icici')]));

    await waitFor(() => expect(result.current.queue.busy).toBe(false));
    expect(result.current.queue.items[0]?.status).toBe('review');
    expect(result.current.session.imports).toHaveLength(0);
  });

  it('records one flagged statement when the user includes it, issues and all', async () => {
    outcomes.set('icici', flagged(['Other ledgers were not imported.']));

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('icici')]));
    await waitFor(() => expect(result.current.queue.busy).toBe(false));

    const id = result.current.queue.items[0]!.id;
    await act(async () => {
      await result.current.queue.include(id);
    });

    expect(result.current.queue.items[0]?.status).toBe('done');
    await waitFor(() => expect(result.current.session.imports).toHaveLength(1));
    // The issues have to survive to the record, or the dashboard cannot warn.
    expect(result.current.session.imports[0]?.issues).toEqual([
      'Other ledgers were not imported.',
    ]);
  });

  it('includes every flagged statement at once', async () => {
    outcomes.set('a', flagged(['x'], { periodStart: '2025-01-01', periodEnd: '2025-01-31' }));
    outcomes.set('b', flagged(['y'], { periodStart: '2025-02-01', periodEnd: '2025-02-28' }));

    const { result } = setup();
    act(() => result.current.queue.addFiles([file('a'), file('b')]));
    await waitFor(() => expect(result.current.queue.busy).toBe(false));

    await act(async () => {
      await result.current.queue.includeAll();
    });

    expect(result.current.queue.items.every((item) => item.status === 'done')).toBe(true);
    await waitFor(() => expect(result.current.session.imports).toHaveLength(2));
  });
});

describe('reset', () => {
  it('clears the queue without unrecording anything', async () => {
    outcomes.set('a', parsed());
    const { result } = setup();

    act(() => result.current.queue.addFiles([file('a')]));
    await waitFor(() => expect(result.current.session.imports).toHaveLength(1));

    act(() => result.current.queue.reset());

    expect(result.current.queue.items).toHaveLength(0);
    // The import survives — resetting the view is not undoing the work.
    expect(result.current.session.imports).toHaveLength(1);
  });
});
