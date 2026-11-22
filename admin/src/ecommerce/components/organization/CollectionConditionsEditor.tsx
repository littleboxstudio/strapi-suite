import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Combobox,
  ComboboxOption,
  Field,
  Flex,
  IconButton,
  Radio,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from '../orders/EmptyNote';
import MarkedSentence from '../promotions/MarkedSentence';
import SearchVendors from '../../usecases/organization/searchVendors';
import {
  COLLECTION_FIELDS,
  describeCollectionConditions,
  isIdField,
  isMoneyField,
  isTextField,
  operatorsForField,
  setConditionField,
  type CollectionConditionForm,
  type CollectionLabels,
} from '../../utils/collectionForm';
import { markValue } from '../../utils/promotionForm';
import type { CollectionField, CollectionMatch, CollectionOperator } from '../../organizationTypes';

const VENDOR_DEBOUNCE_MS = 300;

export type ConditionOptions = {
  /** Every category, labelled with its full path, in tree order. */
  categories: { id: number; label: string }[];
  productTypes: { id: number; label: string }[];
  tags: { id: number; label: string }[];
};

/** A text field with the existing vendors as suggestions (any text can still be typed). */
const VendorInput = ({
  value,
  onChange,
  hasError,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  hasError?: boolean;
  disabled?: boolean;
  label: string;
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const requestId = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      new SearchVendors()
        .execute(value.trim() || undefined)
        .then((list) => {
          if (current === requestId.current) setSuggestions(Array.isArray(list) ? list : []);
        })
        .catch(() => {
          if (current === requestId.current) setSuggestions([]);
        });
    }, VENDOR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return (
    <Combobox
      aria-label={label}
      allowCustomValue
      autocomplete="none"
      value={value}
      textValue={value}
      hasError={hasError}
      disabled={disabled}
      onTextValueChange={(text: string) => onChange(text)}
      onChange={(picked?: string) => onChange(picked ?? '')}
      onClear={() => onChange('')}
    >
      {suggestions.map((s) => (
        <ComboboxOption key={s} value={s}>
          {s}
        </ComboboxOption>
      ))}
    </Combobox>
  );
};

type Props = {
  match: CollectionMatch;
  conditions: CollectionConditionForm[];
  onChange: (patch: { match?: CollectionMatch; conditions?: CollectionConditionForm[] }) => void;
  /** path -> code, server paths (`conditions`, `conditions.<i>.value`, `match`). */
  errors: Record<string, string>;
  options: ConditionOptions;
  labels: CollectionLabels;
  disabled?: boolean;
};

/**
 * An automated collection's conditions: "all" / "any", one row per condition (field, operator,
 * value with a picker for category, type and tag) and the plain-words sentence.
 */
