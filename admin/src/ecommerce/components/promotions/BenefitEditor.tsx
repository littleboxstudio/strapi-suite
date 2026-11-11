import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Radio,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import TargetPicker from './TargetPicker';
import {
  BENEFIT_TYPES,
  emptyBenefit,
  errorUnder,
  MAX_GIFT_VARIANTS,
  type BenefitForm,
  type PromotionErrors,
} from '../../utils/promotionForm';
import type { PromotionBenefitType, PromotionLabels } from '../../promotionTypes';

type Props = {
  benefit: BenefitForm;
  index: number;
  onChange: (benefit: BenefitForm) => void;
  onRemove: () => void;
  labels: PromotionLabels;
  onLabels: (labels: PromotionLabels) => void;
  errors: PromotionErrors;
  /** Description of the benefit (from `describeBenefit`). */
  summary: string;
  disabled?: boolean;
};

const PERCENT_TYPES: PromotionBenefitType[] = ['PRODUCT_PERCENT', 'ORDER_PERCENT', 'SHIPPING_PERCENT'];
const AMOUNT_TYPES: PromotionBenefitType[] = ['PRODUCT_FIXED', 'ORDER_FIXED', 'SHIPPING_FIXED'];

const Cell = ({ children, width = 200 }: { children: ReactNode; width?: number }) => (
  <Box style={{ minWidth: width, flex: `1 1 ${width}px` }}>{children}</Box>
);

