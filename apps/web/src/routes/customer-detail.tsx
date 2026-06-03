import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { varianceBucket, type VarianceBucket } from '@torii/shared';
import { endpoints, type CustomerDetail, type CustomerReconciliation } from '../api/endpoints.js';
import { useIsPM } from '../auth/AuthProvider.js';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const isPM = useIsPM();

  const customerQ = useQuery({
    queryKey: ['customer', id],
    queryFn: () => endpoints.getCustomer(id!),
    enabled: !!id,
  });
  const reconQ = useQuery({
    queryKey: ['customer-reconciliation', id],
    queryFn: () => endpoints.customerReconciliation(id!),
    enabled: !!id,
  });

  const [editingName, setEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const renameMutation = useMutation({
    mutationFn: (name: string) => endpoints.updateCustomer(id!, { name }),
    onSuccess: () => {
      setEditingName(false);
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  if (!id) return null;

  if (customerQ.isLoading) {
    return <div className="text-gray-500">Loading…</div>;
  }
  if (customerQ.isError) {
    return (
      <div className="text-red-700">
        Unable to load customer: {(customerQ.error as Error).message}
      </div>
    );
  }
  const customer = customerQ.data as CustomerDetail;

  return (
    <div className="page-stack">
      <section className="section-card">
        <div className="page-header-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <span className="overline">Customer</span>
            {editingName ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editedName.trim()) renameMutation.mutate(editedName.trim());
                }}
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <input
                  className="input"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn-primary" disabled={renameMutation.isPending}>
                  Save
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditingName(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <h1>{customer.name}</h1>
            )}
            <div className="page-sub">
              {customer.harvestClientId ? (
                <span className="harvest-billable-badge billable">Linked to Harvest client {customer.harvestClientId}</span>
              ) : (
                <span className="dashboard-em">No Harvest client linked</span>
              )}
            </div>
          </div>
          {isPM && !editingName && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditedName(customer.name);
                setEditingName(true);
              }}
            >
              Edit name
            </button>
          )}
        </div>
      </section>

      <section className="section-card">
        <h2 style={{ marginTop: 0 }}>Monday projects ({customer.projects.length})</h2>
        {customer.projects.length === 0 ? (
          <div className="dashboard-empty">No Monday projects under this customer yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ink-200)' }}>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>Phase</th>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>State</th>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>Target go-live</th>
              </tr>
            </thead>
            <tbody>
              {customer.projects.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                  <td style={{ padding: '8px 8px' }}>
                    <Link to={`/projects/${p.id}`} className="text-torii hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 8px' }}>{p.phase}</td>
                  <td style={{ padding: '8px 8px' }}>{p.state}</td>
                  <td style={{ padding: '8px 8px' }}>{p.keyDates.target_go_live ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section-card">
        <h2 style={{ marginTop: 0 }}>Harvest projects ({customer.harvestProjects.length})</h2>
        {customer.harvestProjects.length === 0 ? (
          <div className="dashboard-empty">No Harvest projects under this customer yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ink-200)' }}>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>Billable</th>
                <th style={{ textAlign: 'left', padding: '8px 8px' }}>Pinned to</th>
                <th style={{ textAlign: 'right', padding: '8px 8px' }}>Budget</th>
                <th style={{ textAlign: 'right', padding: '8px 8px' }}>Spent</th>
                <th style={{ textAlign: 'right', padding: '8px 8px' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {customer.harvestProjects.map((hp) => {
                const spent = hp.spentHoursBillable + hp.spentHoursNonbillable;
                const pct =
                  hp.budgetHours && hp.budgetHours > 0
                    ? Math.round((spent / hp.budgetHours) * 100)
                    : null;
                return (
                  <tr key={hp.id} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                    <td style={{ padding: '8px 8px' }}>
                      <a href={hp.harvestProjectUrl} target="_blank" rel="noopener noreferrer">
                        {hp.name}
                      </a>
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      <span className={`harvest-billable-badge ${hp.isBillable ? 'billable' : 'non-billable'}`}>
                        {hp.isBillable ? 'Billable' : 'Non-billable'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      {hp.pinnedProject ? (
                        <Link to={`/projects/${hp.pinnedProject.id}`} className="text-torii hover:underline">
                          {hp.pinnedProject.name}
                        </Link>
                      ) : (
                        <span className="dashboard-em">—</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                      {hp.budgetHours === null ? '—' : `${hp.budgetHours.toFixed(1)}h`}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>{spent.toFixed(1)}h</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                      {pct === null ? '—' : `${pct}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {reconQ.isSuccess && <CustomerReconciliationCard data={reconQ.data} />}
    </div>
  );
}

function CustomerReconciliationCard({ data }: { data: CustomerReconciliation }) {
  // Prefer Budget-based variance for the headline (it's the Harvest-native "are we
  // burning past what we sold?" read). Fall back to Planned-vs-Actual when the
  // customer has no Harvest budgets configured.
  const headlineLabel = data.budgetHours === null ? 'Variance (vs. planned)' : 'Variance (vs. budget)';
  const headlineHours = data.budgetVarianceHours ?? data.varianceHours;
  const headlinePct = data.budgetHours === null ? data.variancePct : data.budgetVariancePct;
  const headlineBucket: VarianceBucket =
    data.budgetHours === null
      ? varianceBucket(data.plannedHours, data.actualHours)
      : varianceBucket(data.budgetHours, data.actualHours);

  return (
    <section className="section-card">
      <h2 style={{ marginTop: 0 }}>Customer-wide reconciliation</h2>
      <div className="kpi-row dashboard-kpi-row">
        <div className="kpi">
          <div className="kpi-label">Budget</div>
          <div className="kpi-value">
            {data.budgetHours === null ? '—' : `${data.budgetHours.toFixed(1)}h`}
          </div>
          <div className="kpi-sub">Sum of Harvest budgets</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Planned</div>
          <div className="kpi-value">{data.plannedHours.toFixed(1)}h</div>
          <div className="kpi-sub">Across allocations</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Actual</div>
          <div className="kpi-value">{data.actualHours.toFixed(1)}h</div>
          <div className="kpi-sub">Across Harvest projects</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Support</div>
          <div className="kpi-value">{data.supportHours.toFixed(1)}h</div>
          <div className="kpi-sub">Customer-only (no pin)</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{headlineLabel}</div>
          <div
            className={`kpi-value ${
              headlineBucket === 'red'
                ? 'kpi-danger'
                : headlineBucket === 'amber'
                  ? 'kpi-warning'
                  : 'kpi-success'
            }`}
          >
            {headlineHours >= 0 ? '+' : ''}
            {headlineHours.toFixed(1)}h
          </div>
          <div className="kpi-sub">
            {headlinePct === null
              ? '—'
              : `${headlinePct >= 0 ? '+' : ''}${headlinePct.toFixed(0)}%`}
          </div>
        </div>
      </div>

      {data.perProject.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ink-200)' }}>
              <th style={{ textAlign: 'left', padding: '8px 8px' }}>Project</th>
              <th style={{ textAlign: 'right', padding: '8px 8px' }}>Planned</th>
              <th style={{ textAlign: 'right', padding: '8px 8px' }}>Actual</th>
              <th style={{ textAlign: 'right', padding: '8px 8px' }}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.perProject.map((row) => {
              const rowBucket = varianceBucket(row.plannedHours, row.actualHours);
              return (
                <tr key={row.projectId} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                  <td style={{ padding: '8px 8px' }}>
                    <Link to={`/projects/${row.projectId}`} className="text-torii hover:underline">
                      {row.projectName}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>{row.plannedHours.toFixed(1)}h</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>{row.actualHours.toFixed(1)}h</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <span className={`variance-chip variance-chip-${rowBucket}`}>
                      {row.varianceHours >= 0 ? '+' : ''}
                      {row.varianceHours.toFixed(1)}h
                      {row.variancePct !== null && ` (${row.variancePct >= 0 ? '+' : ''}${row.variancePct.toFixed(0)}%)`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
