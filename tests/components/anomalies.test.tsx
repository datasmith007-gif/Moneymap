// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AnomalyPanel } from '../../src/components/AnomalyPanel.tsx';
import type { Anomaly } from '../../src/engine/anomalies.ts';

afterEach(cleanup);

const anomaly: Anomaly = {
  transactionId: 't-1',
  date: '2025-08-14',
  description: 'UPI/SWIGGY ORDER/8891',
  counterparty: 'SWIGGY',
  category: 'food_dining',
  amount: 15_000_00,
  baseline: 500_00,
  excess: 14_500_00,
  multiple: 30,
  sampleSize: 11,
};

describe('unusual spending panel', () => {
  it('renders nothing at all when there is nothing to report', () => {
    const empty = render(<AnomalyPanel anomalies={[]} />);
    expect(empty.container.textContent).toBe('');

    // Still loading is also nothing — never a box promising figures later.
    const loading = render(<AnomalyPanel anomalies={null} />);
    expect(loading.container.textContent).toBe('');
  });

  it('states the multiple with the baseline and sample size behind it', () => {
    render(<AnomalyPanel anomalies={[anomaly]} />);

    expect(screen.getByRole('heading', { name: 'Unusual spending' })).toBeTruthy();
    expect(screen.getByText('30× your usual food & dining')).toBeTruthy();
    expect(screen.getByText('usually 500.00, over 11 payments')).toBeTruthy();
    expect(screen.getByText('15,000.00')).toBeTruthy();
    expect(screen.getByText('SWIGGY')).toBeTruthy();
    expect(screen.getByText('UPI/SWIGGY ORDER/8891')).toBeTruthy();
  });

  it('keeps one decimal on small multiples and drops it on large ones', () => {
    render(
      <AnomalyPanel
        anomalies={[
          { ...anomaly, transactionId: 'small', multiple: 2.46, category: 'shopping' },
          { ...anomaly, transactionId: 'large', multiple: 30.44, category: 'travel' },
        ]}
      />,
    );

    expect(screen.getByText('2.5× your usual shopping')).toBeTruthy();
    expect(screen.getByText('30× your usual travel')).toBeTruthy();
  });

  it('falls back to the raw narration when no counterparty was named', () => {
    render(<AnomalyPanel anomalies={[{ ...anomaly, counterparty: null }]} />);

    expect(screen.getAllByText('UPI/SWIGGY ORDER/8891')).toHaveLength(1);
  });
});
