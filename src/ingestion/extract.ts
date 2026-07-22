import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Page, PositionedWord, StatementDocument } from './document.ts';
import type { EncryptedOutcome, UnreadableOutcome } from './outcome.ts';

/**
 * Text extraction — the only module that knows about pdf.js. It turns raw PDF
 * bytes into the positional `StatementDocument` every parser consumes, or into
 * one of the "can't get text" outcomes (`encrypted` / `unreadable`). Because this
 * boundary exists, swapping the PDF engine or configuring a browser worker later
 * touches nothing but this file.
 *
 * We use the `legacy` build deliberately: it runs unchanged both in the browser
 * and under Node/Vitest (against real fixtures), so tests exercise the same code
 * path the app does. A browser-optimised worker can be wired in here later
 * without changing the interface.
 */

/** Upload guard — reject oversized files before decoding them. */
const MAX_BYTES = 25 * 1024 * 1024;

export type ExtractionResult =
  | { readonly kind: 'document'; readonly document: StatementDocument }
  | EncryptedOutcome
  | UnreadableOutcome;

export interface ExtractOptions {
  /** Password for a protected PDF. Used only to decrypt in memory here; never
   *  stored or logged (feature §1.5 / non-negotiable constraint). */
  readonly password?: string;
}

export async function extractStatement(
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  if (bytes.byteLength === 0) {
    return { kind: 'unreadable', reason: 'empty', message: 'This file is empty.' };
  }
  if (bytes.byteLength > MAX_BYTES) {
    return {
      kind: 'unreadable',
      reason: 'too_large',
      message: 'This file is larger than 25 MB. Please upload a standard statement PDF.',
    };
  }

  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      // pdf.js may detach the buffer it is given; hand it a private copy so the
      // caller's bytes are never mutated out from under them.
      data: new Uint8Array(bytes),
      ...(options.password !== undefined ? { password: options.password } : {}),
    }).promise;
  } catch (err) {
    if ((err as { name?: string }).name === 'PasswordException') {
      return {
        kind: 'encrypted',
        message: 'This PDF is password-protected. Enter its password to import it.',
      };
    }
    return {
      kind: 'unreadable',
      reason: 'corrupt',
      message: "This file couldn't be read as a PDF. It may be corrupt or not a PDF.",
    };
  }

  if (pdf.numPages === 0) {
    return { kind: 'unreadable', reason: 'empty', message: 'This PDF has no pages.' };
  }

  const pages: Page[] = [];
  let totalWords = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words: PositionedWord[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue; // skip marked-content markers, keep text items
      if (item.str.trim() === '') continue;
      // transform = [a, b, c, d, e, f]; e/f are the x / baseline-y in PDF space
      // (origin bottom-left, y up). Convert f to a top-left, y-down top edge.
      const x = item.transform[4];
      const baselineY = item.transform[5];
      words.push({
        text: item.str,
        x,
        y: viewport.height - baselineY - item.height,
        width: item.width,
        height: item.height,
      });
    }
    totalWords += words.length;
    pages.push({ pageNumber: n, width: viewport.width, height: viewport.height, words });
  }

  // No text anywhere = a scanned/image PDF. Out of scope for V1 (planning §3.3):
  // decline clearly rather than pretend. OCR is a possible later addition.
  if (totalWords === 0) {
    return {
      kind: 'unreadable',
      reason: 'no_text_layer',
      message:
        'This looks like a scanned image, not a text PDF. Please upload the text ' +
        'statement downloaded from your bank, or a CSV.',
    };
  }

  return { kind: 'document', document: { pages } };
}
