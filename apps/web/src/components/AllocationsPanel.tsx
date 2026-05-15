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
    <section className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-800">Allocations</h2>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary text-xs"
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
        <div className="p-6 text-sm text-gray-500 text-center">No allocations yet</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
            <tr>
              <th className="px-4 py-2">Person</th>
              <th className="px-4 py-2">%</th>
              <th className="px-4 py-2">Start</th>
              <th className="px-4 py-2">End</th>
              {canEdit && <th className="px-4 py-2 w-px" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {allocations.map((a) => {
              const person = peopleById.get(a.personId);
              return (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    {person ? (
                      <span>
                        {person.name}{' '}
                        <span className="text-gray-400">&lt;{person.email}&gt;</span>
                      </span>
                    ) : (
                      a.personId
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">{a.pct}%</td>
                  <td className="px-4 py-2">{a.start}</td>
                  <td className="px-4 py-2">{a.end}</td>
                  {canEdit && (
                    <td className="px-4 py-2">
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
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <form
      className="p-4 bg-gray-50 grid grid-cols-5 gap-2 border-b border-gray-200"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        mutation.mutate();
      }}
    >
      <select
        className="input col-span-2"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        required
      >
        <option value="">Select person…</option>
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
        <div className="col-span-5 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {err}
        </div>
      )}
      <div className="col-span-5 flex justify-end">
        <button type="submit" className="btn-primary text-sm" disabled={mutation.isPending}>
          {mutation.isPending ? 'Adding…' : 'Add allocation'}
        </button>
      </div>
    </form>
  );
}
