import { categoryApplies } from './taxonomy.ts';
import type { TransactionType } from '../model/canonical.ts';
import type { Rule } from './types.ts';
import {
  containsPattern,
  equalsPattern,
  startsWithPattern,
  type MatchStrength,
} from './narration.ts';

/**
 * Rule matching, and the rules that ship with the app.
 *
 * The merchant dictionary that feature §2.1 describes as a separate layer *is*
 * this rule set. Two mechanisms would mean two matchers, two orderings and two
 * places to look when a transaction lands in the wrong category, to express one
 * idea: "this narration means that category". A shipped rule and a user rule
 * differ only in `origin`, which is what decides precedence and what the Rules
 * screen prints in its "Made by" column.
 */

export interface RuleMatch {
  readonly rule: Rule;
  readonly strength: MatchStrength;
}

/**
 * Does this rule match, and how strongly?
 *
 * Direction is checked before text: a rule for `SALARY` must not fire on a debit
 * whose narration happens to name a salary account, or the dashboard grows
 * income that never arrived.
 */
export function matchRule(
  rule: Rule,
  narration: string,
  type: TransactionType,
): MatchStrength | null {
  if (!categoryApplies(rule.category, type)) return null;

  const test =
    rule.operator === 'contains'
      ? containsPattern
      : rule.operator === 'starts_with'
        ? startsWithPattern
        : equalsPattern;

  // Patterns are OR-ed, and the strongest match across them wins — one weak
  // infix hit should not mask a clean token hit from a sibling pattern.
  let best: MatchStrength | null = null;
  for (const pattern of rule.patterns) {
    const strength = test(narration, pattern);
    if (strength === 'token') return 'token';
    if (strength !== null) best = strength;
  }
  return best;
}

/**
 * The first rule that matches, in evaluation order.
 *
 * Sorted by `order` then `id` — a total order, so two rules sharing an `order`
 * still resolve the same way on every run. Determinism here is not fussiness:
 * an unstable sort would let the same statement classify differently between
 * imports, and every figure downstream would move with it.
 */
export function firstMatch(
  rules: readonly Rule[],
  narration: string,
  type: TransactionType,
): RuleMatch | null {
  const ordered = [...rules].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    const strength = matchRule(rule, narration, type);
    if (strength !== null) return { rule, strength };
  }
  return null;
}

// ── The shipped rule set ────────────────────────────────────────────────────

let nextOrder = 0;

function shipped(id: string, category: Rule['category'], patterns: readonly string[]): Rule {
  return { id: `shipped:${id}`, order: nextOrder++, operator: 'contains', patterns, category, origin: 'shipped' };
}

/**
 * Rules shipped with the app, in evaluation order.
 *
 * Ordering is the whole design here, because first match wins and several
 * patterns legitimately overlap. Three orderings are load-bearing and will look
 * arbitrary until they break:
 *
 *  - **Fees before rent** — `NON MAINTENANCE CHARGES` is a bank charge, but
 *    `MAINTENANCE` is a housing keyword in Indian narration.
 *  - **Groceries before food** — `SWIGGYINSTAMART` is a grocery order, and
 *    `SWIGGY` would otherwise infix-match it as dining first.
 *  - **Subscriptions before shopping** — `AMAZON PRIME VIDEO` is a
 *    subscription; `AMAZON` alone is shopping.
 *
 * Patterns deliberately absent, having been tried and rejected: `NACH` (funds
 * SIPs, loan EMIs and insurance premiums equally — no single answer), `GOOGLE`
 * (Google Pay is a payment rail, not a merchant, so it would swallow arbitrary
 * UPI narration), `PREMIUM` (matches YouTube Premium as readily as an insurance
 * premium), and bare `GST` (appears inside merchant tax identifiers).
 */
