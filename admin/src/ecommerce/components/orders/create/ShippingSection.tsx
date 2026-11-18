import { useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import { formatCents } from '../../../utils/money';
import { isStorePickupMethod } from '../../../utils/pickupPoints';
import { shippingLineError } from '../../../utils/createOrder';
import {
  MAX_CREATE_SHIPPING_LINES,
  type DraftShippingLine,
  type OrderErrorMap,
} from '../../../utils/orderForm';
import type { ShippingQuote } from '../../../orderTypes';
import ColumnLabel from '../../ColumnLabel';
import EmptyNote from '../EmptyNote';
import OrderSection from '../OrderSection';
import { ToneBadge } from '../StatusBadges';
import CreateShippingLineModal from './CreateShippingLineModal';
import SectionError from './SectionError';

type Props = {
  lines: DraftShippingLine[];
  errors: OrderErrorMap;
  /** The section's own error (none chosen, the destination refused), translated. */
  error?: string | null;
  codeText: (code: string) => string;
  pickupErrorText: (code: string, store: boolean) => string;
  /** Quotes the methods for the cart; the page refuses (and says why) when it cannot yet. */
  loadOptions: () => Promise<ShippingQuote>;
  /** False when the methods cannot be quoted yet (no country or no products): it says why. */
  canQuote: () => boolean;
  postalCode: string;
  disabled?: boolean;
  /** `index` null: a new line at the end. */
  onSave: (line: Omit<DraftShippingLine, 'key'>, index: number | null) => void;
  onRemove: (index: number) => void;
};

const COLUMNS = ['method', 'amount', 'actions'] as const;

/**
 * Create order's shipping: the charges of the new order, like the order's shipping section. The
 * first line is the delivery method (removing it promotes the next one).
 */
const ShippingSection = ({
  lines,
  errors,
  error,
  codeText,
  pickupErrorText,
  loadOptions,
  canQuote,
  postalCode,
  disabled,
  onSave,
  onRemove,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  /** The open modal: a new line (null) or the index of the line edited. */
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);

  const rowError = (index: number) => {
    const code = shippingLineError(errors, index);
    if (!code) return undefined;
    return code.startsWith('PICKUP_')
      ? pickupErrorText(code, isStorePickupMethod(lines[index]))
      : codeText(code);
  };

  const open = (index: number | null) => {
    if (canQuote()) setEditing({ index });
  };

  return (
    <OrderSection
      title={t('ecommerce.orders.shipping.title')}
      actions={
        <Button
          size="S"
          variant="secondary"
          disabled={disabled || lines.length >= MAX_CREATE_SHIPPING_LINES}
          onClick={() => open(null)}
        >
          {t('ecommerce.orders.new.shippingAdd')}
        </Button>
      }
    >
      <SectionError text={error} />
      {lines.length === 0 ? (
        <EmptyNote>{t('ecommerce.orders.new.shippingEmpty')}</EmptyNote>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table colCount={COLUMNS.length} rowCount={lines.length + 1}>
            <Thead>
              <Tr>
                {COLUMNS.map((c) => (
                  <Th key={c}>
                    <ColumnLabel column={c}>
                      {t(`ecommerce.orders.shippingCharges.columns.${c}`)}
                    </ColumnLabel>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {lines.map((line, index) => {
                const store = isStorePickupMethod(line);
                const message = rowError(index);
                return (
                  <Tr key={line.key}>
                    <Td style={{ whiteSpace: 'normal' }}>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Flex gap={2} alignItems="center" wrap="wrap">
                          <Typography textColor="neutral800" fontWeight="semiBold">
                            {line.name}
                          </Typography>
                          {index === 0 && (
                            <ToneBadge>{t('ecommerce.orders.new.deliveryMethod')}</ToneBadge>
                          )}
                        </Flex>
                        {line.requiresPickupPoint && line.pickup && (
                          <Typography variant="pi" textColor="neutral600">
                            {store
                              ? t('ecommerce.orders.pickup.store.current', {
                                  name: line.pickup.point.name,
                                })
                              : t('ecommerce.orders.pickup.current', {
                                  name: line.pickup.point.name,
                                  id: line.pickup.point.id,
                                })}
                          </Typography>
                        )}
                        {message && (
                          <Typography variant="pi" textColor="danger600" role="alert">
                            {message}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800" fontWeight="semiBold">
                        {formatCents(line.amount, locale)}
                      </Typography>
                    </Td>
                    <Td>
                      <Flex justifyContent="flex-end" gap={2}>
                        <Button
                          size="S"
                          variant="tertiary"
                          disabled={disabled}
                          onClick={() => open(index)}
                        >
                          {t('ecommerce.orders.shippingCharges.edit')}
                        </Button>
                        <Button
                          size="S"
                          variant="danger-light"
                          disabled={disabled}
                          onClick={() => onRemove(index)}
                        >
                          {t('ecommerce.orders.shippingCharges.remove')}
                        </Button>
                      </Flex>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}
      {editing && (
        <CreateShippingLineModal
          line={editing.index !== null ? lines[editing.index] : undefined}
          loadOptions={loadOptions}
          postalCode={postalCode}
          error={editing.index !== null ? rowError(editing.index) : undefined}
          pickupErrorText={pickupErrorText}
          codeText={codeText}
          onClose={() => setEditing(null)}
          onSave={(line) => onSave(line, editing.index)}
        />
      )}
    </OrderSection>
  );
};

export default ShippingSection;
