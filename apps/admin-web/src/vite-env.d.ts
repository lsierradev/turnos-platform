/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEV_TOKEN?: string;
  /** Zona IANA del taller; debe coincidir con TZ_NEGOCIO del backend. */
  readonly VITE_TZ_NEGOCIO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