export const SHIPPED_RULES: readonly Rule[] = [
  shipped('fees', 'fees_charges', [
    'CHRG', 'CHARGES', 'CHARGE', 'SMS CHRG', 'AMB CHRG', 'CGST', 'SGST', 'IGST',
    'ANNUAL FEE', 'LATE FEE', 'PENALTY', 'MIN BAL', 'NON MAINTENANCE', 'PROCESSING FEE',
  ]),
  shipped('rent', 'rent_home', ['RENT', 'HOUSE RENT', 'RENT PAYMENT', 'MAINTENANCE', 'SOCIETY']),

  shipped('salary', 'salary', ['SALARY', 'SAL CREDIT', 'SALARY CREDIT', 'PAYROLL', 'MONTHLY SAL']),
  shipped('interest', 'interest', [
    'INT PD', 'INTEREST', 'CREDIT INTEREST', 'INT CREDIT', 'SAVINGS INTEREST',
  ]),
  shipped('dividend', 'dividend', ['DIVIDEND']),
  shipped('refund', 'refund', ['REFUND', 'REVERSAL', 'CASHBACK', 'CHARGEBACK']),

  shipped('self', 'self_transfer', ['SELF', 'TO SELF', 'SELF TRANSFER', 'OWN ACCOUNT']),
  shipped('cash', 'cash_withdrawal', [
    'ATM', 'ATM WDL', 'ATM WITHDRAWAL', 'CASH WITHDRAWAL', 'NWD', 'CWDR', 'EAW', 'CASH DEP',
  ]),
  shipped('card', 'credit_card_payment', [
    'CREDIT CARD PAYMENT', 'CC PAYMENT', 'CREDITCARD', 'AUTOPAY CC', 'CARD PAYMENT',
  ]),
  shipped('emi', 'emi_loan', [
    'EMI', 'LOAN EMI', 'HOME LOAN', 'CAR LOAN', 'PERSONAL LOAN', 'BAJAJ FINANCE', 'HDFC LTD',
  ]),

  shipped('invest', 'investments', [
    'ZERODHA', 'GROWW', 'UPSTOX', 'KUVERA', 'SMALLCASE', 'SIP', 'MUTUAL FUND', 'ELSS', 'NPS',
    'PPF', 'ICICI PRU MF', 'AXIS MF', 'SBI MUTUAL', 'HDFC AMC', 'NIPPON INDIA', 'MIRAE ASSET',
    'PARAG PARIKH', 'PPFAS', 'QUANT MF', 'INDMONEY',
  ]),
  shipped('insurance', 'insurance', [
    'LIC', 'HDFC LIFE', 'ICICI PRU LIFE', 'SBI LIFE', 'MAX LIFE', 'STAR HEALTH', 'POLICYBAZAAR',
    'TATA AIG', 'BAJAJ ALLIANZ', 'NIVA BUPA', 'INSURANCE',
  ]),

  shipped('subs', 'subscriptions', [
    'NETFLIX', 'SPOTIFY', 'HOTSTAR', 'DISNEY', 'PRIME VIDEO', 'YOUTUBE', 'ZEE5', 'SONYLIV',
    'AUDIBLE', 'ADOBE', 'MICROSOFT', 'CANVA', 'OPENAI', 'ANTHROPIC', 'APPLE COM', 'GOOGLE ONE',
  ]),
  shipped('groceries', 'groceries', [
    'BIGBASKET', 'ZEPTO', 'BLINKIT', 'INSTAMART', 'DMART', 'JIOMART', 'GROFERS', 'RELIANCE FRESH',
    'SPENCER', 'NATURE BASKET', 'LICIOUS', 'COUNTRY DELIGHT', 'MORE RETAIL', 'MILK',
  ]),
  shipped('food', 'food_dining', [
    'SWIGGY', 'ZOMATO', 'EATCLUB', 'DOMINOS', 'MCDONALD', 'KFC', 'BURGER KING', 'STARBUCKS',
    'CHAAYOS', 'BLUE TOKAI', 'THIRD WAVE', 'BARBEQUE', 'RESTAURANT', 'CAFE', 'PIZZA', 'BIRYANI',
  ]),
  shipped('utilities', 'utilities', [
    'JIO', 'AIRTEL', 'VODAFONE', 'BSNL', 'BESCOM', 'MSEB', 'TATA POWER', 'ADANI ELECTRICITY',
    'TORRENT POWER', 'ACT FIBERNET', 'HATHWAY', 'INDANE', 'HP GAS', 'MAHANAGAR GAS', 'IGL',
    'ELECTRICITY', 'BROADBAND', 'RECHARGE', 'WATER BILL',
  ]),
  shipped('transport', 'transport', [
    'UBER', 'OLA', 'RAPIDO', 'IRCTC', 'NAMMA YATRI', 'BLUSMART', 'FASTAG', 'METRO', 'PARKING',
    'INDIAN OIL', 'IOCL', 'HPCL', 'BPCL', 'BHARAT PETROLEUM', 'SHELL', 'PETROL', 'FUEL',
  ]),
  shipped('travel', 'travel', [
    'MAKEMYTRIP', 'GOIBIBO', 'CLEARTRIP', 'YATRA', 'EASEMYTRIP', 'OYO', 'AIRBNB', 'AGODA',
    'BOOKING COM', 'REDBUS', 'INDIGO', 'VISTARA', 'AIR INDIA', 'SPICEJET', 'AKASA',
  ]),
  shipped('entertainment', 'entertainment', [
    'BOOKMYSHOW', 'PVR', 'INOX', 'CINEPOLIS', 'TICKETNEW', 'DISTRICT',
  ]),
  shipped('health', 'health', [
    'APOLLO', 'PHARMEASY', '1MG', 'TATA 1MG', 'NETMEDS', 'MEDPLUS', 'PRACTO', 'CULT FIT',
    'CULTFIT', 'HOSPITAL', 'CLINIC', 'PHARMACY', 'DIAGNOSTIC', 'LAL PATHLABS', 'WELLNESS',
  ]),
  shipped('shopping', 'shopping', [
    'AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'NYKAA', 'MEESHO', 'WILDCRAFT', 'DECATHLON',
    'SHOPPERS STOP', 'WESTSIDE', 'LIFESTYLE', 'TATA CLIQ', 'CROMA', 'RELIANCE DIGITAL', 'IKEA',
    'PEPPERFRY', 'URBAN LADDER', 'ZARA',
  ]),
];
