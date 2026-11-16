import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Loader, Modal, Radio, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewShippingRecalculation from '../../usecases/orders/previewShippingRecalculation';
import RecalculateShipping from '../../usecases/orders/recalculateShipping';
import DismissReviewFlag from '../../usecases/orders/dismissReviewFlag';
import { formatCents } from '../../utils/money';
import { shippingOptionKey } from '../../utils/orderEditing';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from './NoticeBar';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { mintUuid } from '../../utils/variantDraft';
import type {
  EditResult,
  Order,
  ShippingOption,
  ShippingRecalculationPreview,
} from '../../orderTypes';
import { Tile, Tiles } from './SummaryTiles';
import { FieldHelpModal } from '../settings/FieldHelpModal';

/** The figures, each with its explanation (`shippingCharges.help.<key>`). */
type FigureKey = 'charged' | 'invoiced' | 'quote';

type Props = {
  order: Order;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
};

/**
 * Recalculate shipping (spec 6.3), informative: the charged and invoiced shipping, the quote and
 * how much more should be charged (or was charged above). It never changes the charges. An order
 * shipped before products were added first asks for the method of those products (each pick
 * re-previews). When the charges match the quote, Confirm clears the review alert. Mount it only
 * while open: each opening mints one operationId.
 */
const RecalculateShippingModal = ({ order, onClose, onSaved }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [operationId] = useState(() => mintUuid());
  const [preview, setPreview] = useState<ShippingRecalculationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The figure whose explanation is open. */
  const [help, setHelp] = useState<FigureKey | null>(null);
  const [busy, setBusy] = useState(false);
  /** NEW_UNITS: the options offered for the added products (kept across picks) and the pick. */
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [picked, setPicked] = useState<ShippingOption | null>(null);
  const [loading, setLoading] = useState(true);

  const method = picked ? { providerId: picked.providerId, serviceId: picked.serviceId } : {};

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    new PreviewShippingRecalculation()
      .execute(order.id, method)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        if (p.options.length) setOptions(p.options);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.previewError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Loaded per opening and per pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  /** The shipping review alert is open: it can be marked as seen from here. */
  const hasReviewAlert = (order.reviewFlags ?? []).some((f) => f.code === 'SHIPPING_REVIEW');
  const [dismissing, setDismissing] = useState(false);

  /** Marks the shipping review alert as seen (dismissed), whatever the comparison shows. */
  const markSeen = async () => {
    if (dismissing || busy) return;
    setDismissing(true);
    try {
      onSaved(await new DismissReviewFlag().execute(order.id, 'SHIPPING_REVIEW', { operationId: mintUuid() }));
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.seen') });
      onClose();
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.review.dismissError')),
      });
    } finally {
      setDismissing(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await new RecalculateShipping().execute(order.id, { ...method, operationId });
      onSaved(result);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.reviewed') });
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

  /** A figure; clicking it (or Enter / Space on it) opens its explanation. */
  const tile = (key: FigureKey, value: number, tone?: 'warning') => (
    <Tile
      $tone={tone}
      role="button"
      tabIndex={0}
      aria-label={t('ecommerce.orders.shippingCharges.help.open', {
        field: t(`ecommerce.orders.shippingCharges.${key}`),
      })}
      style={{ cursor: 'pointer' }}
      onClick={() => setHelp(key)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setHelp(key);
        }
      }}
    >
      <Typography variant="sigma" textColor="neutral600">
        {t(`ecommerce.orders.shippingCharges.${key}`)}
      </Typography>
      <Typography variant="beta" tag="p" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
        {money(value)}
      </Typography>
    </Tile>
  );

  const difference = preview?.difference ?? 0;

  /** NEW_UNITS: the methods for the products added since the shipment. */
  const methodPicker = () => (
    <Field.Root name="method">
      <Field.Label>{t('ecommerce.orders.shippingCharges.pickMethod')}</Field.Label>
      {options.length ? (
        <Radio.Group
          value={picked ? shippingOptionKey(picked) : undefined}
          disabled={busy || loading}
          aria-label={t('ecommerce.orders.shippingCharges.method')}
          onValueChange={(key: string) => setPicked(options.find((o) => shippingOptionKey(o) === key) ?? null)}
        >
          {options.map((o) => (
            <Radio.Item key={shippingOptionKey(o)} value={shippingOptionKey(o)}>
              {o.name} · {money(o.price)}
            </Radio.Item>
          ))}
        </Radio.Group>
      ) : (
        <Typography variant="omega" textColor="neutral700">
          {t('ecommerce.orders.shippingCharges.noMethods')}
        </Typography>
      )}
    </Field.Root>
  );

  const body = () => {
    const picker = preview?.kind === 'NEW_UNITS' && (options.length > 0 || preview.needsMethod);
    if (loadError) {
      return (
        <Flex direction="column" alignItems="stretch" gap={4}>
          {picker && methodPicker()}
          <Typography variant="omega" textColor="danger600">
            {t(loadError)}
          </Typography>
        </Flex>
      );
    }
    if (!preview || (loading && !picker)) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {picker && methodPicker()}
        {loading ? (
          <Flex justifyContent="center" padding={4}>
            <Loader small />
          </Flex>
        ) : preview.needsMethod ? (
          <Typography variant="omega" textColor="neutral700">
            {t('ecommerce.orders.shippingCharges.pickMethodFirst')}
          </Typography>
        ) : (
          <>
            {/* One column per figure: Invoiced only on a whole-order recalculation. */}
            <Tiles
              style={{
                gridTemplateColumns: `repeat(${preview.kind === 'WHOLE_ORDER' ? 3 : 2}, minmax(0, 1fr))`,
              }}
            >
              {tile('charged', preview.charged)}
              {preview.kind === 'WHOLE_ORDER' && tile('invoiced', preview.invoiced)}
              {tile('quote', preview.quote, preview.quote !== preview.charged ? 'warning' : undefined)}
            </Tiles>
            {/* Informative: the charges never change; the admin decides what to add or refund. */}
            {difference === 0 ? (
              <Typography variant="omega" textColor="neutral700">
                {t('ecommerce.orders.shippingCharges.unchanged')}
              </Typography>
            ) : (
              <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
                <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
                  {t(
                    difference > 0
                      ? 'ecommerce.orders.shippingCharges.review.under'
                      : 'ecommerce.orders.shippingCharges.review.over',
                    { amount: money(Math.abs(difference)) }
                  )}
                </Typography>
              </Box>
            )}
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
          <Flex gap={2}>
            {hasReviewAlert && (
              <Button variant="secondary" onClick={markSeen} loading={dismissing} disabled={busy}>
                {t('ecommerce.orders.shippingCharges.markSeen')}
              </Button>
            )}
            {/* Only when the charges match the quote: confirming clears the review alert. */}
            {preview && !loading && !loadError && !preview.needsMethod && difference === 0 && (
              <Button onClick={confirm} loading={busy} disabled={dismissing}>
                {t('ecommerce.orders.shippingCharges.confirm')}
              </Button>
            )}
          </Flex>
        </Modal.Footer>
      </Modal.Content>
      {help && (
        <FieldHelpModal
          title={t(`ecommerce.orders.shippingCharges.${help}`)}
          textKey={`ecommerce.orders.shippingCharges.help.${help}`}
          onClose={() => setHelp(null)}
        />
      )}
    </Modal.Root>
  );
};

export default RecalculateShippingModal;
