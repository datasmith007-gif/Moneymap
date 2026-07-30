import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

/**
 * Points pdf.js at its worker bundle so parsing runs off the main thread and the
 * UI stays responsive on a 30-page statement.
 *
 * Why this is a separate file from `extract.ts` — which is otherwise the only
 * module that touches pdf.js: the `?url` import is a Vite bundler feature, and
 * `extract.ts` is imported by the Node test suite, which has no bundler. Keeping
 * the browser-only wiring here lets the browser entry point opt in (`main.tsx`)
 * while tests import `extract.ts` untouched and run pdf.js on the main thread,
 * which is fine for a test process.
 *
 * The worker is bundled with the app and served from our own origin — it is not
 * fetched from a CDN, so no part of a statement, and no request that could reveal
 * one is being opened, ever leaves the device.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
