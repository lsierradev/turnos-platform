import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// NOTE: los casts a `any` en los argumentos de las funciones de `crypto` de
// aca abajo trabajan alrededor de un desajuste de tipos conocido entre
// TypeScript 5.7+ (Uint8Array<T> generico) y las definiciones de @types/node
// para Buffer (Uint8Array<ArrayBufferLike>) vs lo que pide CipherKey
// (Uint8Array<ArrayBuffer>). Es un falso positivo de tipos, no un problema
// de runtime: un Buffer siempre fue un argumento valido para estas funciones.

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY debe ser un string hexadecimal de 64 caracteres (32 bytes)',
    );
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey() as any, iv as any);
  const encrypted: Buffer = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ] as any);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decrypt(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey() as any,
    Buffer.from(ivHex, 'hex') as any,
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex') as any);
  const decrypted: Buffer = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex') as any),
    decipher.final(),
  ] as any);
  return decrypted.toString('utf8');
}
