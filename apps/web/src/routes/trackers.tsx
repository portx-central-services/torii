import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, type TrackerConnection } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

export function TrackersPage() {
  const query = useQuery({
    queryKey: ['tracker-connections'],
    queryFn: () => endpoints.listTrackerConnections(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Trackers</h1>
          <p className="text-sm text-gray-500">
            Connect external trackers to import projects and keep selected fields in sync.
          </p>
        </div>
        <a className="btn-primary" href="/api/tracker/monday/connect">
          Connect Monday.com
        </a>
      </div>

      {query.isLoading ? (
        <div className="text-gray-500">Loading connections…</div>
      ) : query.isError ? (
        <div className="text-red-700">
          Could not load tracker connections: {(query.error as Error).message}
        </div>
      ) : (query.data?.length ?? 0) === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-base text-gray-700 mb-2">No tracker connections yet</div>
          <div className="text-sm text-gray-500 mb-4">
            Use “Connect Monday.com” to start an OAuth flow.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {query.data!.map((c) => (
            <ConnectionCard key={c.id} connection={c} />
          ))}
        </div>
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

  const refreshMut = useMutation({
    mutationFn: () => endpoints.refreshTrackerConnection(connection.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tracker-connections'] }),
  });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-3">
          <span className="badge bg-indigo-50 text-indigo-700">{connection.provider}</span>
          <div>
            <div className="font-medium">{connection.workspace}</div>
            <div className="text-xs text-gray-500">
              {connection.lastSyncedAt
                ? `Last sync ${new Date(connection.lastSyncedAt).toLocaleString()}`
                : 'Never synced'}
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
            {refreshMut.isPending ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {connection.status === 'auth_failed' && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-200 text-sm text-red-800">
          The access token for this connection is invalid or revoked. Reconnect via the
          “Connect Monday.com” button above.
        </div>
      )}
      {connection.status === 'rate_limited' && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
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
    <div className="px-5 py-4">
      <div className="text-sm font-medium text-gray-800 mb-2">Import items</div>
      <p className="text-xs text-gray-500 mb-2">
        Paste Monday.com item ids (one per line, or comma-separated). Already-linked items
        will be skipped.
      </p>
      <textarea
        className="input w-full font-mono text-xs"
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
          {mutation.isPending ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  );
}
