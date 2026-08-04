import type { Category, CategoryGroup } from '../enrichment/taxonomy.ts';

const CATEGORY_GROUPS: readonly {
  id: CategoryGroup;
  label: string;
}[] = [
  { id: 'income', label: 'Income' },
  { id: 'essentials', label: 'Essentials' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'money_movement', label: 'Money movement' },
  { id: 'other', label: 'Other' },
];

export function CategoryOptionGroups({ categories }: { categories: readonly Category[] }) {
  return (
    <>
      {CATEGORY_GROUPS.map((group) => {
        const options = categories.filter((category) => category.group === group.id);

        if (options.length === 0) return null;

        return (
          <optgroup key={group.id} label={group.label}>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
