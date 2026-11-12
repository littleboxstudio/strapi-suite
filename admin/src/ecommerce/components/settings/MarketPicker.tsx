import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { Box, Button, Checkbox, Flex, Popover, TextInput, Typography } from '@strapi/design-system';
import { Plus, Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';

type Props = {
  /** The markets that can be picked, with their names. */
  options: { code: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  hasError?: boolean;
};

/** One market's block: header/footer-coloured background, 20px between blocks. */
const MarketCard = styled.div`
  background: ${({ theme }) => theme.colors.neutral100};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 8px 12px 12px;

  & + & {
    margin-top: 20px;
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

/** Folds accents and case, so "espanha" finds "Espanha" and "Sverige" finds "sverige". */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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

export { MarketPicker, MarketCard };
