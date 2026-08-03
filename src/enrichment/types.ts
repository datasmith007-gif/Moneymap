import type { CategoryId } from './taxonomy.ts';

/**
 * The vocabulary of the enrichment layer: what a rule is, and what classifying a
 * transaction produces.
 *
 * The type that matters here is `Classification`, and the important thing about
 * it is what it is *not*: it is not a field on `Transaction`. Classification sits
 * beside the canonical record, keyed by transaction id, for two reasons the
 * project constraints state directly — user overrides are stored separately so a
 * re-import never loses a manual edit, and source data is never rewritten. A
 * rule edit re-runs `classify` over unchanged rows; nothing in the store is
 * mutated, so there is no migration and no lost edit.
 */

/**
 * How a transaction came by its label. Ordered from most to least authoritative,
 * which is also the order `classify` tries them in.
 *
 * Kept as a distinct field rather than folded into a confidence number because
 * the Review and Rules screens need to say *why*: "you filed this", "your rule
 * #3 filed this", "we guessed". A single score cannot carry that.
 */
export type ClassificationSource =
  /** The user labelled this exact transaction. */
  | 'user'
  /** A rule the user wrote matched. */
  | 'user_rule'
  /** A rule shipped with the app matched. */
  | 'shipped_rule'
  /** Paired with a matching leg on another of the user's accounts. */
  | 'transfer'
  /** Nothing matched with enough confidence. Category is `unclassified`. */
  | 'none';

/** Below this, a guess is not worth showing as a label (mirrors the parser
 *  registry's threshold, and for the same reason: a wrong confident answer costs
 *  more than an honest "don't know"). */
export const CONFIDENCE_THRESHOLD = 0.5;

export interface Classification {
  readonly transactionId: string;
  /** `'unclassified'` whenever confidence fell below the threshold. */
  readonly category: CategoryId;
  /** 0..1. Exactly 1 for user labels and for detected transfer pairs. */
  readonly confidence: number;
  readonly source: ClassificationSource;
  /** The rule that fired, for "rule #3 filed 142 of these" on the Rules screen. */
  readonly ruleId: string | null;
  /** Best guess at who the money moved to or from, extracted from the narration. */
  readonly counterparty: string | null;
  /**
   * True exactly when `category === 'self_transfer'`.
   *
   * Duplicated deliberately: the engine asks this question on every row and must
   * not need the taxonomy to answer it, and the invariant is cheap to hold in
   * the one function that constructs these.
   */
  readonly isInternalTransfer: boolean;
  /** The id of the matching leg on the other account, when one was found. Null
   *  for a self-transfer the user asserted manually. */
  readonly transferPeerId: string | null;
}

export type RuleOperator = 'contains' | 'starts_with' | 'exact';

/**
 * One classification rule (feature §2.2, and the mock's Rules screen).
 *
 * `patterns` are OR-ed within a rule — one row on the Rules screen holds the
 * whole keyword list for a category, which is how a user thinks about it
 * ("Swiggy, Zomato and EatClub are all food"). AND across patterns has no
 * plausible use on bank narration, where a row names one merchant.
 */
export interface Rule {
  readonly id: string;
  /**
   * Evaluation position; lowest first, first match wins.
   *
   * Not an array index — rules are reorderable and deletable, and an index would
   * renumber every rule below the one that moved.
   */
  readonly order: number;
  readonly operator: RuleOperator;
  readonly patterns: readonly string[];
  readonly category: CategoryId;
  readonly origin: 'user' | 'shipped';
}