const CollectionConditionsEditor = ({ match, conditions, onChange, errors, options, labels, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.collection.conditions';
  const D = 'ecommerce.organization.collection.describe';

  const errorText = (path: string) => {
    const code = errors[path];
    if (!code) return undefined;
    if (path === 'conditions' && (code === 'required' || code === 'too_many')) return t(`${p}.${code}`);
    return t(`ecommerce.organization.errors.${code}`);
  };

  const setRow = (index: number, row: CollectionConditionForm) =>
    onChange({ conditions: conditions.map((c, i) => (i === index ? row : c)) });

  const idOptions = (field: CollectionField) =>
    field === 'CATEGORY' ? options.categories : field === 'PRODUCT_TYPE' ? options.productTypes : options.tags;

  const valueInput = (c: CollectionConditionForm, index: number) => {
    const path = `conditions.${index}.value`;
    const set = (value: string) => setRow(index, { ...c, value });
    if (isIdField(c.field)) {
      return (
        <Field.Root name={path} error={errorText(path)}>
          <Field.Label>{t(`${p}.fields.${c.field}`)}</Field.Label>
          <Combobox
            // Remounted when the list arrives, so a saved choice shows its name.
            key={idOptions(c.field).length}
            value={c.value || undefined}
            placeholder={t(`${p}.choose`)}
            hasError={!!errors[path]}
            disabled={disabled}
            noOptionsMessage={() => t(`${p}.noOptions`)}
            onChange={(value?: string) => set(value ?? '')}
            onClear={() => set('')}
          >
            {idOptions(c.field).map((o) => (
              <ComboboxOption key={o.id} value={String(o.id)}>
                {o.label}
              </ComboboxOption>
            ))}
          </Combobox>
          <Field.Error />
        </Field.Root>
      );
    }
    if (c.field === 'VENDOR') {
      return (
        <Field.Root name={path} error={errorText(path)}>
          <Field.Label>{t(`${p}.value`)}</Field.Label>
          <VendorInput
            value={c.value}
            onChange={set}
            hasError={!!errors[path]}
            disabled={disabled}
            label={t(`${p}.value`)}
          />
          <Field.Error />
        </Field.Root>
      );
    }
    const money = isMoneyField(c.field);
    const label = money ? t(`${p}.amount`) : c.field === 'INVENTORY' ? t(`${p}.quantity`) : t(`${p}.value`);
    return (
      <Field.Root name={path} error={errorText(path)}>
        <Field.Label>{label}</Field.Label>
        <TextInput
          value={c.value}
          disabled={disabled}
          inputMode={money ? 'decimal' : c.field === 'INVENTORY' ? 'numeric' : 'text'}
          endAction={money ? <Typography textColor="neutral600">€</Typography> : undefined}
          onChange={(e: any) => set(e.target.value)}
        />
        <Field.Error />
      </Field.Root>
    );
  };

  const hint = (field: CollectionField) => {
    if (field === 'CATEGORY') return t(`${p}.categoryHint`);
    if (isMoneyField(field) || field === 'INVENTORY') return t(`${p}.variantHint`);
    return null;
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="pi" fontWeight="bold" textColor="neutral800">
          {t(`${p}.matchLabel`)}
        </Typography>
        <Radio.Group
          value={match}
          disabled={disabled}
          aria-label={t(`${p}.matchLabel`)}
          onValueChange={(value: string) => onChange({ match: value === 'ANY' ? 'ANY' : 'ALL' })}
        >
          <Flex gap={6}>
            <Radio.Item value="ALL">{t(`${p}.match.ALL`)}</Radio.Item>
            <Radio.Item value="ANY">{t(`${p}.match.ANY`)}</Radio.Item>
          </Flex>
        </Radio.Group>
        {errors.match && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {errorText('match')}
          </Typography>
        )}
      </Flex>

      {conditions.length === 0 && <EmptyNote>{t(`${p}.empty`)}</EmptyNote>}

      {conditions.map((c, index) => {
        const base = `conditions.${index}`;
        const rowHint = hint(c.field);
        return (
          <Box
            key={c.key}
            data-scroll-id={`condition-${c.key}`}
            padding={3}
            hasRadius
            borderColor="neutral200"
            background="neutral0"
            style={{ scrollMarginTop: 80 }}
          >
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Flex gap={3} alignItems="flex-end" wrap="wrap">
                <Box style={{ minWidth: 180, flex: '1 1 180px' }}>
                  <Field.Root name={`${base}.field`} error={errorText(`${base}.field`)}>
                    <Field.Label>{t(`${p}.field`)}</Field.Label>
                    <SingleSelect
                      value={c.field}
                      disabled={disabled}
                      onChange={(value: string | number) => setRow(index, setConditionField(c, String(value) as CollectionField))}
                    >
                      {COLLECTION_FIELDS.map((field) => (
                        <SingleSelectOption key={field} value={field}>
                          {t(`${p}.fields.${field}`)}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <Field.Error />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 160, flex: '1 1 160px' }}>
                  <Field.Root name={`${base}.operator`} error={errorText(`${base}.operator`)}>
                    <Field.Label>{t(`${p}.operator`)}</Field.Label>
                    <SingleSelect
                      value={c.operator}
                      disabled={disabled}
                      onChange={(value: string | number) =>
                        setRow(index, { ...c, operator: String(value) as CollectionOperator })
                      }
                    >
                      {operatorsForField(c.field).map((op) => (
                        <SingleSelectOption key={op} value={op}>
                          {t(`${D}.operators.${isTextField(c.field) || isIdField(c.field) ? 'text' : 'number'}.${op}`)}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <Field.Error />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 200, flex: '2 1 200px' }}>{valueInput(c, index)}</Box>
                <IconButton
                  label={t(`${p}.remove`)}
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onChange({ conditions: conditions.filter((_, i) => i !== index) })}
                >
                  <Trash />
                </IconButton>
              </Flex>
              {rowHint && (
                <Typography variant="pi" textColor="neutral600">
                  {rowHint}
                </Typography>
              )}
            </Flex>
          </Box>
        );
      })}

      {errors.conditions && (
        <Typography variant="pi" textColor="danger600" role="alert">
          {errorText('conditions')}
        </Typography>
      )}

      {conditions.length > 0 && (
        <MarkedSentence text={describeCollectionConditions({ match, conditions }, t, labels, markValue)} />
      )}
    </Flex>
  );
};

export default CollectionConditionsEditor;
