import { extractStatement, type ExtractOptions } from './extract.ts';
import { ParserRegistry } from './registry.ts';
import { AxisParser } from './parsers/axis.ts';
import { IciciParser } from './parsers/icici.ts';
import type { ParseContext } from './parser.ts';
import type { ParseOutcome } from './outcome.ts';

/**
 * The one public entry point of the ingestion feature (§1.1 module promise):
 * give it PDF bytes, get back canonical entities or a clear reason it couldn't
 * parse. It composes the two hidden stages — extraction (pdf.js → positional IR,
 * owning the encrypted/scanned/corrupt outcomes) and the registry (bank
 * selection → parse, owning the unsupported/parsed/needs_review outcomes). No
 * caller ever touches pdf.js, a bank format, or the registry directly.
 */

/** Build a registry with every shipped parser registered. Adding a bank is one
 *  line here — no other change in the codebase (the registry design in action). */
export function createDefaultRegistry(): ParserRegistry {
  return new ParserRegistry().register(new AxisParser()).register(new IciciParser());
}

export interface ParseStatementOptions extends ExtractOptions {
  /** Identifies this import; flows into provenance and entity ids. */
  readonly statementId: string;
  /** ISO 8601 import time for `Account.lastUpdated`. Defaults to now; inject a
   *  fixed value in tests for deterministic output. */
  readonly importedAt?: string;
  /** Override the parser set (tests / future user-configurable banks). */
  readonly registry?: ParserRegistry;
}

export async function parseStatement(
  bytes: Uint8Array,
  options: ParseStatementOptions,
): Promise<ParseOutcome> {
  const extraction = await extractStatement(bytes, options);
  if (extraction.kind !== 'document') {
    // encrypted / unreadable — already actionable ParseOutcomes.
    return extraction;
  }

  const registry = options.registry ?? createDefaultRegistry();
  const ctx: ParseContext = {
    statementId: options.statementId,
    importedAt: options.importedAt ?? new Date().toISOString(),
  };
  return registry.dispatch(extraction.document, ctx);
}
