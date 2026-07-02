import type { Filters } from './index';

export function Th({
  children,
  sort,
  filters,
  setFilters,
  setOffset,
  align = 'left',
}: {
  children: React.ReactNode;
  sort: Filters['sort'];
  filters: Filters;
  setFilters: (fn: (f: Filters) => Filters) => void;
  setOffset: (n: number) => void;
  align?: 'left' | 'right';
}) {
  const active = filters.sort === sort;
  return (
    <th
      className={`px-4 py-3 label font-normal cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => {
        setOffset(0);
        setFilters((f) => ({
          ...f,
          sort,
          order: f.sort === sort ? (f.order === 'asc' ? 'desc' : 'asc') : 'desc',
        }));
      }}
    >
      <span className={active ? 'text-ink-100' : ''}>
        {children}
        {active ? (filters.order === 'asc' ? ' ↑' : ' ↓') : ''}
      </span>
    </th>
  );
}
