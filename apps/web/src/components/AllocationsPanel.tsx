import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

export function AllocationsPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => endpoints.getProject(projectId),
  });
  const peopleQuery = useQuery({
    queryKey: ['people'],
    queryFn: () => endpoints.listPeople(),
    enabled: canEdit,
  });

  const [showAdd, setShowAdd] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (id: string) => endpoints.deleteAllocation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  if (detail.isLoading) return null;
  const allocations = detail.data?.allocations ?? [];
  const peopleById = new Map((peopleQuery.data ?? []).map((p) => [p.id, p]));

  return (
    <section className="section-card">
      <div className="section-card-head">
        <h3>Team allocations</h3>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? 'Cancel' : 'Add allocation'}
          </button>
        )}
      </div>

      {canEdit && showAdd && (
        <AddAllocationForm
          projectId={projectId}
          onSubmitted={() => {
            setShowAdd(false);
            queryClient.invalidateQueries({ queryKey: ['project', projectId] });
          }}
        />
      )}

      {allocations.length === 0 ? (
        <div className="empty">No allocations yet</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Person</th>
              <th>%</th>
              <th>Start</th>
              <th>End</th>
              {canEdit && <th className="w-px" />}
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              const person = peopleById.get(a.personId);
              return (
                <tr key={a.id}>
                  <td>
                    {person ? (
                      <span>
                        {person.name}{' '}
                        <span className="text-gray-400">&lt;{person.email}&gt;</span>
                      </span>
                    ) : (
                      a.personId
                    )}
                  </td>
                  <td className="mono">{a.pct}%</td>
                  <td>{a.start}</td>
                  <td>{a.end}</td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="text-xs text-red-700 hover:underline"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (confirm('Delete this allocation?')) deleteMut.mutate(a.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddAllocationForm({
  projectId,
  onSubmitted,
}: {
  projectId: string;
  onSubmitted: () => void;
}) {
  const peopleQuery = useQuery({
    queryKey: ['people'],
    queryFn: () => endpoints.listPeople(),
  });
  const [personId, setPersonId] = useState('');
  const [pct, setPct] = useState(50);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      endpoints.createAllocation({
        projectId,
        personId,
        pct,
        start,
        end,
      }),
    onSuccess: () => onSubmitted(),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Unable to create allocation.'),
  });

  return (
    <form
      className="detail-settings-grid mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        mutation.mutate();
      }}
    >
      <select
        className="input"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        required
      >
        <option value="">Select person...</option>
        {(peopleQuery.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        max={100}
        className="input"
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        required
      />
      <input
        type="date"
        className="input"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        required
      />
      <input
        type="date"
        className="input"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        required
      />
      {err && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" style={{ gridColumn: '1 / -1' }}>
          {err}
        </div>
      )}
      <div className="detail-form-actions" style={{ gridColumn: '1 / -1' }}>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding...' : 'Add allocation'}
        </button>
      </div>
    </form>
  );
}
