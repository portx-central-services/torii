import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, type TrackerConnection } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

export function TrackersPage() {
  const query = useQuery({
    queryKey: ['tracker-connections'],
    queryFn: () => endpoints.listTrackerConnections(),
  });

  const connections = query.data ?? [];
  const okCount = connections.filter((c) => c.status === 'ok').length;
  const failedCount = connections.filter((c) => c.status === 'auth_failed').length;
  const rateLimitedCount = connections.filter((c) => c.status === 'rate_limited').length;

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">External integrations</span>
          <h1>Trackers</h1>
          <div className="page-sub">
            Connect external trackers to import projects and keep selected fields in sync.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn-primary" href="/api/tracker/monday/connect">
            Connect Monday.com
          </a>
          <a className="btn-primary" href="/api/tracker/harvest/connect">
            Connect Harvest
          </a>
        </div>
      </div>

      <div className="kpi-row trackers-kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">Connections</div>
          <div className="kpi-value">{connections.length}</div>
          <div className="kpi-sub">total configured</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Healthy</div>
          <div className="kpi-value kpi-success">{okCount}</div>
          <div className="kpi-sub">status ok</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Auth failed</div>
          <div className="kpi-value kpi-danger">{failedCount}</div>
          <div className="kpi-sub">needs reconnect</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rate limited</div>
          <div className="kpi-value kpi-warning">{rateLimitedCount}</div>
          <div className="kpi-sub">retry pending</div>
        </div>
      </div>

      {query.isLoading ? (
        <div className="empty">Loading connections...</div>
      ) : query.isError ? (
        <div className="empty text-red-700">
          Unable to load tracker connections: {(query.error as Error).message}
        </div>
      ) : (query.data?.length ?? 0) === 0 ? (
        <div className="section-card empty">
          <div className="text-base text-gray-700 mb-2">No tracker connections yet</div>
          <div className="text-sm text-gray-500 mb-4">
            Use Connect Monday.com to start an OAuth flow.
          </div>
        </div>
      ) : (
        <div className="trackers-list">
          {query.data!.map((c) => (
            <ConnectionCard key={c.id} connection={c} />
          ))}
        </div>
      )}

      {connections.some((c) => c.provider === 'harvest' && c.status !== 'auth_failed') && (
        <>
          <HarvestLinkTable />
          <HarvestUserLinkTable />
        </>
      )}
    </div>
  );
}

function statusBadge(status: TrackerConnection['status']) {
  if (status === 'ok') return <span className="badge bg-emerald-50 text-emerald-700">OK</span>;
  if (status === 'rate_limited')
    return <span className="badge bg-amber-50 text-amber-800">Rate limited</span>;
  return <span className="badge bg-red-50 text-red-700">Auth failed</span>;
}

