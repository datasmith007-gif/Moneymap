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
  | 'business_income'
  | 'rental_income'
  | 'pension_benefits'
  | 'other_income'
  // Essentials
  | 'rent_home'
  | 'groceries'
  | 'utilities'
  | 'transport'
  | 'health'
  | 'insurance'
  | 'emi_loan'
  | 'education'
  | 'taxes'
  | 'childcare'
  | 'household_services'
  // Lifestyle
  | 'food_dining'
  | 'shopping'
  | 'entertainment'
  | 'travel'
  | 'subscriptions'
  | 'personal_care'
  | 'gifts_donations'
  | 'fitness_sports'
  | 'pets'
  // Money movement
  | 'self_transfer'
  | 'investments'
  | 'credit_card_payment'
  | 'cash_withdrawal'
  | 'friends_family'
  | 'money_lent'
  | 'borrowed_money'
  | 'loan_repayment_received'
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
  {
    id: 'business_income',
    label: 'Business & freelance income',
    group: 'income',
    applies: 'credit',
  },
  { id: 'rental_income', label: 'Rental income', group: 'income', applies: 'credit' },
  { id: 'pension_benefits', label: 'Pension & benefits', group: 'income', applies: 'credit' },
  { id: 'other_income', label: 'Other income', group: 'income', applies: 'credit' },

  { id: 'rent_home', label: 'Rent & home', group: 'essentials', applies: 'debit' },
  { id: 'groceries', label: 'Groceries', group: 'essentials', applies: 'debit' },
  { id: 'utilities', label: 'Utilities & bills', group: 'essentials', applies: 'debit' },
  { id: 'transport', label: 'Transport', group: 'essentials', applies: 'debit' },
  { id: 'health', label: 'Health', group: 'essentials', applies: 'debit' },
  { id: 'insurance', label: 'Insurance', group: 'essentials', applies: 'debit' },
  { id: 'emi_loan', label: 'EMI & loans', group: 'essentials', applies: 'debit' },
  { id: 'education', label: 'Education', group: 'essentials', applies: 'debit' },
  { id: 'taxes', label: 'Taxes', group: 'essentials', applies: 'debit' },
  {
    id: 'childcare',
    label: 'Childcare & dependants',
    group: 'essentials',
    applies: 'debit',
  },
  {
    id: 'household_services',
    label: 'Household services',
    group: 'essentials',
    applies: 'debit',
  },

  { id: 'food_dining', label: 'Food & dining', group: 'lifestyle', applies: 'debit' },
  { id: 'shopping', label: 'Shopping', group: 'lifestyle', applies: 'debit' },
  { id: 'entertainment', label: 'Entertainment', group: 'lifestyle', applies: 'debit' },
  { id: 'travel', label: 'Travel', group: 'lifestyle', applies: 'debit' },
  { id: 'subscriptions', label: 'Subscriptions', group: 'lifestyle', applies: 'debit' },
  { id: 'personal_care', label: 'Personal care', group: 'lifestyle', applies: 'debit' },
  { id: 'gifts_donations', label: 'Gifts & donations', group: 'lifestyle', applies: 'debit' },
  { id: 'fitness_sports', label: 'Fitness & sports', group: 'lifestyle', applies: 'debit' },
  { id: 'pets', label: 'Pets', group: 'lifestyle', applies: 'debit' },

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
  { id: 'money_lent', label: 'Money lent', group: 'money_movement', applies: 'debit' },
  {
    id: 'borrowed_money',
    label: 'Borrowed money',
    group: 'money_movement',
    applies: 'credit',
  },
  {
    id: 'loan_repayment_received',
    label: 'Loan repayment received',
    group: 'money_movement',
    applies: 'credit',
  },

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
 * Transfers and loan-principal movements change where money is held or create
 * an asset or liability; they are not earned income or consumed spending. EMI
 * stays in spending because a bank row does not split principal from interest.
 */
export function isFlowNeutral(id: CategoryId): boolean {
  return (
    id === 'self_transfer' ||
    id === 'money_lent' ||
    id === 'borrowed_money' ||
    id === 'loan_repayment_received'
  );
}
