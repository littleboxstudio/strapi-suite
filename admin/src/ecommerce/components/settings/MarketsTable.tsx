import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Combobox,
  ComboboxOption,
  Field,
  Flex,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { addAllMarkets, addMarket, marketRows, removeMarket } from '../../utils/markets';

type Props = {
  value: string[];
  countries: { code: string; name: string }[];
  readOnly: boolean;
  error?: string;
  onChange: (markets: string[]) => void;
};

/**
 * Markets (countries the store sells to) as a full-width table: pick a country and add it, add every
 * country at once, and remove countries row by row or all together. Changes are saved with the page.
 */
const MarketsTable = ({ value, countries, readOnly, error, onChange }: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(`ecommerce.settings.${id}`) }, values);
  const [pick, setPick] = useState<string>('');
  /** Remounts the picker after an add so its typed text is cleared too. */
  const [pickerKey, setPickerKey] = useState(0);

  const rows = useMemo(() => marketRows(value, countries, locale), [value, countries, locale]);
  const available = useMemo(
    () => countries.filter((c) => !value.includes(c.code)),
    [countries, value]
  );

  const add = () => {
    onChange(addMarket(value, pick));
    setPick('');
    setPickerKey((k) => k + 1);
  };

  return (
    <Field.Root name="markets" required error={error} hint={t('store.markets.hint')}>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Field.Label>{t('store.markets')}</Field.Label>

        {!readOnly && (
          <Flex gap={2} alignItems="flex-end" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 240 }}>
              <Combobox
                key={pickerKey}
                aria-label={t('markets.select')}
                placeholder={t('markets.select')}
                value={pick}
                onChange={(code: string | undefined) => setPick(code ?? '')}
                onClear={() => setPick('')}
                disabled={available.length === 0}
              >
                {available.map(({ code, name }) => (
                  <ComboboxOption key={code} value={code}>
                    {name}
                  </ComboboxOption>
                ))}
              </Combobox>
            </Box>
            <Button startIcon={<Plus />} onClick={add} disabled={!pick}>
              {t('markets.add')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                onChange(
                  addAllMarkets(
                    value,
                    countries.map((c) => c.code)
                  )
                )
              }
              disabled={available.length === 0}
            >
              {t('markets.addAll')}
            </Button>
            <Button
              variant="danger-light"
              onClick={() => onChange([])}
              disabled={value.length === 0}
            >
              {t('markets.removeAll')}
            </Button>
          </Flex>
        )}

        {rows.length === 0 ? (
          <Box padding={6} background="neutral100" hasRadius>
            <Typography variant="omega" textColor="neutral600">
              {t('markets.empty')}
            </Typography>
          </Box>
        ) : (
          <Table colCount={readOnly ? 2 : 3} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t('markets.country')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('markets.code')}</Typography>
                </Th>
                {!readOnly && (
                  <Th>
                    <Typography variant="sigma" textColor="neutral600">
                      {t('markets.count', { count: rows.length })}
                    </Typography>
                  </Th>
                )}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map(({ code, name }) => (
                <Tr key={code}>
                  <Td>
                    <Typography textColor="neutral800">{name}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral600">{code}</Typography>
                  </Td>
                  {!readOnly && (
                    <Td>
                      <Flex justifyContent="flex-end">
                        <IconButton
                          label={t('markets.remove', { country: name })}
                          variant="ghost"
                          onClick={() => onChange(removeMarket(value, code))}
                        >
                          <Trash />
                        </IconButton>
                      </Flex>
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}

        <Field.Error />
        <Field.Hint />
      </Flex>
    </Field.Root>
  );
};

export { MarketsTable };
