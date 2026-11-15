import { useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Field, Flex, IconButton, Typography } from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { FilteredMarkets, MarketPicker, MarketCard } from './MarketPicker';
import { BracketRows } from './BracketRows';
import { FillMarketsModal } from './FillMarketsModal';
import { marketOptions } from '../../utils/settingsForm';
import {
  fillAllMarkets,
  newBracketRows,
  type BracketDraft,
  type ManualMethodDraft,
} from '../../utils/manualMethodForm';

/** The part of a draft this editor changes. */
export type RatesDraft = Pick<ManualMethodDraft, 'markets' | 'brackets'>;

type Props = {
  /** The store markets; without any, only a notice is shown. */
  markets: string[];
  value: RatesDraft;
  /** Applies a change to the draft (functional, so quick edits are not lost). */
  onChange: (change: (current: RatesDraft) => RatesDraft) => void;
  /** Error code per path: `markets`, `rates`, `rates.<market>`, `rates.<market>.<i>.<field>`. */
  errors: Record<string, string>;
  /** Bumped when errors are shown: clears the market search so no market with an error is hidden. */
  errorRound: number;
  clearError: (path: string) => void;
  /** Drops every error at `prefix` or below it. */
  clearErrorsUnder: (prefix: string) => void;
  /** Whether at least one market must be chosen (manual methods; not DPD services). */
  required?: boolean;
  /** Shown instead of the search's "no match" text while no market is chosen (DPD services). */
  emptyText?: string;
  /** Extra content at the end of each market's card (Store pickup: the market's stores). */
  marketFooter?: (code: string, name: string) => ReactNode;
};

/**
 * The rate table of a shipping method: the markets it serves and the weight ranges of each
 * (shared by the manual methods and the DPD services).
 */
