import { nextRuleOrder, previewRule, type RulePreview } from '../enrichment/preview.ts';
import type { RuleInput } from '../enrichment/types.ts';
import { buildUserRule } from '../enrichment/userRules.ts';
import type { Store } from '../storage/store.ts';
import { loadTransactionRows } from './transactions.ts';

/** Preview a new rule against the exact store context it will enter when saved. */
export async function loadRulePreview(store: Store, input: RuleInput): Promise<RulePreview> {
  const [rows, rules, overrides] = await Promise.all([
    loadTransactionRows(store),
    store.listRules(),
    store.listOverrides(),
  ]);
  let previewId = 'user:preview';
  while (rules.some((rule) => rule.id === previewId)) previewId += ':next';

  const candidate = buildUserRule(input, previewId, nextRuleOrder(rules));
  return previewRule(
    candidate,
    rows.map((row) => row.transaction),
    { rules, overrides },
  );
}
