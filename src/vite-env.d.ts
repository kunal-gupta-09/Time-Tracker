/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "staging" in .env.staging.local; unset in production. */
  readonly VITE_ENV_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
