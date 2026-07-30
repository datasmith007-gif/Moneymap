import { useCallback, useRef, useState } from 'react';
import { parseStatement } from '../ingestion/parseStatement.ts';
import type { ParseOutcome } from '../ingestion/outcome.ts';

/**
 * Drives one statement import: file in, `ParseOutcome` out, plus the two things a
 * component would otherwise have to know — how to turn a `File` into the bytes
 * the parser wants, and how to retry an encrypted PDF once the user supplies a
 * password (which requires holding on to the original bytes).
 *
 * Those bytes are held in a ref, not in state: they are raw financial content, so
 * they must never be persisted, logged, or put anywhere that could be serialised
 * into a React devtools snapshot. `reset` drops them. Nothing here writes to disk
 * or to storage — V1 keeps the whole import in memory by construction.
 */

export type ImportState =
  | { readonly status: 'idle' }
  | { readonly status: 'parsing'; readonly fileName: string }
  | { readonly status: 'done'; readonly fileName: string; readonly outcome: ParseOutcome }
  /** A genuine fault — a bug or an unreadable `File` handle. Expected parse
   *  failures are not errors; they arrive as `done` with a non-`parsed` outcome. */
  | { readonly status: 'failed'; readonly fileName: string; readonly message: string };

export interface StatementImport {
  readonly state: ImportState;
  /** Parse a newly chosen file, discarding any previous import. */
  readonly importFile: (file: File) => Promise<void>;
  /** Re-parse the file already loaded, now with a password. No-op if there is
   *  nothing loaded. The password is passed straight through and never retained. */
  readonly retryWithPassword: (password: string) => Promise<void>;
  readonly reset: () => void;
}

export function useStatementImport(): StatementImport {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const bytesRef = useRef<Uint8Array | null>(null);
  const fileNameRef = useRef<string>('');

  const run = useCallback(async (bytes: Uint8Array, fileName: string, password?: string) => {
    setState({ status: 'parsing', fileName });
    try {
      const outcome = await parseStatement(bytes, {
        statementId: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
        ...(password !== undefined && password !== '' ? { password } : {}),
      });
      setState({ status: 'done', fileName, outcome });
    } catch (err) {
      // Only unexpected faults land here — the parser returns its expected
      // failures as values. Surface the message, never the file's contents.
      setState({
        status: 'failed',
        fileName,
        message: err instanceof Error ? err.message : 'Unknown error while parsing.',
      });
    }
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      bytesRef.current = bytes;
      fileNameRef.current = file.name;
      await run(bytes, file.name);
    },
    [run],
  );

  const retryWithPassword = useCallback(
    async (password: string) => {
      const bytes = bytesRef.current;
      if (bytes === null) return;
      await run(bytes, fileNameRef.current, password);
    },
    [run],
  );

  const reset = useCallback(() => {
    bytesRef.current = null;
    fileNameRef.current = '';
    setState({ status: 'idle' });
  }, []);

  return { state, importFile, retryWithPassword, reset };
}
