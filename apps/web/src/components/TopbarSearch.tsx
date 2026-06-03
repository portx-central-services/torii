import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type SearchResults } from '../api/endpoints.js';

/** One item in the dropdown — a clickable, keyboard-selectable navigation target. */
interface FlatItem {
  key: string;
  group: 'Projects' | 'Customers' | 'People';
  label: string;
  href: string;
  sublabel?: string;
}

function flatten(results: SearchResults | undefined): FlatItem[] {
  if (!results) return [];
  const items: FlatItem[] = [];
  for (const p of results.projects) {
    items.push({
      key: `project:${p.id}`,
      group: 'Projects',
      label: p.name,
      href: `/projects/${p.id}`,
      sublabel: `${p.phase} · ${p.state}`,
    });
  }
  for (const c of results.customers) {
    items.push({
      key: `customer:${c.id}`,
      group: 'Customers',
      label: c.name,
      href: `/customers/${c.id}`,
    });
  }
  for (const u of results.people) {
    items.push({
      key: `person:${u.id}`,
      group: 'People',
      label: u.name,
      href: `/people/${u.id}`,
      sublabel: `${u.role}${u.isAdmin ? ' · Admin' : ''}`,
    });
  }
  return items;
}

export function TopbarSearch() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounce the input → query value (200ms feels responsive but doesn't thrash).
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(raw.trim()), 200);
    return () => window.clearTimeout(id);
  }, [raw]);

  const query = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => endpoints.search(debounced),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });

  const items = useMemo(() => flatten(query.data), [query.data]);

  // Click-outside to close.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Reset highlight whenever the results change.
  useEffect(() => {
    setHighlight(0);
  }, [items.length]);

  function go(item: FlatItem) {
    navigate(item.href);
    setOpen(false);
    setRaw('');
    setDebounced('');
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = items[highlight];
      if (picked) go(picked);
    }
  }

  const showDropdown =
    open &&
    debounced.length > 0 &&
    (query.isLoading || query.isError || items.length > 0 || query.isSuccess);

  // Build grouped sections for rendering.
  const groups: Array<{ name: FlatItem['group']; items: FlatItem[] }> = [];
  for (const item of items) {
    let group = groups.find((g) => g.name === item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return (
    <div className="topbar-search-wrap" ref={wrapRef}>
      <label className="topbar-search">
        <span>Search</span>
        <input
          ref={inputRef}
          placeholder="Projects, customers, people"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => raw.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
      </label>
      {showDropdown && (
        <div className="topbar-search-dropdown" role="listbox">
          {query.isLoading && <div className="topbar-search-status">Searching…</div>}
          {query.isError && (
            <div className="topbar-search-status topbar-search-error">
              Search failed: {(query.error as Error).message}
            </div>
          )}
          {query.isSuccess && items.length === 0 && (
            <div className="topbar-search-status">No matches for "{debounced}"</div>
          )}
          {groups.map((group) => (
            <div key={group.name} className="topbar-search-group">
              <div className="topbar-search-group-label">{group.name}</div>
              {group.items.map((item) => {
                const flatIndex = items.indexOf(item);
                const isHighlighted = flatIndex === highlight;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    className={`topbar-search-item${isHighlighted ? ' active' : ''}`}
                    onMouseEnter={() => setHighlight(flatIndex)}
                    onMouseDown={(e) => {
                      // Prevent the input's blur from firing before the click,
                      // which would close the dropdown and swallow the navigation.
                      e.preventDefault();
                      go(item);
                    }}
                  >
                    <span className="topbar-search-item-label">{item.label}</span>
                    {item.sublabel && (
                      <span className="topbar-search-item-sub">{item.sublabel}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
