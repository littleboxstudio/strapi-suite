import { Fragment } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { Field, Flex, IconButton, TextInput, Typography } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { BracketDraft } from '../../utils/manualMethodForm';

/**
 * Up to | Price | remove. A plain grid (not the design-system Table, whose scroll wrapper clips
 * the last row) so every cell starts on the same line.
 */
const RangeGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: start;
`;

type Props = {
  rows: BracketDraft[];
  /** Prefixes the inputs' accessible names (e.g. the country). */
  label: string;
  errorText: (index: number, field: keyof BracketDraft) => string | undefined;
  onChange: (index: number, field: keyof BracketDraft, text: string) => void;
  onRemove: (index: number) => void;
};

/** The weight ranges of one table; the last row cannot be removed. */
const BracketRows = ({ rows, label, errorText, onChange, onRemove }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  if (rows.length === 0) return null;
  return (
    <RangeGrid>
      <Typography variant="sigma" textColor="neutral600">
        {t('ecommerce.settings.manual.upTo')}
      </Typography>
      <Typography variant="sigma" textColor="neutral600">
        {t('ecommerce.settings.manual.price')}
      </Typography>
      <span />
      {rows.map((row, i) => (
        <Fragment key={i}>
          {(['upTo', 'price'] as const).map((field) => (
            <Field.Root key={field} name={`${label}.${i}.${field}`} error={errorText(i, field)}>
              <TextInput
                aria-label={`${label}: ${t(`ecommerce.settings.manual.${field}`)} (${i + 1})`}
                inputMode="decimal"
                value={row[field]}
                onChange={(e: any) => onChange(i, field, e.target.value)}
              />
              <Field.Error />
            </Field.Root>
          ))}
          {/* Same height as the inputs, so the button sits on their line. */}
          <Flex height="4rem" alignItems="center">
            <IconButton
              label={t('ecommerce.settings.manual.removeRange')}
              variant="ghost"
              disabled={rows.length === 1}
              onClick={() => onRemove(i)}
            >
              <Trash />
            </IconButton>
          </Flex>
        </Fragment>
      ))}
    </RangeGrid>
  );
};

export { BracketRows };