const MarketRatesEditor = ({
  markets,
  value,
  onChange,
  errors,
  errorRound,
  clearError,
  clearErrorsUnder,
  required = true,
  emptyText,
  marketFooter,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const islandsName = t('ecommerce.settings.markets.names.PT-ISL');
  const countries = useMemo(() => marketOptions(uiLocale, islandsName), [uiLocale, islandsName]);
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  /** The store markets, by country name. */
  const storeMarketOptions = useMemo(
    () => countries.filter((c) => markets.includes(c.code)),
    [countries, markets]
  );
  const [filling, setFilling] = useState(false);

  const errorText = (path: string) =>
    errors[path] ? t(`ecommerce.settings.errors.${errors[path]}`) : undefined;

  /** A newly selected market starts with one empty row; a reselected one keeps its rows. */
  const setMarkets = (next: string[]) => {
    onChange((d) => {
      const brackets = { ...d.brackets };
      next.forEach((code) => {
        if (!brackets[code]) brackets[code] = newBracketRows();
      });
      return { ...d, markets: next, brackets };
    });
    clearError('markets');
    clearError('rates');
    value.markets
      .filter((code) => !next.includes(code))
      .forEach((code) => clearErrorsUnder(`rates.${code}`));
  };

  const changeRows = (code: string, change: (rows: BracketDraft[]) => BracketDraft[]) =>
    onChange((d) => ({
      ...d,
      brackets: { ...d.brackets, [code]: change(d.brackets[code] ?? []) },
    }));

  const updateRow = (code: string, index: number, field: keyof BracketDraft, text: string) => {
    changeRows(code, (rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: text } : row))
    );
    clearError(`rates.${code}.${index}.${field}`);
    clearError(`rates.${code}`);
  };

  const addRow = (code: string) => {
    changeRows(code, (rows) => [...rows, ...newBracketRows()]);
    clearErrorsUnder(`rates.${code}`);
  };

  const removeRow = (code: string, index: number) => {
    changeRows(code, (rows) => rows.filter((_, i) => i !== index));
    clearErrorsUnder(`rates.${code}`);
  };

  const fillAll = (rows: BracketDraft[]) => {
    onChange((d) => fillAllMarkets(d, rows));
    clearErrorsUnder('rates');
    setFilling(false);
  };

  if (markets.length === 0) {
    return (
      <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
        <Typography textColor="neutral800">
          {t('ecommerce.settings.manual.noStoreMarkets')}
        </Typography>
      </Box>
    );
  }

  const ratesError = errorText('rates');
  const marketsError =
    errors.markets === 'required'
      ? t('ecommerce.settings.manual.marketsRequired')
      : errorText('markets');

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Field.Root name="markets" error={marketsError} required={required}>
        <Field.Label>{t('ecommerce.settings.manual.markets')}</Field.Label>
        <Flex gap={2} wrap="wrap">
          <MarketPicker
            options={storeMarketOptions}
            selected={value.markets}
            hasError={!!marketsError}
            onChange={setMarkets}
          />
          <Button
            variant="secondary"
            size="L"
            disabled={value.markets.length === markets.length}
            onClick={() =>
              setMarkets([
                ...value.markets,
                ...markets.filter((code) => !value.markets.includes(code)),
              ])
            }
          >
            {t('ecommerce.settings.manual.selectAll')}
          </Button>
          <Button
            variant="secondary"
            size="L"
            disabled={value.markets.length === 0}
            onClick={() => setFilling(true)}
          >
            {t('ecommerce.settings.manual.fillAll.open')}
          </Button>
          <Button
            variant="tertiary"
            size="L"
            disabled={value.markets.length === 0}
            onClick={() => setMarkets([])}
          >
            {t('ecommerce.settings.manual.clear')}
          </Button>
        </Flex>
        <Field.Error />
      </Field.Root>

      {ratesError && (
        <Typography variant="pi" textColor="danger600" role="alert">
          {ratesError}
        </Typography>
      )}

      {value.markets.length > 0 && (
        <Typography variant="pi" textColor="neutral600">
          {t('ecommerce.settings.manual.noLimit')}
        </Typography>
      )}

      <FilteredMarkets
        codes={value.markets}
        nameOf={countryName}
        resetKey={errorRound}
        emptyText={emptyText}
      >
        {(visibleMarkets) => (
          <Flex direction="column" alignItems="stretch">
            {visibleMarkets.map((code) => {
              const rows = value.brackets[code] ?? [];
              const marketError = errors[`rates.${code}`];
              return (
                <MarketCard key={code}>
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
                      <Typography variant="omega" fontWeight="bold" tag="h3">
                        {countryName(code)}
                      </Typography>
                      <Flex gap={1}>
                        <IconButton
                          label={`${t('ecommerce.settings.manual.addRange')}: ${countryName(code)}`}
                          variant="ghost"
                          onClick={() => addRow(code)}
                        >
                          <Plus />
                        </IconButton>
                        <IconButton
                          label={`${t('ecommerce.settings.manual.removeMarket')}: ${countryName(code)}`}
                          variant="ghost"
                          onClick={() => setMarkets(value.markets.filter((c) => c !== code))}
                        >
                          <Trash />
                        </IconButton>
                      </Flex>
                    </Flex>
                    <BracketRows
                      rows={rows}
                      label={countryName(code)}
                      errorText={(i, field) => errorText(`rates.${code}.${i}.${field}`)}
                      onChange={(i, field, text) => updateRow(code, i, field, text)}
                      onRemove={(i) => removeRow(code, i)}
                    />
                    {marketError && (
                      <Typography variant="pi" textColor="danger600" role="alert">
                        {marketError === 'required'
                          ? t('ecommerce.settings.manual.rangesRequired')
                          : errorText(`rates.${code}`)}
                      </Typography>
                    )}
                    {marketFooter?.(code, countryName(code))}
                  </Flex>
                </MarketCard>
              );
            })}
          </Flex>
        )}
      </FilteredMarkets>

      {filling && (
        <FillMarketsModal
          marketCount={value.markets.length}
          onClose={() => setFilling(false)}
          onApply={fillAll}
        />
      )}
    </Flex>
  );
};

export { MarketRatesEditor };
