import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type CustomerListItem } from '../api/endpoints.js';

type SortKey = 'name' | 'mondayProjectCount' | 'harvestProjectCount' | 'lifetimeHours' | 'harvestLinked';
type SortDir = 'asc' | 'desc';

export function CustomersListPage() {
  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: () => endpoints.listCustomers(),
  });

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const rows = useMemo(() => {
    const data = (customers.data ?? []).slice();
    data.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = compareSortable(va, vb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [customers.data, sortKey, sortDir]);

  if (customers.isLoading) {
    return (
      <div className="page-stack">
        <CustomersHeader />
        <div className="text-gray-500">Loading…</div>
      </div>
    );
  }
  if (customers.isError) {
    return (
      <div className="page-stack">
        <CustomersHeader />
        <div className="text-red-700">
          Unable to load customers: {(customers.error as Error).message}
        </div>
      </div>
    );
  }

  function header(key: SortKey, label: string, align: 'left' | 'right' = 'left') {
    const active = sortKey === key;
    return (
      <th
        style={{ textAlign: align, padding: '8px 8px', cursor: 'pointer' }}
        onClick={() => {
          if (active) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          else {
            setSortKey(key);
            setSortDir('asc');
          }
        }}
      >
        {label}
        {active && <span style={{ marginLeft: 6 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </th>
    );
  }

  return (
    <div className="page-stack">
      <CustomersHeader />
      {rows.length === 0 ? (
        <div className="dashboard-empty">No customers yet. Map Harvest clients on the <Link to="/trackers">Trackers page</Link>.</div>
      ) : (
        <section className="section-card">
          <table className="customers-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ink-200)' }}>
                {header('name', 'Name')}
                {header('mondayProjectCount', 'Monday projects', 'right')}
                {header('harvestProjectCount', 'Harvest projects', 'right')}
                {header('lifetimeHours', 'Lifetime hours', 'right')}
                {header('harvestLinked', 'Harvest')}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                  <td style={{ padding: '8px 8px' }}>
                    <Link to={`/customers/${c.id}`} className="text-torii hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>{c.mondayProjectCount}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>{c.harvestProjectCount}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    {c.lifetimeHours.toLocaleString('en-US', { maximumFractionDigits: 1 })}h
                  </td>
                  <td style={{ padding: '8px 8px' }}>
                    {c.harvestClientId ? (
                      <span className="harvest-billable-badge billable">Linked</span>
                    ) : (
                      <span className="dashboard-em">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function CustomersHeader() {
  return (
    <div className="page-header">
      <div className="page-header-title">
        <span className="overline">Customers</span>
        <h1>Customers</h1>
        <div className="page-sub">
          Customer-anchored view of Monday projects and Harvest billing.
        </div>
      </div>
    </div>
  );
}

function sortValue(c: CustomerListItem, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return c.name.toLowerCase();
    case 'mondayProjectCount':
      return c.mondayProjectCount;
    case 'harvestProjectCount':
      return c.harvestProjectCount;
    case 'lifetimeHours':
      return c.lifetimeHours;
    case 'harvestLinked':
      return c.harvestClientId ? 1 : 0;
  }
}

function compareSortable(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
