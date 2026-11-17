import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isUniqueViolation } from './dbErrors';
import { EcommerceValidationError } from './errors';
import { mergePaymentMethodNames, paymentMethodKey } from './domain/paymentMethodSuggestions';

/** Same limit as the payment's `methodLabel`. */
const MAX_NAME = 255;

type Row = { id: number; name: string; key: string; hidden?: boolean | null };

/**
 * Manual payment method texts offered in Add payment. Plain text only: a suggestion is never a
 * relation, the payment keeps its own `metadata.methodLabel`. A removed suggestion stays as a
 * `hidden` row for its key, because existing payments would otherwise bring it back.
 */
const EcommercePaymentMethodSuggestionService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const table = () => strapi.db.query(uids().paymentMethodSuggestion);
  const findByKey = (key: string): Promise<Row | null> => table().findOne({ where: { key } });

  /**
   * Inserts `{ name, key, hidden }`; on a unique violation (a concurrent insert of the same key)
   * runs `onConflict` with the row that won. Other errors propagate.
   */
  const insert = async (
    data: { name: string; key: string; hidden: boolean },
    onConflict: (row: Row) => Promise<void>
  ) => {
    try {
      await table().create({ data });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await findByKey(data.key);
      if (winner) await onConflict(winner);
    }
  };

  const setHidden = async (row: Row, hidden: boolean) => {
    if (Boolean(row.hidden) === hidden) return;
    await table().update({ where: { id: row.id }, data: { hidden } });
  };

  /**
   * A method confirmed on a manual payment: stored (trimmed, as first written) unless its key
   * exists; a hidden key is shown again. Errors propagate: the caller decides whether they matter.
   */
  const remember = async (text: unknown): Promise<void> => {
    const name = typeof text === 'string' ? text.trim() : '';
    const key = paymentMethodKey(name);
    if (!key || name.length > MAX_NAME) return;
    const existing = await findByKey(key);
    if (existing) return setHidden(existing, false);
    await insert({ name, key, hidden: false }, (row) => setHidden(row, false));
  };

  /**
   * Hides the method whose key matches `text` (a name or a key) from both sources. Idempotent:
   * an unknown key gets a hidden row too, so a later payment text never brings it back.
   */
  const remove = async (text: unknown): Promise<{ key: string; hidden: true }> => {
    const name = typeof text === 'string' ? text.trim() : '';
    const key = paymentMethodKey(name);
    if (!key || name.length > MAX_NAME) {
      throw new EcommerceValidationError('Invalid payment method suggestion', [
        { path: 'key', code: key ? 'too_long' : 'required' },
      ]);
    }
    const existing = await findByKey(key);
    if (existing) await setHidden(existing, true);
    else await insert({ name, key, hidden: true }, (row) => setHidden(row, true));
    return { key, hidden: true };
  };

  /**
   * Sorted names: the visible table rows plus the method texts of existing manual payments
   * (written before the table existed), deduplicated by key, without hidden keys. Method texts
   * only, never customer data.
   */
  const list = async (): Promise<{ names: string[] }> => {
    const u = uids();
    const [saved, payments] = await Promise.all([
      strapi.db.query(u.paymentMethodSuggestion).findMany({ select: ['name', 'key', 'hidden'] }),
      strapi.db.query(u.payment).findMany({ where: { method: 'MANUAL' }, select: ['metadata'] }),
    ]);
    const rows: Row[] = saved ?? [];
    const hiddenKeys = new Set(rows.filter((r) => r?.hidden).map((r) => r.key));
    const visible = (name: unknown) =>
      typeof name === 'string' && !hiddenKeys.has(paymentMethodKey(name.trim()));
    return {
      names: mergePaymentMethodNames(
        rows.filter((r) => !r?.hidden).map((r) => r?.name),
        (payments ?? []).map((p: any) => p?.metadata?.methodLabel).filter(visible)
      ),
    };
  };

  return { remember, remove, list };
};

export default EcommercePaymentMethodSuggestionService;
