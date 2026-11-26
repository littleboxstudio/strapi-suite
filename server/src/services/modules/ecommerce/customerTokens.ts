import type { Core } from '@strapi/strapi';
import { createHash, randomBytes } from 'node:crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';

export type TokenPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'CHANGE_EMAIL';

const HOUR_MS = 3_600_000;
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  VERIFY_EMAIL: 24 * HOUR_MS,
  RESET_PASSWORD: HOUR_MS,
  CHANGE_EMAIL: 24 * HOUR_MS,
};

export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

const count = (r: unknown): number =>
  r && typeof r === 'object' && Number.isInteger((r as { count?: unknown }).count)
    ? ((r as { count: number }).count)
    : 0;

/** Single-use account tokens: only the sha256 hex of a token is stored, never the token. */
const EcommerceCustomerTokenService = ({ strapi }: { strapi: Core.Strapi }) => {
  const query = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return strapi.db.query(config.uuid.modules.ecommerce.customerToken);
  };

  return {
    /** A fresh token; the customer's earlier unused tokens of that purpose stop working. */
    async issue(
      customerId: number,
      purpose: TokenPurpose,
      email: string
    ): Promise<{ raw: string; expiresAt: string }> {
      const now = new Date();
      await query().updateMany({
        where: { customer: { id: customerId }, purpose, usedAt: { $null: true } },
        data: { usedAt: now },
      });
      const raw = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS[purpose]);
      await query().create({
        data: { customer: customerId, purpose, tokenHash: hashToken(raw), email, expiresAt },
      });
      return { raw, expiresAt: expiresAt.toISOString() };
    },

    /** Marks the token used in one conditional update; null when unknown, used, expired or of another purpose. */
    async consume(
      raw: unknown,
      purpose: TokenPurpose
    ): Promise<{ customerId: number; email: string } | null> {
      if (typeof raw !== 'string' || raw === '' || raw.length > 256) return null;
      const tokenHash = hashToken(raw);
      const now = new Date();
      const result = await query().updateMany({
        where: { tokenHash, purpose, usedAt: { $null: true }, expiresAt: { $gt: now } },
        data: { usedAt: now },
      });
      if (count(result) !== 1) return null;
      const row = await query().findOne({ where: { tokenHash }, populate: { customer: true } });
      if (!row?.customer) return null;
      return { customerId: row.customer.id, email: String(row.email ?? '') };
    },
  };
};

export default EcommerceCustomerTokenService;
