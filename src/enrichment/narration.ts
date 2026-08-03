/**
 * Reading bank narration — the shared text knowledge of the enrichment layer.
 *
 * Both rule matching and counterparty extraction have to answer "what does this
 * string actually say", and if they answered it differently a rule could match a
 * merchant the counterparty extractor then failed to name. One module owns it.
 *
 * Indian bank narration is delimiter-heavy and inconsistent between banks and
 * between rails: `UPI/SWIGGY/9876543210/PAY`, `NEFT-HDFC0001234-S IYER`,
 * `ATM-WDL-1234 ANDHERI`, `MMT/IMPS/512345/RAHUL`. Treating those delimiters as
 * whitespace turns all of them into the same thing — a list of tokens — which is
 * the only form worth matching against.
 */

/** Uppercase, every non-alphanumeric run collapsed to one space, trimmed. */
export function normalise(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Normalised with the spaces removed, for the concatenated-merchant fallback. */
export function compact(text: string): string {
  return normalise(text).replace(/ /g, '');
}

/**
 * The shortest pattern allowed to match inside a longer word.
 *
 * Below this, the fallback does more harm than good: `RENT` would match
 * `CURRENT ACCOUNT` and quietly file a bank charge as housing. Six characters is
 * where real merchant names start (`SWIGGY`, `ZOMATO`, `AMAZON`) and where an
 * accidental collision with an English word inside narration becomes unlikely.
 */
const MIN_INFIX_LENGTH = 6;

/** How well a pattern matched, or `null` for no match. */
export type MatchStrength = 'token' | 'infix';

/**
 * Does `narration` contain `pattern`?
 *
 * Two tiers, because banks write merchant names both ways:
 *
 *  - **`token`** — the pattern appears as a whole token sequence. `SWIGGY`
 *    matches `UPI SWIGGY 9876` but not `SWIGGYINSTAMART`, and `RENT` matches
 *    `HOUSE RENT AUG` but never `CURRENT ACCOUNT`. This is the confident case.
 *  - **`infix`** — the pattern appears inside a longer run of characters
 *    (`SWIGGY` in `SWIGGYINSTAMART`). Real, and common enough that dropping it
 *    would lose genuine matches — but it is the tier that produces false
 *    positives, so it is gated on `MIN_INFIX_LENGTH` and reported as the weaker
 *    strength, which the caller turns into a lower confidence and a visible dot
 *    in the review queue.
 */
export function containsPattern(narration: string, pattern: string): MatchStrength | null {
  const needle = normalise(pattern);
  if (needle === '') return null;

  // Padding both sides turns "includes" into whole-token-sequence matching with
  // no regex and no escaping of whatever punctuation a pattern happens to carry.
  if (` ${normalise(narration)} `.includes(` ${needle} `)) return 'token';

  const needleCompact = compact(pattern);
  if (needleCompact.length >= MIN_INFIX_LENGTH && compact(narration).includes(needleCompact)) {
    return 'infix';
  }
  return null;
}

/** Does `narration` begin with `pattern`, on a token boundary? */
export function startsWithPattern(narration: string, pattern: string): MatchStrength | null {
  const needle = normalise(pattern);
  if (needle === '') return null;
  const haystack = normalise(narration);
  if (haystack === needle) return 'token';
  return haystack.startsWith(`${needle} `) ? 'token' : null;
}

/** Is `narration` exactly `pattern`, ignoring case and punctuation? */
export function equalsPattern(narration: string, pattern: string): MatchStrength | null {
  const needle = normalise(pattern);
  if (needle === '') return null;
  return normalise(narration) === needle ? 'token' : null;
}

/** Narration split into tokens — what counterparty extraction walks. */
export function tokens(text: string): readonly string[] {
  const normalised = normalise(text);
  return normalised === '' ? [] : normalised.split(' ');
}
