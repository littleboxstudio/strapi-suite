import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Button,
  Checkbox,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import FetchApplicablePromotions from '../../../usecases/orders/fetchApplicablePromotions';
import { formatCents } from '../../../utils/money';
import {
  apiErrorMessageId,
  promotionDisplayName,
  type PromotionLocales,
} from '../../../utils/orderDetail';
import { describeBenefit } from '../../../utils/promotionForm';
import {
  applyDiscountBlock,
  applyDiscountRows,
  toggleId,
  type ApplyDiscountRow,
} from '../../../utils/createOrder';
import StackingReason from '../StackingReason';
import type {
  ApplicablePromotions,
  ApplicablePromotionsInput,
  AppliedPromotion,
} from '../../../orderTypes';
import EmptyNote from '../EmptyNote';

type Props = {
  /** The cart as the quote prices it. */
  input: ApplicablePromotionsInput;
  /** The promotions selected now (checked when the modal opens). */
  selected: number[];
  /** The last quote's promotions: names of selected ones no longer listed. */
  known: AppliedPromotion[];
  locales: PromotionLocales;
  onClose: () => void;
  onConfirm: (ids: number[]) => void;
};

const cell = { verticalAlign: 'middle' } as const;
const amountCell = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;
const WRAP = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;

/**
 * Create order's Apply discount, like the order's Recalculate discounts: the automatic promotions
 * that apply to this cart, each with a checkbox and what it gives. Only the checked ones are
 * applied (nothing is applied by itself).
 */
const ApplyDiscountModal = ({ input, selected, known, locales, onClose, onConfirm }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [result, setResult] = useState<ApplicablePromotions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<number[]>(selected);

  useEffect(() => {
    let cancelled = false;
    new FetchApplicablePromotions()
      .execute(input)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(apiErrorMessageId(err, 'ecommerce.orders.new.applicableError'));
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowView = (row: ApplyDiscountRow) => {
    const checked = selection.includes(row.id);
    const name = promotionDisplayName(row, locales.locale, locales.defaultLocale) ?? row.name;
    // Not stackable with a code, the manual discount or a checked promotion: disabled, with why.
    const block = result && row.listed ? applyDiscountBlock(result, selection, row) : null;
    const gift = (result?.giftOptions ?? []).find((g) => g.promotionId === row.id);
    const giftVariant = gift?.variants.find((v) => v.variantId === gift.selectedVariantId);
    return (
      <Tr key={row.id}>
        <Td style={cell}>
          <Checkbox
            checked={checked}
            aria-label={name}
            disabled={block !== null && !checked}
            onCheckedChange={() => setSelection((s) => toggleId(s, row.id))}
          />
        </Td>
        <Td style={{ ...cell, ...WRAP }}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Flex gap={2} wrap="wrap">
              <Typography textColor={block ? 'neutral500' : 'neutral800'} fontWeight="semiBold">
                {name}
              </Typography>
              {row.recommended && <Badge active>{t('ecommerce.orders.discounts.recommended')}</Badge>}
            </Flex>
            {block && <StackingReason block={block} locales={locales} />}
            {giftVariant && (
              <Typography variant="pi" textColor="neutral600">
                {t(
                  (gift?.variants.length ?? 0) > 1
                    ? 'ecommerce.orders.discounts.freeGiftChoice'
                    : 'ecommerce.orders.discounts.freeGift',
                  { name: giftVariant.option ? `${giftVariant.name} · ${giftVariant.option}` : giftVariant.name }
                )}
              </Typography>
            )}
            {name !== row.name && (
              <Typography variant="pi" textColor="neutral500">
                {t('ecommerce.orders.promotions.internalName', { name: row.name })}
              </Typography>
            )}
            {row.classes.length > 0 && (
              <Typography variant="pi" textColor="neutral600">
                {row.classes.map((c) => t(`ecommerce.orders.promotions.classes.${c}`)).join(', ')}
              </Typography>
            )}
            {!row.listed && (
              <Typography variant="pi" textColor="warning700">
                {t('ecommerce.orders.new.notApplicable')}
              </Typography>
            )}
          </Flex>
        </Td>
        <Td style={{ ...cell, maxWidth: 320, ...WRAP }}>
          <Flex direction="column" alignItems="flex-start" gap={1}>
            {row.benefits.map((b, i) => (
              <Typography key={i} textColor="neutral800" style={WRAP}>
                {describeBenefit(b, money, t)}
              </Typography>
            ))}
          </Flex>
        </Td>
        <Td style={amountCell}>
          <Typography
            textColor={checked ? 'neutral800' : 'neutral500'}
            fontWeight={checked ? 'semiBold' : undefined}
          >
            {row.amount === null ? '—' : money(row.amount ? -row.amount : 0)}
          </Typography>
        </Td>
      </Tr>
    );
  };

  const body = () => {
    if (loadError) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t(loadError)}
        </Typography>
      );
    }
    if (!result) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    const rows = applyDiscountRows(result.promotions, selected, known);
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {rows.length === 0 ? (
          <EmptyNote>{t('ecommerce.orders.new.applicableNone')}</EmptyNote>
        ) : (
          <Table colCount={4} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                <Th style={{ width: 56 }}>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.discounts.columns.select')}
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.discounts.columns.promotion')}
                  </Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">
                    {t('ecommerce.orders.promotions.columns.benefit')}
                  </Typography>
                </Th>
                <Th style={{ width: 120 }}>
                  <Typography
                    variant="sigma"
                    style={{ display: 'block', width: '100%', textAlign: 'right' }}
                  >
                    {t('ecommerce.orders.discounts.columns.amount')}
                  </Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>{rows.map(rowView)}</Tbody>
          </Table>
        )}
        {!result.exhaustive && (
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.orders.discounts.greedy')}
          </Typography>
        )}
      </Flex>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.new.applyDiscount')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          <Button
            variant="secondary"
            disabled={!result}
            onClick={() => {
              onConfirm(selection);
              onClose();
            }}
          >
            {t('ecommerce.orders.discounts.confirm')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ApplyDiscountModal;
