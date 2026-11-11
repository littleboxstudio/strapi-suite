import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { toAddress, type AddressForm } from '../../utils/orderForm';
import {
  addressChanged,
  countLines,
  discountWarningMessage,
  type ModifyOrderForm,
} from '../../utils/modification';
import type { ModificationPreview } from '../../orderTypes';

type Props = {
  preview: ModificationPreview;
  /** The draft that was previewed: line names and addresses. */
  form: ModifyOrderForm;
};

const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <Flex direction="column" alignItems="stretch" gap={2}>
    <Typography variant="delta" tag="h3">
      {title}
    </Typography>
    {children}
  </Flex>
);

const addressLine = (a: AddressForm) => {
  const x = toAddress(a, true);
  return [
    [x.firstName, x.lastName].join(' '),
    x.company,
    x.nif,
    x.line1,
    x.line2,
    [x.postalCode, x.city].join(' '),
    x.country,
    x.phone,
  ]
    .filter((v) => !!v && !!v.trim())
    .join(', ');
};

/** What a modification will change, as returned by `modification/preview` (requirement 16.15). */
const ModificationSummary = ({ preview, form }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  const nameOf = (orderLineId: number | undefined, variantId: number) => {
    const line =
      orderLineId !== undefined
        ? form.lines.find((l) => l.orderLineId === orderLineId)
        : form.lines.find((l) => l.orderLineId === undefined && l.variantId === variantId);
    const fallback = form.lines.find((l) => l.variantId === variantId);
    const l = line ?? fallback;
    if (!l) return `#${variantId}`;
    return l.option ? `${l.name} — ${l.option}` : l.name;
  };

  const { before, after } = preview;
  const counts = countLines(preview.lineChanges);
  const rows: { key: string; before: string; after: string }[] = [
    { key: 'products', before: String(counts.before.products), after: String(counts.after.products) },
    { key: 'units', before: String(counts.before.units), after: String(counts.after.units) },
    { key: 'subtotal', before: money(before.subtotal), after: money(after.subtotal) },
    ...(before.orderDiscount || after.orderDiscount
      ? [
          {
            key: 'orderDiscount',
            before: money(before.orderDiscount ? -before.orderDiscount : 0),
            after: money(after.orderDiscount ? -after.orderDiscount : 0),
          },
        ]
      : []),
    { key: 'shipping', before: money(before.shippingTotal), after: money(after.shippingTotal) },
    { key: 'total', before: money(before.total), after: money(after.total) },
    { key: 'paid', before: money(before.paid), after: money(after.paid) },
  ];

  const changes = preview.lineChanges.filter((c) => c.kind !== 'UNCHANGED');
  const changedAddresses = (
    [
      ['shipping', form.shippingAddress, form.originalShippingAddress],
      ['billing', form.billingAddress, form.originalBillingAddress],
    ] as const
  ).filter(([, value, original]) => addressChanged(value, original));

  const { shipping } = preview;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Table colCount={3} rowCount={rows.length + 1}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">{t('ecommerce.orders.modify.summary.item')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.orders.modify.summary.before')}</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">{t('ecommerce.orders.modify.summary.after')}</Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => (
            <Tr key={row.key}>
              <Td>
                <Typography textColor="neutral800">{t(`ecommerce.orders.modify.summary.${row.key}`)}</Typography>
              </Td>
              <Td>
                <Typography textColor="neutral700">{row.before}</Typography>
              </Td>
              <Td>
                <Typography
                  textColor="neutral800"
                  fontWeight={row.before !== row.after ? 'bold' : undefined}
                >
                  {row.after}
                </Typography>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Box
        padding={4}
        hasRadius
        background={
          preview.outcome === 'DUE' ? 'warning100' : preview.outcome === 'REFUNDABLE' ? 'success100' : 'neutral100'
        }
      >
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography fontWeight="bold" textColor="neutral800">
            {t('ecommerce.orders.modify.summary.difference', {
              amount: `${preview.difference > 0 ? '+' : ''}${money(preview.difference)}`,
            })}
          </Typography>
          <Typography textColor="neutral700">
            {preview.outcome === 'DUE'
              ? t('ecommerce.orders.modify.summary.outcome.DUE', { amount: money(after.due) })
              : preview.outcome === 'REFUNDABLE'
                ? t('ecommerce.orders.modify.summary.outcome.REFUNDABLE', { amount: money(after.excess) })
                : t('ecommerce.orders.modify.summary.outcome.NONE')}
          </Typography>
        </Flex>
      </Box>

      <Block title={t('ecommerce.orders.modify.summary.productChanges')}>
        {changes.length ? (
          changes.map((c, i) => (
            <Typography key={i} textColor="neutral800">
              {t(`ecommerce.orders.modify.summary.change.${c.kind}`, {
                name: nameOf(c.orderLineId, c.variantId),
                previous: c.previousQuantity,
                next: c.newQuantity,
              })}
            </Typography>
          ))
        ) : (
          <Typography textColor="neutral600">{t('ecommerce.orders.modify.summary.noProductChanges')}</Typography>
        )}
      </Block>

      {changedAddresses.length > 0 && (
        <Block title={t('ecommerce.orders.modify.summary.addresses')}>
          {changedAddresses.map(([kind, value]) => (
            <Typography key={kind} textColor="neutral800">
              {t(`ecommerce.orders.detail.address.${kind}`)}: {addressLine(value)}
            </Typography>
          ))}
        </Block>
      )}

      <Block title={t('ecommerce.orders.modify.summary.shipping')}>
        <Typography textColor="neutral800">
          {t('ecommerce.orders.modify.summary.shippingMode', {
            mode: t(`ecommerce.orders.modify.shipping.${shipping.mode}`),
          })}
        </Typography>
        <Typography textColor="neutral700">
          {t('ecommerce.orders.modify.summary.shippingCharged', {
            previous: money(shipping.previousCharged),
            next: money(shipping.newCharged),
          })}
        </Typography>
        {shipping.mode === 'RECALCULATE' && shipping.quote !== undefined && (
          <Typography textColor="neutral700">
            {t('ecommerce.orders.modify.summary.shippingQuote', { amount: money(shipping.quote) })}
          </Typography>
        )}
        {shipping.mode === 'RECALCULATE' && shipping.previousShipmentsCost !== undefined && (
          <Typography textColor="neutral700">
            {t('ecommerce.orders.modify.summary.previousShipmentsCost', {
              amount: money(shipping.previousShipmentsCost),
            })}
          </Typography>
        )}
      </Block>

      <Block title={t('ecommerce.orders.modify.summary.stock')}>
        {preview.stockMovements.length ? (
          preview.stockMovements.map((m) => (
            <Typography key={m.variantId} textColor="neutral800">
              {t(
                m.quantity < 0
                  ? 'ecommerce.orders.modify.summary.stockOut'
                  : 'ecommerce.orders.modify.summary.stockIn',
                { name: nameOf(undefined, m.variantId), count: Math.abs(m.quantity) }
              )}
            </Typography>
          ))
        ) : (
          <Typography textColor="neutral600">{t('ecommerce.orders.modify.summary.noStock')}</Typography>
        )}
      </Block>

      {preview.discountWarnings.length > 0 && (
        <Block title={t('ecommerce.orders.modify.summary.warnings')}>
          {preview.discountWarnings.map((w, i) => {
            const message = discountWarningMessage(w);
            return (
              <Typography key={i} textColor="warning600">
                {t(message.id, message.values)}
              </Typography>
            );
          })}
        </Block>
      )}
    </Flex>
  );
};

export default ModificationSummary;
