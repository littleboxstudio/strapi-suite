import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, Loader, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewShippingRecalculation from '../../usecases/orders/previewShippingRecalculation';
import RecalculateShipping from '../../usecases/orders/recalculateShipping';
import { formatCents } from '../../utils/money';
import { shippingLineRows } from '../../utils/orderEditing';
import { apiErrorMessageId, type OrderActionPermissions, type ToolbarAction } from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, Order, ShippingRecalculationPreview } from '../../orderTypes';
import BalanceOutcome from './BalanceOutcome';
import ShippingChargesTable from './ShippingChargesTable';

type Props = {
  order: Order;
  permissions: OrderActionPermissions;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  onAction: (action: ToolbarAction) => void;
};

/**
 * Recalculate shipping (spec 6.3): the charged and due shipping, the proposed charges and the
 * totals before and after; Confirm applies it (an unchanged result still clears the review flag).
 * Mount it only while open: each opening mints one operationId.
 */
const RecalculateShippingModal = ({ order, permissions, onClose, onSaved, onAction }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [operationId] = useState(() => mintUuid());
  const [preview, setPreview] = useState<ShippingRecalculationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    new PreviewShippingRecalculation()
      .execute(order.id)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.previewError'));
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await new RecalculateShipping().execute(order.id, { operationId });
      onSaved(result);
      if (result.outcome === 'NONE') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.saved') });
        onClose();
      } else {
        setSaved(result);
      }
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.saveError')),
      });
    } finally {
      setBusy(false);
    }
  };

  const summary = (label: string, value: string, detail?: string) => (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Typography variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Typography variant="delta" tag="p">
        {value}
      </Typography>
      {detail && (
        <Typography variant="pi" textColor="neutral600">
          {detail}
        </Typography>
      )}
    </Flex>
  );

  const totals = preview
    ? [
        {
          label: t('ecommerce.orders.shippingCharges.shippingTotal'),
          before: preview.before.shippingTotal,
          after: preview.after.shippingTotal,
        },
        { label: t('ecommerce.orders.shippingCharges.total'), before: preview.before.total, after: preview.after.total },
        { label: t('ecommerce.orders.shippingCharges.balanceDue'), before: preview.before.due, after: preview.after.due },
      ]
    : [];

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
    if (loadError) {
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
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex gap={8} alignItems="flex-start" wrap="wrap">
          {summary(t('ecommerce.orders.shippingCharges.charged'), money(preview.charged))}
          {summary(
            t('ecommerce.orders.shippingCharges.due'),
            money(preview.due),
            t('ecommerce.orders.shippingCharges.dueDetail', {
              shipments: money(preview.previousShipmentsCost),
              quote: money(preview.quote),
            })
          )}
        </Flex>
        {preview.mode === 'UNCHANGED' ? (
          <Typography variant="omega" textColor="neutral700">
            {t('ecommerce.orders.shippingCharges.unchanged')}
          </Typography>
        ) : (
          <>
            <Typography variant="sigma" textColor="neutral700">
              {t('ecommerce.orders.shippingCharges.proposed')}
            </Typography>
            <ShippingChargesTable rows={shippingLineRows(preview.lines, order.editing, false)} />
            <Box tag="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th />
                  <th style={{ textAlign: 'right' }}>
                    <Typography variant="sigma">{t('ecommerce.orders.shippingCharges.before')}</Typography>
                  </th>
                  <th style={{ textAlign: 'right' }}>
                    <Typography variant="sigma">{t('ecommerce.orders.shippingCharges.after')}</Typography>
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map((row) => (
                  <tr key={row.label}>
                    <td style={{ padding: '4px 0' }}>
                      <Typography>{row.label}</Typography>
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
          </>
        )}
      </Flex>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.shippingCharges.recalculate')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.shippingCharges.close')}
          </Button>
          {!saved && (
            <Button onClick={confirm} loading={busy} disabled={!preview}>
              {t('ecommerce.orders.shippingCharges.confirm')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default RecalculateShippingModal;
