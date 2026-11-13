import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Dialog, Flex, IconButton, Loader, Modal, Typography } from '@strapi/design-system';
import { Information } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewShippingRecalculation from '../../usecases/orders/previewShippingRecalculation';
import RecalculateShipping from '../../usecases/orders/recalculateShipping';
import { formatCents } from '../../utils/money';
import { balanceChange, shippingLineRows } from '../../utils/orderEditing';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, Order, ShippingRecalculationPreview } from '../../orderTypes';
import ShippingChargesTable from './ShippingChargesTable';
import { Tile, Tiles } from './SummaryTiles';
import { FieldHelpModal } from '../settings/FieldHelpModal';

/** The four figures, each with its explanation (`shippingCharges.help.<key>`). */
type FigureKey = 'charged' | 'due' | 'previousShipments' | 'quote';

type Props = {
  order: Order;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
};

/**
 * Recalculate shipping (spec 6.3): the charged and due shipping (previous shipments + quote) and
 * the proposed charges. Confirm asks once more with what the customer will pay (or get back), then
 * applies it and closes (an unchanged result still clears the review flag). Mount it only while
 * open: each opening mints one operationId.
 */
const RecalculateShippingModal = ({ order, onClose, onSaved }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [operationId] = useState(() => mintUuid());
  const [preview, setPreview] = useState<ShippingRecalculationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The final confirmation, with the balance change, is open. */
  const [confirming, setConfirming] = useState(false);
  /** The figure whose explanation is open. */
  const [help, setHelp] = useState<FigureKey | null>(null);
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
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.saved') });
      onClose();
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.saveError')),
      });
    } finally {
      setBusy(false);
    }
  };

  const tile = (key: FigureKey, value: number, tone?: 'warning') => (
    <Tile $tone={tone}>
      <Flex justifyContent="space-between" alignItems="center" gap={1}>
        <Typography variant="sigma" textColor="neutral600">
          {t(`ecommerce.orders.shippingCharges.${key}`)}
        </Typography>
        <IconButton
          variant="ghost"
          size="XS"
          label={t('ecommerce.orders.shippingCharges.help.open', {
            field: t(`ecommerce.orders.shippingCharges.${key}`),
          })}
          onClick={() => setHelp(key)}
        >
          <Information />
        </IconButton>
      </Flex>
      <Typography variant="beta" tag="p" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
        {money(value)}
      </Typography>
    </Tile>
  );

  const change = preview ? balanceChange(preview.before, preview.after) : null;

  const body = () => {
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
        <Tiles>
          {tile('charged', preview.charged)}
          {tile('due', preview.due, preview.due !== preview.charged ? 'warning' : undefined)}
          {tile('previousShipments', preview.previousShipmentsCost)}
          {tile('quote', preview.quote)}
        </Tiles>
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
          <Button onClick={() => setConfirming(true)} disabled={!preview || busy}>
            {t('ecommerce.orders.shippingCharges.confirm')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      {help && (
        <FieldHelpModal
          title={t(`ecommerce.orders.shippingCharges.${help}`)}
          textKey={`ecommerce.orders.shippingCharges.help.${help}`}
          onClose={() => setHelp(null)}
        />
      )}
      {confirming && change && (
        // A short confirmation with what the customer will have to pay (or get back).
        <Dialog.Root open onOpenChange={(next: boolean) => !next && !busy && setConfirming(false)}>
          <Dialog.Content>
            <Dialog.Header>{t('ecommerce.orders.shippingCharges.confirmTitle')}</Dialog.Header>
            <Dialog.Body>
              <Typography
                variant="omega"
                textColor={change.outcome === 'DUE' ? 'warning600' : 'neutral800'}
                fontWeight={change.outcome === 'NONE' ? undefined : 'semiBold'}
                style={{ textAlign: 'center' }}
              >
                {t(`ecommerce.orders.products.outcome.${change.outcome}`, { amount: money(change.amount) })}
              </Typography>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex style={{ width: '100%' }} gap={2}>
                <Button fullWidth variant="tertiary" disabled={busy} onClick={() => setConfirming(false)}>
                  {t('ecommerce.orders.products.confirm.cancel')}
                </Button>
                <Button fullWidth loading={busy} onClick={confirm}>
                  {t('ecommerce.orders.shippingCharges.confirm')}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </Modal.Root>
  );
};

export default RecalculateShippingModal;
