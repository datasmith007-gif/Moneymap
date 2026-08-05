import { useMemo, useState } from 'react';
import type { CategoryId } from '../enrichment/taxonomy.ts';
import type { Rule, RuleInput } from '../enrichment/types.ts';
import { groupCategorizationRows } from '../engine/categorization.ts';
import type { TransactionRegisterRow } from '../engine/transactions.ts';
import { useRules } from '../hooks/useDashboard.ts';
import type { Store } from '../storage/store.ts';
import { ReviewCategorizationSection } from './ReviewCategorizationSection.tsx';
import { RuleManagerPanel } from './RuleManagerPanel.tsx';

export interface ReviewCenterProps {
  readonly store: Store;
  readonly revision: number;
  readonly rows: readonly TransactionRegisterRow[] | null;
  readonly onCategorize: (transactionId: string, category: CategoryId | null) => Promise<void>;
  readonly onAddRule: (input: RuleInput) => Promise<Rule>;
  readonly onDeleteRule: (ruleId: string) => Promise<void>;
}

/** One deliberately collapsible owner for all session categorization work. */
export function ReviewCenter({
  store,
  revision,
  rows,
  onCategorize,
  onAddRule,
  onDeleteRule,
}: ReviewCenterProps) {
  const [open, setOpen] = useState(false);
  const rules = useRules(store, revision);
  const repeatedLabels = useMemo(
    () => groupCategorizationRows(rows ?? []).filter((group) => group.rows.length > 1).length,
    [rows],
  );

  return (
    <section className="work-panel review-center">
      <header className="review-center-head">
        <div>
          <p className="eyebrow">Workbench</p>
          <h2 id="review-center-heading">Review center</h2>
          <p className="review-summary">
            <span>{rows === null ? '—' : rows.length} uncategorized</span>
            <span>{rows === null ? '—' : repeatedLabels} repeated label groups</span>
            <span>{rules === null ? '—' : rules.length} personal session rules</span>
          </p>
        </div>
        <button
          type="button"
          className="button-secondary"
          aria-expanded={open}
          aria-controls="review-center-content"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Close review' : 'Open review'}
        </button>
      </header>

      {open && (
        <div id="review-center-content" className="review-center-content">
          <ReviewCategorizationSection rows={rows} onCategorize={onCategorize} />
          <RuleManagerPanel
            store={store}
            revision={revision}
            rules={rules}
            onAdd={onAddRule}
            onDelete={onDeleteRule}
          />
        </div>
      )}
    </section>
  );
}
