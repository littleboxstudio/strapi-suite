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

/** Hard cap of rows deleted by one purge. */
export const TOKEN_PURGE_BATCH_MAX = 100;
/** Expired tokens are kept this long after expiry before the purge deletes them. */
export const TOKEN_PURGE_GRACE_MS = HOUR_MS;

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

    /**
     * Data retention: deletes up to `limit` (≤ 100) tokens expired for more than
     * `TOKEN_PURGE_GRACE_MS`, used or not (they hold an e-mail address and serve no purpose
     * once expired). Returns the rows deleted.
     */
    async purgeExpired(limit = TOKEN_PURGE_BATCH_MAX): Promise<number> {
      const take = Number.isFinite(limit)
        ? Math.max(0, Math.min(TOKEN_PURGE_BATCH_MAX, Math.floor(limit)))
        : 0;
      if (take === 0) return 0;
      const cutoff = new Date(Date.now() - TOKEN_PURGE_GRACE_MS);
      const rows: { id: number }[] = await query().findMany({
        where: { expiresAt: { $lt: cutoff } },
        select: ['id'],
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        limit: take,
      });
      if (rows.length === 0) return 0;
      return count(
        await query().deleteMany({
          where: { id: { $in: rows.map((r) => r.id) }, expiresAt: { $lt: cutoff } },
        })
      );
    },
  };
};

export default EcommerceCustomerTokenService;
