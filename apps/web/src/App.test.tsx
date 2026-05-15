import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App.js';

// jsdom doesn't implement scrollTo etc; stub fetch to avoid real network.
vi.stubGlobal(
  'fetch',
  vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/api/me')) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/auth/config')) {
      return new Response(JSON.stringify({ providers: ['google'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }),
);

describe('App smoke', () => {
  it('redirects an unauthenticated user to the sign-in page', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Torii/i)).toBeInTheDocument());
    expect(await screen.findByText(/Sign in with Google/i)).toBeInTheDocument();
  });
});
