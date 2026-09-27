/**
 * Centralized Client Environment Configuration & Validation
 * Strict Client-Server Isolation: Only client-safe variables (prefixed with VITE_) are exposed.
 * Server-only secrets and database connection strings are strictly disallowed here.
 */

interface ClientEnv {
  readonly MODE: string;
  readonly IS_PRODUCTION: boolean;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_GLOBAL_MODE: boolean;
}

function resolveClientEnv(): ClientEnv {
  const mode = import.meta.env.MODE || 'development';
  const isProduction = mode === 'production';

  // Sanitize URLs to avoid trailing slashes
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const wsUrl = (import.meta.env.VITE_WS_URL || '').trim().replace(/\/+$/, '');
  const isGlobalMode = import.meta.env.VITE_GLOBAL_MODE === 'true';

  return {
    MODE: mode,
    IS_PRODUCTION: isProduction,
    VITE_API_BASE_URL: apiBaseUrl,
    VITE_WS_URL: wsUrl,
    VITE_GLOBAL_MODE: isGlobalMode,
  };
}

export const env = resolveClientEnv();
export default env;
