import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { maskSecret } from '../../app/setting';
import { EcommerceSecretError } from './errors';

export { maskSecret };

export type EncryptedValue = { v: 1; iv: string; tag: string; data: string };

const ALGORITHM = 'aes-256-gcm';

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function resolveEncryptionKey(strapi: any): Buffer | null {
  const config: any = strapi.config.get('plugin::littlebox-strapi-suite');
  const raw = clean(config?.ecommerce?.encryptionKey) ?? clean(process.env.LTB_ECOMMERCE_ENCRYPTION_KEY);
  if (!raw) return null;
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string, key: Buffer): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptSecret(value: EncryptedValue, key: Buffer): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new EcommerceSecretError('SECRET_UNREADABLE');
  }
}

export function isMaskedEcho(input: string, stored: string): boolean {
  return input === maskSecret(stored);
}
