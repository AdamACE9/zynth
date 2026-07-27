/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Backend origin when the frontend is deployed separately (Vercel + Render),
   * e.g. "https://zynth-api.onrender.com". Leave unset for local dev and any
   * single-origin deploy — calls then stay relative and Vite proxies them.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