function ConnectionCard({ connection }: { connection: TrackerConnection }) {
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshMut = useMutation({
    mutationFn: () => endpoints.refreshTrackerConnection(connection.id, { force: true }),
    onSuccess: (data) => {
      if (data.status !== 'ok') {
        setRefreshError(data.error ?? `Sync failed with status: ${data.status}`);
        return;
      }
      setRefreshError(null);
    },
    onError: (e) =>
      setRefreshError(e instanceof ApiError ? e.message : (e as Error).message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tracker-connections'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return (
    <div className="section-card">
      <div className="trackers-conn-head">
        <div className="trackers-conn-id">
          <span className="badge bg-indigo-50 text-indigo-700">{connection.provider}</span>
          <div>
            <div className="trackers-conn-title">{connection.workspace}</div>
            <div className="trackers-conn-sub">
              {connection.lastSyncedAt
                ? `Last Sync ${new Date(connection.lastSyncedAt).toLocaleString()}`
                : 'Never Synced'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {statusBadge(connection.status)}
          <button
            type="button"
            className="btn-secondary"
            disabled={refreshMut.isPending}
            onClick={() => refreshMut.mutate()}
          >
            {refreshMut.isPending ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {connection.status === 'auth_failed' && (
        <div className="trackers-alert danger">
          The access token for this connection is invalid or revoked. Reconnect via the
          Connect Monday.com button above.
        </div>
      )}
      {refreshError && (
        <div className="trackers-alert danger">
          Last sync error: {refreshError}
        </div>
      )}
      {connection.status === 'rate_limited' && (
        <div className="trackers-alert warning">
          Monday.com has rate-limited recent requests. Sync will retry automatically.
        </div>
      )}

      <ImportPanel connectionId={connection.id} />
    </div>
  );
}

function ImportPanel({ connectionId }: { connectionId: string }) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const externalIds = raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (externalIds.length === 0) throw new Error('Enter one or more item ids');
      return endpoints.importTrackerItems(connectionId, externalIds);
    },
    onSuccess: async (data) => {
      setResult({ created: data.created.length, skipped: data.skipped });
      setRaw('');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  return (
    <div className="trackers-import-panel">
      <div className="text-sm font-medium text-gray-800 mb-2">Import items</div>
      <p className="text-xs text-gray-500 mb-2">
        Paste Monday.com item ids (one per line, or comma-separated). Already-linked items
        will be skipped.
      </p>
      <textarea
        className="input trackers-import-input"
        rows={3}
        placeholder="123456789&#10;987654321"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      {err && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {err}
        </div>
      )}
      {result && (
        <div className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">
          Imported {result.created} items
          {result.skipped.length > 0 && `; skipped ${result.skipped.length} already linked`}.
        </div>
      )}
      <div className="flex justify-end mt-3">
        <button
          type="button"
          className="btn-primary"
          disabled={mutation.isPending}
          onClick={() => {
            setErr(null);
            setResult(null);
            mutation.mutate();
          }}
        >
          {mutation.isPending ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  );
}

/**
 * Bulk-link UI for Harvest. Lists every Harvest project from the active connection;
 * each row has a dropdown to pick which Torii project to link to. Submits each
 * selection independently so partial saves are visible.
 */
function HarvestLinkTable() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const harvestQ = useQuery({
    queryKey: ['harvest-projects'],
    queryFn: () => endpoints.listHarvestProjects(),
  });
  const projectsQ = useQuery({
    queryKey: ['projects', 'harvest-link-table'],
    queryFn: () => endpoints.listProjects({}),
  });

  const linkMutation = useMutation({
    mutationFn: async ({ toiriProjectId, harvestProjectId }: { toiriProjectId: string; harvestProjectId: string }) => {
      return endpoints.linkHarvestProject(toiriProjectId, harvestProjectId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['harvest-projects'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Link failed'),
  });

  if (harvestQ.isLoading) return <div className="empty">Loading Harvest projects...</div>;
  if (harvestQ.isError) {
    return <div className="empty text-red-700">Unable to load Harvest projects: {(harvestQ.error as Error).message}</div>;
  }

  // Sort alphabetically (case-insensitive) before render. Harvest's API returns
  // projects in its own ordering; the link picker is much easier to scan when
  // it's alphabetical.
  const harvestProjects = (harvestQ.data ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const toiriProjects = projectsQ.data ?? [];

  function handleSelect(harvestProjectId: string, toiriProjectId: string) {
    if (!toiriProjectId) return;
    setError(null);
    setPending((s) => new Set(s).add(harvestProjectId));
    linkMutation.mutate(
      { toiriProjectId, harvestProjectId },
      {
        onSettled: () =>
          setPending((s) => {
            const next = new Set(s);
            next.delete(harvestProjectId);
            return next;
          }),
      },
    );
  }

  return (
    <div className="section-card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Link Harvest projects</h3>
      <div className="text-sm" style={{ color: 'var(--ink-500)', marginBottom: 12 }}>
        Pick the Torii project that matches each Harvest project. Already-linked rows show their current link.
      </div>
      {error && <div className="text-red-700" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-200)' }}>
              <th style={{ padding: '8px 4px' }}>Harvest project</th>
              <th style={{ padding: '8px 4px' }}>ID</th>
              <th style={{ padding: '8px 4px' }}>Torii link</th>
            </tr>
          </thead>
          <tbody>
            {harvestProjects.map((hp) => (
              <tr key={hp.harvestProjectId} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                <td style={{ padding: '6px 4px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hp.name}
                </td>
                <td style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 11, color: 'var(--ink-500)' }}>
                  {hp.harvestProjectId}
                </td>
                <td style={{ padding: '6px 4px' }}>
                  {hp.linkedToiriProjectId ? (
                    <span className="text-sm">Linked to {hp.linkedToiriProjectName ?? hp.linkedToiriProjectId}</span>
                  ) : (
                    <select
                      className="input"
                      defaultValue=""
                      disabled={pending.has(hp.harvestProjectId)}
                      onChange={(e) => handleSelect(hp.harvestProjectId, e.target.value)}
                    >
                      <option value="">Skip</option>
                      {toiriProjects
                        .filter((p) => !p.harvestProjectId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Bulk-link UI for Person ↔ Harvest user. Lists every Harvest user from the
 * active connection; each row offers a dropdown to pick the Torii Person to
 * link to. This populates `Person.harvest_user_id`, the bridge that the
 * Allocations-vs-Actuals reconciliation views depend on.
 */
function HarvestUserLinkTable() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const usersQ = useQuery({
    queryKey: ['harvest-users'],
    queryFn: () => endpoints.listHarvestUsers(),
  });
  const peopleQ = useQuery({
    queryKey: ['people', 'harvest-user-link-table'],
    queryFn: () => endpoints.listPeople(),
  });

  const linkMutation = useMutation({
    mutationFn: async ({ personId, harvestUserId }: { personId: string; harvestUserId: string }) => {
      return endpoints.linkPersonToHarvestUser(personId, harvestUserId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['harvest-users'] });
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Link failed'),
  });

  const unlinkMutation = useMutation({
    mutationFn: async ({ personId }: { personId: string }) => endpoints.unlinkPersonHarvestUser(personId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['harvest-users'] });
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Unlink failed'),
  });

  if (usersQ.isLoading) return <div className="empty">Loading Harvest users…</div>;
  if (usersQ.isError) {
    return (
      <div className="empty text-red-700">
        Unable to load Harvest users: {(usersQ.error as Error).message}
      </div>
    );
  }

  const harvestUsers = usersQ.data ?? [];
  const toiriPeople = peopleQ.data ?? [];
  // Torii People who aren't already linked to a different Harvest user — the
  // unique constraint on `Person.harvest_user_id` enforces this server-side too.
  const unlinkedPeople = toiriPeople.filter((p) => !p.harvestUserId);

  function handleSelect(harvestUserId: string, personId: string) {
    if (!personId) return;
    setError(null);
    setPending((s) => new Set(s).add(harvestUserId));
    linkMutation.mutate(
      { personId, harvestUserId },
      {
        onSettled: () =>
          setPending((s) => {
            const next = new Set(s);
            next.delete(harvestUserId);
            return next;
          }),
      },
    );
  }

  function handleUnlink(harvestUserId: string, personId: string) {
    setError(null);
    setPending((s) => new Set(s).add(harvestUserId));
    unlinkMutation.mutate(
      { personId },
      {
        onSettled: () =>
          setPending((s) => {
            const next = new Set(s);
            next.delete(harvestUserId);
            return next;
          }),
      },
    );
  }

  return (
    <div className="section-card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Link Harvest users</h3>
      <div className="text-sm" style={{ color: 'var(--ink-500)', marginBottom: 12 }}>
        Bridge each Harvest user to a Torii Person so the Allocations-vs-Actuals reconciliation can join planned hours to logged hours.
      </div>
      {error && <div className="text-red-700" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-200)' }}>
              <th style={{ padding: '8px 4px' }}>Harvest user</th>
              <th style={{ padding: '8px 4px' }}>Email</th>
              <th style={{ padding: '8px 4px' }}>Torii Person</th>
            </tr>
          </thead>
          <tbody>
            {harvestUsers.map((u) => (
              <tr key={u.harvestUserId} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{u.name}</td>
                <td
                  style={{
                    padding: '6px 4px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: 'var(--ink-500)',
                  }}
                >
                  {u.email || '—'}
                </td>
                <td style={{ padding: '6px 4px' }}>
                  {u.linkedToiriPersonId ? (
                    <span className="text-sm">
                      {u.linkedToiriPersonName ?? u.linkedToiriPersonId}{' '}
                      <button
                        type="button"
                        className="text-sm text-gray-600 hover:underline"
                        disabled={pending.has(u.harvestUserId)}
                        onClick={() => handleUnlink(u.harvestUserId, u.linkedToiriPersonId!)}
                        style={{ marginLeft: 8 }}
                      >
                        Unlink
                      </button>
                    </span>
                  ) : (
                    <select
                      className="input"
                      defaultValue=""
                      disabled={pending.has(u.harvestUserId)}
                      onChange={(e) => handleSelect(u.harvestUserId, e.target.value)}
                    >
                      <option value="">Skip</option>
                      {unlinkedPeople.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.email.endsWith('@torii.unresolved') ? ' (import-only)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
