import { Fragment, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Checkbox, Flex, Loader, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewDiscounts from '../../usecases/orders/previewDiscounts';
import ApplyDiscounts from '../../usecases/orders/applyDiscounts';
import { formatCents } from '../../utils/money';
import {
  discountConflictNames,
  discountRowGroups,
  discountSelectionToggle,
} from '../../utils/orderEditing';
import {
  apiErrorMessageId,
  promotionDisplayName,
  type OrderActionPermissions,
  type PromotionLocales,
  type ToolbarAction,
} from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type { DiscountRecalculation, DiscountRow, EditResult, Order } from '../../orderTypes';
import BalanceOutcome from './BalanceOutcome';
import EmptyNote from './EmptyNote';

type Props = {
  order: Order;
  locales: PromotionLocales;
  permissions: OrderActionPermissions;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  onAction: (action: ToolbarAction) => void;
};

/** Wait after the last toggle before pricing the selection again. */
const PREVIEW_DELAY_MS = 300;

const cell = { padding: '8px 8px', verticalAlign: 'top' } as const;
const amountCell = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;

/**
 * Recalculate discounts (spec 7.1): the applied promotions (still valid or not), the ones that would
 * apply now and the manual discounts, each with a checkbox; the totals before and after follow the
 * selection. Nothing changes until Confirm. Mount it only while open: each opening mints one
 * operationId.
 */
const RecalculateDiscountsModal = ({
  order,
  locales,
  permissions,
  onClose,
  onSaved,
  onAction,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);
  const discount = (cents: number) => money(cents ? -cents : 0);

  const [operationId] = useState(() => mintUuid());
  const [preview, setPreview] = useState<DiscountRecalculation | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A re-preview is waiting or in flight: the shown totals and conflicts are not final yet. */
  const [pricing, setPricing] = useState(false);
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Prices `next`; only the newest request's answer is applied. */
  const load = (next?: string[]) => {
    const request = ++requestRef.current;
    new PreviewDiscounts()
      .execute(order.id, next ? { selection: next } : {})
      .then((p) => {
        if (request !== requestRef.current) return;
        setPreview(p);
        if (!next) setSelection(p.selection);
        setLoadError(null);
        setPricing(false);
      })
      .catch((err) => {
        if (request !== requestRef.current) return;
        setLoadError(apiErrorMessageId(err, 'ecommerce.orders.discounts.previewError'));
        setPricing(false);
      });
  };

  useEffect(() => {
    load();
    return () => {
      // Late answers after closing are ignored.
      requestRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (row: DiscountRow) => {
    if (busy) return;
    const next = discountSelectionToggle(selection, row);
    setSelection(next);
    setPricing(true);
    requestRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(next), PREVIEW_DELAY_MS);
  };

  const confirm = async () => {
    if (busy || pricing || !preview || preview.conflicts.length > 0) return;
    setBusy(true);
    try {
      const result = await new ApplyDiscounts().execute(order.id, { selection, operationId });
      onSaved(result);
      if (result.outcome === 'NONE') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.discounts.saved') });
        onClose();
      } else {
        setSaved(result);
      }
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.discounts.saveError')),
      });
    } finally {
      setBusy(false);
    }
  };

  /** A manual row's label: its reason, or the translated reason of the migrated adjustment. */
  const nameOf = (row: DiscountRow): string => {
    if (row.kind === 'MANUAL') {
      const legacy =
        (order.manualDiscounts ?? []).find((m) => m.id === row.manualId)?.kind === 'LEGACY';
      return legacy ? t('ecommerce.orders.discounts.legacyReason') : row.name;
    }
    return promotionDisplayName(row, locales.locale, locales.defaultLocale) ?? row.name;
  };

  const rowView = (row: DiscountRow) => {
    const checked = selection.includes(row.key);
    const name = nameOf(row);
    return (
      <tr key={row.key}>
        <td style={cell}>
          <Checkbox
            checked={checked}
            disabled={busy || row.locked !== null}
            aria-label={name}
            onCheckedChange={() => toggle(row)}
          />
        </td>
        <td style={cell}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Typography textColor="neutral800" fontWeight="semiBold">
              {name}
            </Typography>
            {row.kind !== 'MANUAL' && name !== row.name && (
              <Typography variant="pi" textColor="neutral500">
                {t('ecommerce.orders.promotions.internalName', { name: row.name })}
              </Typography>
            )}
            <Typography variant="pi" textColor="neutral600">
              {row.kind === 'MANUAL'
                ? t('ecommerce.orders.discounts.manual')
                : t(`ecommerce.promotions.methods.${row.method}`)}
              {row.code ? ` · ${row.code}` : ''}
            </Typography>
            {row.kind === 'APPLIED_INVALID' && (
              <Typography variant="pi" textColor="warning700">
                {t('ecommerce.orders.discounts.invalidToday')}
                {row.invalidReason
                  ? ` (${formatMessage({
                      id: getTranslation(`ecommerce.orders.discounts.reason.${row.invalidReason}`),
                      defaultMessage: row.invalidReason,
                    })})`
                  : ''}
              </Typography>
            )}
            {row.locked === 'GIFT_SHIPPED' && (
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.discounts.giftShipped')}
              </Typography>
            )}
          </Flex>
        </td>
        <td style={amountCell}>
          <Typography textColor="neutral600">
            {row.currentAmount === null ? '—' : discount(row.currentAmount)}
          </Typography>
        </td>
        <td style={amountCell}>
          <Typography
            textColor={checked ? 'neutral800' : 'neutral500'}
            fontWeight={checked ? 'semiBold' : undefined}
          >
            {discount(row.amount)}
          </Typography>
        </td>
      </tr>
    );
  };

  const body = () => {
    if (saved) {
      return (
        <BalanceOutcome
          order={saved.order}
          outcome={saved.outcome as 'DUE' | 'REFUNDABLE'}
          permissions={permissions}
          onAction={onAction}
        />
      );
    }
    if (loadError && !preview) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t(loadError)}
        </Typography>
      );
    }
    if (!preview) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    const groups = discountRowGroups(preview.rows);
    const totals = [
      {
        key: 'subtotal',
        before: preview.before.subtotal - preview.before.orderDiscount,
        after: preview.after.subtotal - preview.after.orderDiscount,
      },
      { key: 'shipping', before: preview.before.shippingTotal, after: preview.after.shippingTotal },
      { key: 'total', before: preview.before.total, after: preview.after.total },
      { key: 'due', before: preview.before.due, after: preview.after.due },
    ];
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {groups.length === 0 ? (
          <EmptyNote>{t('ecommerce.orders.discounts.nothing')}</EmptyNote>
        ) : (
          <Box tag="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...cell, width: 56, textAlign: 'left' }}>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.discounts.columns.select')}
                  </Typography>
                </th>
                <th style={{ ...cell, textAlign: 'left' }}>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.discounts.columns.promotion')}
                  </Typography>
                </th>
                <th style={{ ...cell, textAlign: 'right' }}>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.discounts.columns.current')}
                  </Typography>
                </th>
                <th style={{ ...cell, textAlign: 'right' }}>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.discounts.columns.amount')}
                  </Typography>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.kind}>
                  <tr>
                    <td colSpan={4} style={{ ...cell, paddingTop: 16 }}>
                      <Typography variant="sigma" textColor="neutral600">
                        {t(`ecommerce.orders.discounts.group.${g.kind}`)}
                      </Typography>
                    </td>
                  </tr>
                  {g.rows.map(rowView)}
                </Fragment>
              ))}
            </tbody>
          </Box>
        )}
        {!preview.exhaustive && (
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.orders.discounts.greedy')}
          </Typography>
        )}
        {preview.conflicts.length > 0 && (
          <Box padding={3} background="danger100" borderColor="danger200" hasRadius>
            <Typography textColor="danger700">
              {t('ecommerce.orders.discounts.conflict', {
                names: discountConflictNames(preview.conflicts, preview.rows, nameOf).join(', '),
              })}
            </Typography>
          </Box>
        )}
        {loadError && (
          <Typography variant="omega" textColor="danger600">
            {t(loadError)}
          </Typography>
        )}
        <Box
          tag="table"
          style={{ width: '100%', borderCollapse: 'collapse', opacity: pricing ? 0.5 : 1 }}
        >
          <thead>
            <tr>
              <th />
              <th style={{ textAlign: 'right' }}>
                <Typography variant="sigma">{t('ecommerce.orders.discounts.current')}</Typography>
              </th>
              <th style={{ textAlign: 'right' }}>
                <Typography variant="sigma">{t('ecommerce.orders.discounts.after')}</Typography>
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.map((row) => (
              <tr key={row.key}>
                <td style={{ padding: '4px 0' }}>
                  <Typography>{t(`ecommerce.orders.discounts.totals.${row.key}`)}</Typography>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Typography textColor="neutral600">{money(row.before)}</Typography>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Typography fontWeight="semiBold">{money(row.after)}</Typography>
                </td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Flex>
    );
  };

  const blocked = !preview || pricing || !!loadError || preview.conflicts.length > 0;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.discounts.recalculate')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          {!saved && (
            <Button onClick={confirm} loading={busy} disabled={blocked}>
              {t('ecommerce.orders.discounts.confirm')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default RecalculateDiscountsModal;
