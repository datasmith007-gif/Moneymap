import type { Dashboard } from '../engine/aggregate.ts';
import { formatMonth } from '../model/date.ts';
import { InfoTip } from './InfoTip.tsx';

/**
 * Everything the reader must know for the dashboard's figures to be read
 * correctly, collected into one indicator instead of scattered boxes.
 *
 * This component owns the whole set — the engine's caveats plus the two
 * exclusions the panels used to print themselves (months left out of the
 * averages, accounts left out of the total). Assembling them here is the point:
 * when each panel carried its own footnote, a reader had to scroll the page to
 * learn what the numbers did not cover, no panel could rank a warning above a
 * note, and the caveats that affect net position alone were shown nowhere at
 * all. One owner makes "what is qualified about these figures?" a single
 * question with a single answer.
 *
 * Warnings sort above notes so the count never leads with the mildest item.
 */
export function DashboardNotices({ dashboard }: { readonly dashboard: Dashboard }) {
  const notices = collectNotices(dashboard);
  if (notices.length === 0) return null;

  const warnings = notices.filter((notice) => notice.severity === 'warning').length;

  return (
    <InfoTip
      glyph="!"
      tone={warnings > 0 ? 'warning' : 'note'}
      badge={String(notices.length)}
      label={`${notices.length} thing${notices.length === 1 ? '' : 's'} to know about these figures`}
      align="end"
    >
      <span className="infotip-title">About these figures</span>
      <ul className="notice-list">
        {notices.map((notice) => (
          <li key={notice.id} className={`notice notice-${notice.severity}`}>
            {notice.text}
          </li>
        ))}
      </ul>
    </InfoTip>
  );
}

interface Notice {
  readonly id: string;
  readonly text: string;
  readonly severity: 'note' | 'warning';
}

function collectNotices(dashboard: Dashboard): readonly Notice[] {
  const notices: Notice[] = [];

  const stale = dashboard.monthsSinceLatestStatement;
  if (stale > 0) {
    notices.push({
      id: 'anchor_lag',
      text: `Your most recent statement ends ${formatMonth(dashboard.anchorMonth)} — ${stale} month${stale === 1 ? '' : 's'} ago. Import a newer one to bring these figures up to date.`,
      severity: 'note',
    });
  }

  for (const caveat of dashboard.caveats) {
    notices.push({ id: caveat.id, text: caveat.text, severity: caveat.severity });
  }

  const excludedMonths = dashboard.averages.monthsExcluded;
  if (excludedMonths.length > 0) {
    const listed = excludedMonths
      .map(
        (excluded) =>
          `${formatMonth(excluded.month)} (${excluded.reason === 'no_coverage' ? 'no statement' : 'partly covered'})`,
      )
      .join(', ');
    notices.push({
      id: 'months_excluded',
      text: `Left out of the averages: ${listed}.`,
      severity: 'note',
    });
  }

  const excludedAccounts = dashboard.netPosition.excluded;
  if (excludedAccounts.length > 0) {
    notices.push({
      id: 'foreign_currency_accounts',
      text: `${excludedAccounts.length} account${excludedAccounts.length === 1 ? ' is' : 's are'} not in rupees and ${excludedAccounts.length === 1 ? 'is' : 'are'} left out of the net position total.`,
      severity: 'note',
    });
  }

  return [
    ...notices.filter((notice) => notice.severity === 'warning'),
    ...notices.filter((notice) => notice.severity === 'note'),
  ];
}
