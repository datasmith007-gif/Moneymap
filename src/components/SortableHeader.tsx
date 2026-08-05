import type { ReactNode } from 'react';
import type { ColumnSort } from '../engine/categorization.ts';

/**
 * A column heading that is also its own sort control.
 *
 * Replaces a separate "order by" dropdown. The dropdown could only ever name
 * some of the columns, it put the control somewhere other than the thing it
 * controlled, and it had no room to say which way the order ran. Putting the
 * affordance in the heading answers all three: every sortable column has one,
 * it is where the reader is already looking, and the arrow is the state.
 *
 * The inactive arrow is deliberately drawn rather than hidden until hover. A
 * control that only appears once you have found it is a control most readers
 * never find, and hover does not exist on touch at all.
 *
 * First click sorts a numeric column **descending** and a text column
 * **ascending** — in both cases the direction someone asking for that column
 * almost always wants. Clicking the active column flips it. That is derived
 * from `numeric` rather than taken as a separate prop, because a caller that
 * could set the two independently would eventually set them inconsistently.
 */
export function SortableHeader<Column extends string>({
  column,
  sort,
  onSort,
  numeric = false,
  children,
}: {
  readonly column: Column;
  readonly sort: ColumnSort<Column>;
  readonly onSort: (next: ColumnSort<Column>) => void;
  /** Right-aligns the column, and makes the first click sort largest-first. */
  readonly numeric?: boolean;
  readonly children: ReactNode;
}) {
  const active = sort.column === column;
  const direction = active ? sort.direction : null;

  return (
    <th
      className={numeric ? 'num' : undefined}
      aria-sort={direction === null ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}
    >
      <button
        type="button"
        className={active ? 'sort-toggle sort-toggle-active' : 'sort-toggle'}
        onClick={() =>
          onSort({
            column,
            direction: active
              ? sort.direction === 'asc'
                ? 'desc'
                : 'asc'
              : numeric
                ? 'desc'
                : 'asc',
          })
        }
      >
        <span>{children}</span>
        {/*
          Hidden from assistive tech: `aria-sort` on the header already carries
          this state, and announcing an arrow glyph as well would say it twice.
        */}
        <span className="sort-arrow" aria-hidden="true">
          {direction === null ? '↕' : direction === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  );
}
