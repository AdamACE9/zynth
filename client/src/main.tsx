import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Cross-origin API shim.
 *
 * Every screen calls the backend with a relative path (`fetch('/api/quiz')`),
 * which is exactly right in dev — Vite proxies /api to :3001 — and in any
 * single-origin deploy. But when the frontend is hosted apart from the backend
 * (Vercel + Render), those relative paths resolve against the *frontend* origin
 * and 404.
 *
 * Rewriting every call site would mean touching a dozen screens. Instead we
 * rewrite once, here, at the fetch boundary: any request starting with `/api/`
 * gets VITE_API_BASE prefixed. New screens inherit this for free, and nothing
 * changes when VITE_API_BASE is unset. (Socket.io is handled separately in
 * lib/socket.ts, since it doesn't route through fetch.)
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

if (API_BASE) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(`${API_BASE}${input}`, init);
    }
    if (input instanceof Request && new URL(input.url, location.origin).pathname.startsWith('/api/')) {
      const { pathname, search } = new URL(input.url, location.origin);
      return nativeFetch(new Request(`${API_BASE}${pathname}${search}`, input), init);
    }
    return nativeFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element (#root) not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
