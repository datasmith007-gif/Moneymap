/**
 * The label vocabulary (feature §2.1) — a closed set, defined once.
 *
 * Flat leaves rather than a tree. A tree reads well in a spec and fights you
 * everywhere else: a transaction belongs to exactly one leaf, every breakdown is
 * a group-by over leaves, and the grouping the spec describes (Essentials /
 * Lifestyle / …) is a *display* concern that `group` carries as an attribute.
 * Nesting the identifiers instead would push that display decision into every
 * key, every chart, and every rule.
 *
 * The set is closed on purpose. User-defined labels (§2.2) are deferred with the
 * persistence work — a label that cannot outlive the session is not a label a
 * user would invest in creating.
 */

export type CategoryId =
  // Income
  | 'salary'
  | 'interest'
  | 'refund'
  | 'dividend'
  | 'other_income'
  // Essentials
  | 'rent_home'
  | 'groceries'
  | 'utilities'
  | 'transport'
  | 'health'
  | 'insurance'
  | 'emi_loan'
  // Lifestyle
  | 'food_dining'
  | 'shopping'
  | 'entertainment'
  | 'travel'
  | 'subscriptions'
  // Money movement
  | 'self_transfer'
  | 'investments'
  | 'credit_card_payment'
  | 'cash_withdrawal'
  | 'friends_family'
  // Other
  | 'fees_charges'
  | 'unclassified';

export type CategoryGroup = 'income' | 'essentials' | 'lifestyle' | 'money_movement' | 'other';

export interface Category {
  readonly id: CategoryId;
  /** Display name. The one place a category's wording is decided. */
  readonly label: string;
  readonly group: CategoryGroup;
  /**
   * Which direction of movement this label can describe.
   *
   * A precision device, not decoration: without it a rule matching `SALARY`
   * fires just as happily on a debit row whose narration happens to mention a
   * salary account, and the dashboard gains phantom income. Rules are filtered
   * by this before they are allowed to match.
   */
  readonly applies: 'credit' | 'debit' | 'both';
}

const LIST: readonly Category[] = [
  { id: 'salary', label: 'Salary', group: 'income', applies: 'credit' },
  { id: 'interest', label: 'Interest', group: 'income', applies: 'credit' },
  { id: 'refund', label: 'Refund', group: 'income', applies: 'credit' },
  { id: 'dividend', label: 'Dividend', group: 'income', applies: 'credit' },
  { id: 'other_income', label: 'Other income', group: 'income', applies: 'credit' },

  { id: 'rent_home', label: 'Rent & home', group: 'essentials', applies: 'debit' },
  { id: 'groceries', label: 'Groceries', group: 'essentials', applies: 'debit' },
  { id: 'utilities', label: 'Utilities & bills', group: 'essentials', applies: 'debit' },
  { id: 'transport', label: 'Transport', group: 'essentials', applies: 'debit' },
  { id: 'health', label: 'Health', group: 'essentials', applies: 'debit' },
  { id: 'insurance', label: 'Insurance', group: 'essentials', applies: 'debit' },
  { id: 'emi_loan', label: 'EMI & loans', group: 'essentials', applies: 'debit' },

  { id: 'food_dining', label: 'Food & dining', group: 'lifestyle', applies: 'debit' },
  { id: 'shopping', label: 'Shopping', group: 'lifestyle', applies: 'debit' },
  { id: 'entertainment', label: 'Entertainment', group: 'lifestyle', applies: 'debit' },
  { id: 'travel', label: 'Travel', group: 'lifestyle', applies: 'debit' },
  { id: 'subscriptions', label: 'Subscriptions', group: 'lifestyle', applies: 'debit' },

  // Both directions: a self-transfer has two legs, an investment can be
  // redeemed, a card payment can be refunded, cash can be deposited back.
  { id: 'self_transfer', label: 'Self-transfer', group: 'money_movement', applies: 'both' },
  { id: 'investments', label: 'Investments', group: 'money_movement', applies: 'both' },
  {
    id: 'credit_card_payment',
    label: 'Credit card payment',
    group: 'money_movement',
    applies: 'both',
  },
  { id: 'cash_withdrawal', label: 'Cash withdrawal', group: 'money_movement', applies: 'both' },
  { id: 'friends_family', label: 'Friends & family', group: 'money_movement', applies: 'both' },

  { id: 'fees_charges', label: 'Fees & charges', group: 'other', applies: 'debit' },
  { id: 'unclassified', label: 'Unclassified', group: 'other', applies: 'both' },
];

const BY_ID = new Map<CategoryId, Category>(LIST.map((category) => [category.id, category]));

/** Every category, in display order (income first, `unclassified` last). */
export const CATEGORIES: readonly Category[] = LIST;

export function categoryOf(id: CategoryId): Category {
  const category = BY_ID.get(id);
  // A CategoryId that isn't in the list means the union and the table have
  // drifted apart — a bug, not a runtime condition worth handling gracefully.
  if (category === undefined) throw new Error(`Unknown category: ${id}`);
  return category;
}

export function categoryLabel(id: CategoryId): string {
  return categoryOf(id).label;
}

/** True when a label can describe a movement in this direction. */
export function categoryApplies(id: CategoryId, type: 'credit' | 'debit'): boolean {
  const { applies } = categoryOf(id);
  return applies === 'both' || applies === type;
}

/**
 * Categories excluded from income and spend.
 *
 * A transfer between the user's own accounts is not income and not spend — it is
 * the same rupee appearing twice. Counting it inflates both sides of the
 * dashboard by the transferred amount. This is the single correction that
 * retires the engine's standing self-transfer caveat.
 */
export function isFlowNeutral(id: CategoryId): boolean {
  return id === 'self_transfer';
}
