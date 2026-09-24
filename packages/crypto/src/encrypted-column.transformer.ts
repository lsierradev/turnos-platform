import { decrypt, encrypt } from './encryption.util';

/**
 * Transformer de columna compatible con el `ValueTransformer` de TypeORM
 * (duck-typed a proposito para no depender de `typeorm` en este paquete).
 */
export const encryptedColumnTransformer = {
  to: (value?: string | null): string | null | undefined =>
    value == null ? value : encrypt(value),
  from: (value?: string | null): string | null | undefined =>
    value == null ? value : decrypt(value),
};
