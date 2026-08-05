import { useState, type FormEvent } from 'react';
import { CATEGORIES, categoryLabel, type CategoryId } from '../enrichment/taxonomy.ts';
import type { Rule, RuleInput, RuleOperator } from '../enrichment/types.ts';
import { useRulePreview, useRules } from '../hooks/useDashboard.ts';
import { formatPaise } from '../model/money.ts';
import type { Store } from '../storage/store.ts';
import { CategoryOptionGroups } from './CategoryOptionGroups.tsx';

const OPERATOR_LABELS: Readonly<Record<RuleOperator, string>> = {
  contains: 'contains',
  starts_with: 'starts with',
  exact: 'exactly equals',
};

const RULE_CATEGORIES = CATEGORIES.filter((category) => category.id !== 'unclassified');

/** Create, preview, inspect, and remove retroactive rules in the current session. */
export function RuleManagerPanel({
  store,
  revision,
  onAdd,
  onDelete,
}: {
  readonly store: Store;
  readonly revision: number;
  readonly onAdd: (input: RuleInput) => Promise<Rule>;
  readonly onDelete: (ruleId: string) => Promise<void>;
}) {
  const [patternsText, setPatternsText] = useState('');
  const [operator, setOperator] = useState<RuleOperator>('contains');
  const [category, setCategory] = useState<CategoryId>('groceries');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rules = useRules(store, revision);
  const patterns = patternsText.split(/[\n,]+/).map((value) => value.trim());
  const hasPattern = patterns.some((pattern) => pattern !== '');
  const input: RuleInput | null = hasPattern ? { operator, patterns, category } : null;
  const preview = useRulePreview(store, revision, input);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (input === null || preview === null) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(input);
      setPatternsText('');
    } catch {
      setError('The rule could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(ruleId: string) {
    setRemovingId(ruleId);
    setError(null);
    try {
      await onDelete(ruleId);
    } catch {
      setError('The rule could not be removed. Try again.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Categorization rules</h2>
        {rules !== null && (
          <span className="muted">
            {rules.length} rule{rules.length === 1 ? '' : 's'} this session
          </span>
        )}
      </header>
      <p className="panel-note">
        Rules apply to past and future imported rows in this session. A manual transaction choice
        still wins.
      </p>

      <form className="rule-form" onSubmit={submit}>
        <label className="field rule-patterns" htmlFor="rule-patterns">
          <span>Merchant or narration text</span>
          <input
            id="rule-patterns"
            aria-label="Merchant or narration text"
            value={patternsText}
            onChange={(event) => setPatternsText(event.target.value)}
            placeholder="e.g. local mart, neighbourhood foods"
          />
        </label>
        <label className="field" htmlFor="rule-operator">
          <span>Match</span>
          <select
            id="rule-operator"
            aria-label="Match"
            value={operator}
            onChange={(event) => setOperator(event.target.value as RuleOperator)}
          >
            {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="rule-category">
          <span>Category</span>
          <select
            id="rule-category"
            aria-label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as CategoryId)}
          >
            <CategoryOptionGroups categories={RULE_CATEGORIES} />
          </select>
        </label>
        <button type="submit" disabled={saving || input === null || preview === null}>
          {saving ? 'Saving…' : 'Save rule'}
        </button>
        {/*
          Below the row rather than inside the first field. The row is
          bottom-aligned, so a hint living inside one field pushed that field's
          input up by its own height and left the three controls out of line
          with each other.
        */}
        <small className="rule-hint">Separate alternatives with commas.</small>
      </form>

      {input !== null && preview === null && <p className="empty">Checking past entries…</p>}
      {preview !== null && (
        <p className="rule-preview" role="status" aria-live="polite">
          Matches <strong>{preview.matchCount}</strong> past entr
          {preview.matchCount === 1 ? 'y' : 'ies'} totalling{' '}
          <strong>{formatPaise(preview.matchTotal)}</strong>. {preview.newlyLabelled.length} gain a
          category; {preview.relabelled.length} change category.
        </p>
      )}
      {error !== null && <p className="caveat caveat-warning">{error}</p>}

      {rules === null ? (
        <p className="empty">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="empty">No personal rules yet.</p>
      ) : (
        <div className="table-scroll rule-table">
          <table className="txns">
            <thead>
              <tr>
                <th>Text</th>
                <th>Match</th>
                <th>Category</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.patterns.join(', ')}</td>
                  <td>{OPERATOR_LABELS[rule.operator]}</td>
                  <td>{categoryLabel(rule.category)}</td>
                  <td className="rule-action">
                    <button
                      type="button"
                      className="category-clear"
                      disabled={removingId === rule.id}
                      onClick={() => void remove(rule.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
