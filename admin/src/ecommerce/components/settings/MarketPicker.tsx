import { useEffect, useMemo, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { Box, Button, Checkbox, Flex, Popover, TextInput, Typography } from '@strapi/design-system';
import { Plus, Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { filterMarketsByName, foldText } from '../../utils/markets';

type Props = {
  /** The markets that can be picked, with their names. */
  options: { code: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  hasError?: boolean;
};

/**
 * One market's block: bordered, on a subtle tint (the same half-strength primary100 as the market
 * row hover) so the border stays visible, with 20px between blocks.
 */
const MarketCard = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: color-mix(in srgb, ${({ theme }) => theme.colors.primary100} 50%, transparent);
  padding: 8px 12px 12px;

  & + & {
    margin-top: 20px;
  }
`;

/**
 * One row of a plain market list: a line between rows; highlighted on hover (or keyboard focus).
 */
const MarketRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 4px 12px;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
  }

  /*
   * The design system's hover colour (primary100) is the page background in the dark theme, too
   * strong inside a modal: half of it over the modal background keeps it subtle in both themes.
   */
  &:hover,
  &:focus-within {
    background: color-mix(in srgb, ${({ theme }) => theme.colors.primary100} 50%, transparent);
  }
`;

const List = styled.div`
  max-height: 280px;
  overflow-y: auto;
`;

const Row = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.primary100};
  }
`;

const fold = foldText;

/**
 * "Add markets" button with a searchable, multi-choice dropdown. The trigger does not list the
 * chosen markets: the method's market sections below it already show them.
 */
const MarketPicker = ({ options, selected, onChange, hasError = false }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return q
      ? options.filter((o) => fold(o.name).includes(q) || o.code.toLowerCase() === q)
      : options;
  }, [options, query]);

  const toggle = (code: string, checked: boolean) =>
    onChange(checked ? [...selected, code] : selected.filter((c) => c !== code));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Popover.Trigger>
        <Button
          variant={hasError ? 'danger-light' : 'secondary'}
          size="L"
          startIcon={<Plus />}
          aria-haspopup="listbox"
        >
          {t('ecommerce.settings.manual.addMarkets')}
        </Button>
      </Popover.Trigger>
      <Popover.Content style={{ width: 320 }}>
        <Box padding={2}>
          <TextInput
            autoFocus
            startAction={<Search />}
            aria-label={t('ecommerce.settings.manual.searchMarkets')}
            placeholder={t('ecommerce.settings.manual.searchMarkets')}
            value={query}
            onChange={(e: any) => setQuery(e.target.value)}
          />
        </Box>
        <List role="listbox" aria-multiselectable>
          <Box paddingLeft={2} paddingRight={2} paddingBottom={2}>
            {visible.length === 0 ? (
              <Box padding={2}>
                <Typography variant="omega" textColor="neutral600">
                  {t('ecommerce.settings.manual.noMarketMatch')}
                </Typography>
              </Box>
            ) : (
              visible.map(({ code, name }) => {
                const checked = selected.includes(code);
                return (
                  <Row key={code} role="option" aria-selected={checked}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next: boolean | 'indeterminate') =>
                        toggle(code, next === true)
                      }
                    />
                    <Flex gap={2} justifyContent="space-between" style={{ flex: 1 }}>
                      <Typography variant="omega">{name}</Typography>
                      <Typography variant="pi" textColor="neutral500">
                        {code}
                      </Typography>
                    </Flex>
                  </Row>
                );
              })
            )}
          </Box>
        </List>
      </Popover.Content>
    </Popover.Root>
  );
};

/** Search field shown above a list once it has more markets than this. */
const SEARCH_FROM = 3;
const SEARCH_DELAY_MS = 150;

type FilteredMarketsProps = {
  /** The chosen markets, in list order. */
  codes: string[];
  nameOf: (code: string) => string;
  /** Changing it clears the search (e.g. so markets with errors are not hidden). */
  resetKey?: unknown;
  children: (visible: string[]) => ReactNode;
};

/**
 * A full-width search by market name above the list, only with 3 or more markets; the filter
 * runs 150 ms after the last key press.
 */
const FilteredMarkets = ({ codes, nameOf, resetKey, children }: FilteredMarketsProps) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    setText('');
    setQuery('');
  }, [resetKey]);

  const searchable = codes.length >= SEARCH_FROM;
  const visible = searchable ? filterMarketsByName(codes, nameOf, query) : codes;

  return (
    <>
      {searchable && (
        <Box paddingBottom={4}>
          <TextInput
            startAction={<Search />}
            aria-label={t('ecommerce.settings.manual.searchMarkets')}
            placeholder={t('ecommerce.settings.manual.searchMarkets')}
            value={text}
            onChange={(e: any) => setText(e.target.value)}
          />
        </Box>
      )}
      {visible.length === 0 ? (
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.settings.manual.noMarketMatch')}
        </Typography>
      ) : (
        children(visible)
      )}
    </>
  );
};

export { MarketPicker, MarketCard, MarketRow, FilteredMarkets };
