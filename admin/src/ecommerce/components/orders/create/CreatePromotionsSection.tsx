import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import {
  codeStatusBadgeVariant,
  type PromotionLocales,
  type PromotionRow,
} from '../../../utils/orderDetail';
import type { ManualLineDiscountRow } from '../../../utils/orderEditing';
import type {
  ApplicablePromotionsInput,
  AppliedPromotion,
  ManualDiscountInput,
  PromotionCodeStatus,
} from '../../../orderTypes';
import CreateManualDiscountModal from '../CreateManualDiscountModal';
import DiscountsTable, { type ManualDiscountTableRow } from '../DiscountsTable';
import EmptyNote from '../EmptyNote';
import OrderSection from '../OrderSection';
import { ToneBadge } from '../StatusBadges';
import AddCodeModal from './AddCodeModal';
import ApplyDiscountModal from './ApplyDiscountModal';
import SectionError from './SectionError';

type Props = {
  /** The quote's promotions (selected automatic ones and applied codes), one row per benefit. */
  rows: PromotionRow[];
  manualRows: ManualDiscountTableRow[];
  lineRows: ManualLineDiscountRow[];
  /** The total discount; null while it is being calculated. */
  total: number | null;
  /** The rows are the last quote's: being calculated again, or that quote failed. */
  staleNote?: { text: string; color: string } | null;
  error?: string | null;
  /** The added codes the quote did not apply, with their status (null: not checked yet). */
  unapplied: { code: string; status: PromotionCodeStatus | null }[];
  codes: string[];
  selectedIds: number[];
  /** The last quote's promotions, to name a selected one no longer applicable. */
  known: AppliedPromotion[];
  locales: PromotionLocales;
  disabled?: boolean;
  canAddDiscount: boolean;
  /** Apply discount needs products to price. */
  canApply: boolean;
  /** The subtotal a percentage applies to; null without a quote. */
  percentBase: number | null;
  applicableInput: () => ApplicablePromotionsInput;
  onAddDiscount: (input: ManualDiscountInput) => void;
  onApplyIds: (ids: number[]) => void;
  onAddCodes: (codes: string[]) => void;
  /** Removes a promotion row: its code, or the automatic promotion from the selection. */
  onRemovePromotion: (row: PromotionRow) => void;
  onRemoveCode: (code: string) => void;
};

type ModalKind = 'ADD_DISCOUNT' | 'APPLY' | 'CODE';

/**
 * Create order's promotions and discounts: the order's table (the selected promotions, the manual
 * discounts and the codes), with Add discount, Apply discount and Add code. Nothing is applied by
 * itself.
 */
const CreatePromotionsSection = ({
  rows,
  manualRows,
  lineRows,
  total,
  staleNote,
  error,
  unapplied,
  codes,
  selectedIds,
  known,
  locales,
  disabled,
  canAddDiscount,
  canApply,
  percentBase,
  applicableInput,
  onAddDiscount,
  onApplyIds,
  onAddCodes,
  onRemovePromotion,
  onRemoveCode,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [modal, setModal] = useState<ModalKind | null>(null);

  // One Remove per promotion, on its first benefit's row.
  const firstRows = new Set<string>();
  const seen = new Set<number>();
  rows.forEach((r) => {
    if (!seen.has(r.promotionId)) {
      seen.add(r.promotionId);
      firstRows.add(r.key);
    }
  });
  const hasRows = rows.length + manualRows.length + lineRows.length > 0;

  const actions = (
    <Flex gap={2} alignItems="center">
      <Button
        size="S"
        variant="secondary"
        disabled={disabled || !canAddDiscount}
        onClick={() => setModal('ADD_DISCOUNT')}
      >
        {t('ecommerce.orders.discounts.add')}
      </Button>
      <Button
        size="S"
        variant="secondary"
        disabled={disabled || !canApply}
        onClick={() => setModal('APPLY')}
      >
        {t('ecommerce.orders.new.applyDiscount')}
      </Button>
      <Button size="S" variant="secondary" disabled={disabled} onClick={() => setModal('CODE')}>
        {t('ecommerce.orders.new.addCode')}
      </Button>
    </Flex>
  );

  return (
    <OrderSection title={t('ecommerce.orders.detail.sections.promotions')} actions={actions}>
      <SectionError text={error} />
      {hasRows && staleNote && (
        <Typography variant="pi" textColor={staleNote.color}>
          {staleNote.text}
        </Typography>
      )}
      {hasRows ? (
        <DiscountsTable
          rows={rows}
          manualRows={manualRows}
          lineRows={lineRows}
          total={total}
          showActions={rows.length > 0 || manualRows.length > 0}
          showTotal={false}
          rowAction={(row) =>
            firstRows.has(row.key) ? (
              <Button
                size="S"
                variant="danger-light"
                disabled={disabled}
                onClick={() => onRemovePromotion(row)}
              >
                {t('ecommerce.orders.discounts.remove')}
              </Button>
            ) : null
          }
        />
      ) : (
        unapplied.length === 0 && <EmptyNote>{t('ecommerce.orders.new.promotionsEmpty')}</EmptyNote>
      )}
      {unapplied.length > 0 && (
        <Flex direction="column" alignItems="stretch" gap={2}>
          <Typography variant="sigma" textColor="neutral600">
            {t('ecommerce.orders.new.codesNotApplied')}
          </Typography>
          {unapplied.map((c) => (
            <Flex key={c.code} gap={2} alignItems="center" wrap="wrap">
              <Typography textColor="neutral800" fontWeight="semiBold">
                {c.code}
              </Typography>
              {c.status && (
                <ToneBadge variant={codeStatusBadgeVariant(c.status)}>
                  {formatMessage({
                    id: getTranslation(`ecommerce.orders.promotions.codeStatus.${c.status}`),
                    defaultMessage: c.status,
                  })}
                </ToneBadge>
              )}
              <Button
                size="S"
                variant="danger-light"
                disabled={disabled}
                onClick={() => onRemoveCode(c.code)}
              >
                {t('ecommerce.orders.discounts.remove')}
              </Button>
            </Flex>
          ))}
        </Flex>
      )}

      {modal === 'ADD_DISCOUNT' && (
        <CreateManualDiscountModal
          percentBase={percentBase}
          onClose={() => setModal(null)}
          onAdd={onAddDiscount}
        />
      )}
      {modal === 'APPLY' && (
        <ApplyDiscountModal
          input={applicableInput()}
          selected={selectedIds}
          known={known}
          locales={locales}
          onClose={() => setModal(null)}
          onConfirm={onApplyIds}
        />
      )}
      {modal === 'CODE' && (
        <AddCodeModal
          codes={codes}
          locales={locales}
          onClose={() => setModal(null)}
          onAdd={onAddCodes}
        />
      )}
    </OrderSection>
  );
};

export default CreatePromotionsSection;