/** One benefit, with the fields of its type; error paths follow the server (`benefits.<i>.buy.quantity`). */
const BenefitEditor = ({ benefit, index, onChange, onRemove, labels, onLabels, errors, summary, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.promotions.form.benefits';
  const base = `benefits.${index}`;
  const errorText = (code: string | undefined) => (code ? t(`ecommerce.promotions.form.errors.${code}`) : undefined);
  const targetError = (path: string) => {
    const code = errorUnder(errors, path);
    return code === 'required' ? t('ecommerce.promotions.form.target.required') : errorText(code);
  };
  const set = (patch: Partial<BenefitForm>) => onChange({ ...benefit, ...patch });

  const text = (
    field: 'percent' | 'amount' | 'maxQuantity' | 'maxAmount' | 'buyQuantity' | 'buyMinAmount' | 'getQuantity' | 'rewardPercent' | 'rewardAmount',
    path: string,
    label: string,
    options: { hint?: string; required?: boolean } = {}
  ) => (
    <Field.Root name={`${base}.${path}`} error={errorText(errors[`${base}.${path}`])} hint={options.hint} required={options.required}>
      <Field.Label>{label}</Field.Label>
      <TextInput
        value={benefit[field]}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e: any) => set({ [field]: e.target.value } as Partial<BenefitForm>)}
      />
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );

  const changeType = (type: PromotionBenefitType) => {
    // Keep what the admin typed that still applies; the key keeps the React identity.
    onChange({ ...emptyBenefit(type), key: benefit.key, target: benefit.target, percent: benefit.percent, amount: benefit.amount });
  };

  return (
    <Box padding={4} hasRadius borderColor="neutral200" background="neutral0">
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-end" gap={3} wrap="wrap">
          <Cell width={260}>
            <Field.Root name={`${base}.type`} error={errorText(errors[`${base}.type`])}>
              <Field.Label>{t(`${p}.title`, { index: index + 1 })}</Field.Label>
              <SingleSelect
                value={benefit.type}
                disabled={disabled}
                onChange={(value: string | number) => changeType(String(value) as PromotionBenefitType)}
              >
                {BENEFIT_TYPES.map((type) => (
                  <SingleSelectOption key={type} value={type}>
                    {t(`${p}.types.${type}`)}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Error />
            </Field.Root>
          </Cell>
          {!disabled && (
            <Button variant="danger-light" size="S" startIcon={<Trash />} onClick={onRemove}>
              {t(`${p}.remove`)}
            </Button>
          )}
        </Flex>

        {errors[base] && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {errorText(errors[base])}
          </Typography>
        )}

        {(benefit.type === 'PRODUCT_PERCENT' || benefit.type === 'PRODUCT_FIXED') && (
          <TargetPicker
            target={benefit.target}
            labels={labels}
            onLabels={onLabels}
            onChange={(target) => set({ target })}
            error={targetError(`${base}.target`)}
            disabled={disabled}
          />
        )}

        <Flex gap={3} alignItems="flex-start" wrap="wrap">
          {PERCENT_TYPES.includes(benefit.type) && <Cell>{text('percent', 'percent', t(`${p}.percent`), { required: true })}</Cell>}
          {AMOUNT_TYPES.includes(benefit.type) && <Cell>{text('amount', 'amount', t(`${p}.amount`), { required: true })}</Cell>}
          {benefit.type === 'PRODUCT_FIXED' && (
            <Cell width={260}>
              <Field.Root name={`${base}.per`} error={errorText(errors[`${base}.per`])}>
                <Field.Label>{t(`${p}.per`)}</Field.Label>
                <SingleSelect
                  value={benefit.per}
                  disabled={disabled}
                  onChange={(value: string | number) => set({ per: String(value) as BenefitForm['per'] })}
                >
                  <SingleSelectOption value="UNIT">{t(`${p}.per.UNIT`)}</SingleSelectOption>
                  <SingleSelectOption value="SET">{t(`${p}.per.SET`)}</SingleSelectOption>
                </SingleSelect>
                <Field.Error />
              </Field.Root>
            </Cell>
          )}
          {(benefit.type === 'PRODUCT_PERCENT' || benefit.type === 'PRODUCT_FIXED') && (
            <Cell>{text('maxQuantity', 'maxQuantity', t(`${p}.maxQuantity`), { hint: t(`${p}.noLimit`) })}</Cell>
          )}
          {benefit.type === 'SHIPPING_FREE' && (
            <Cell>{text('maxAmount', 'maxAmount', t(`${p}.maxAmount`), { hint: t(`${p}.maxAmount.hint`) })}</Cell>
          )}
        </Flex>

        {benefit.type === 'BUY_X_GET_Y' && (
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Typography variant="sigma" textColor="neutral700">
                {t(`${p}.buy`)}
              </Typography>
              <TargetPicker
                target={benefit.buyTarget}
                labels={labels}
                onLabels={onLabels}
                onChange={(buyTarget) => set({ buyTarget })}
                error={targetError(`${base}.buy.target`)}
                disabled={disabled}
              />
              <Flex gap={3} alignItems="flex-start" wrap="wrap">
                <Cell>{text('buyQuantity', 'buy.quantity', t(`${p}.quantity`), { required: true })}</Cell>
                <Cell width={260}>{text('buyMinAmount', 'buy.minAmount', t(`${p}.buyMinAmount`))}</Cell>
              </Flex>
            </Flex>

            <Flex direction="column" alignItems="stretch" gap={3}>
              <Typography variant="sigma" textColor="neutral700">
                {t(`${p}.get`)}
              </Typography>
              <Radio.Group
                value={benefit.getMode}
                disabled={disabled}
                aria-label={t(`${p}.get`)}
                onValueChange={(value: string) => set({ getMode: value as BenefitForm['getMode'] })}
              >
                <Radio.Item value="IN_CART">{t(`${p}.getMode.IN_CART`)}</Radio.Item>
                <Radio.Item value="GIFT">{t(`${p}.getMode.GIFT`)}</Radio.Item>
              </Radio.Group>
              {benefit.getMode === 'IN_CART' ? (
                <TargetPicker
                  target={benefit.getTarget}
                  labels={labels}
                  onLabels={onLabels}
                  onChange={(getTarget) => set({ getTarget })}
                  error={targetError(`${base}.get.target`)}
                  disabled={disabled}
                />
              ) : (
                <TargetPicker
                  label={t(`${p}.giftVariants`)}
                  target={{ productIds: [], variantIds: benefit.getVariantIds }}
                  labels={labels}
                  onLabels={onLabels}
                  onChange={(target) => set({ getVariantIds: target.variantIds })}
                  variantsOnly
                  max={MAX_GIFT_VARIANTS}
                  error={
                    errorUnder(errors, `${base}.get.variantIds`) ? t(`${p}.giftVariants.required`) : undefined
                  }
                  disabled={disabled}
                />
              )}
              <Flex gap={3} alignItems="flex-start" wrap="wrap">
                <Cell>{text('getQuantity', 'get.quantity', t(`${p}.quantity`), { required: true })}</Cell>
                <Cell width={240}>
                  <Field.Root name={`${base}.reward.kind`} error={errorText(errors[`${base}.reward.kind`])}>
                    <Field.Label>{t(`${p}.reward`)}</Field.Label>
                    <SingleSelect
                      value={benefit.rewardKind}
                      disabled={disabled}
                      onChange={(value: string | number) =>
                        set({ rewardKind: String(value) as BenefitForm['rewardKind'] })
                      }
                    >
                      {(['FREE', 'PERCENT', 'FIXED'] as const).map((kind) => (
                        <SingleSelectOption key={kind} value={kind}>
                          {t(`${p}.reward.${kind}`)}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <Field.Error />
                  </Field.Root>
                </Cell>
                {benefit.rewardKind === 'PERCENT' && (
                  <Cell>{text('rewardPercent', 'reward.percent', t(`${p}.percent`), { required: true })}</Cell>
                )}
                {benefit.rewardKind === 'FIXED' && (
                  <Cell>{text('rewardAmount', 'reward.amount', t(`${p}.amount`), { required: true })}</Cell>
                )}
              </Flex>
            </Flex>
          </Flex>
        )}

        {summary && (
          <Typography variant="pi" textColor="neutral600">
            {summary}
          </Typography>
        )}
      </Flex>
    </Box>
  );
};

export default BenefitEditor;
