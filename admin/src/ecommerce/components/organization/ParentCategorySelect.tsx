import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Popover, TextInput, Typography } from '@strapi/design-system';
import { CaretDown, Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';

export type ParentOption = { id: number; label: string };

type Props = {
  /** The chosen parent, or null for a top-level category. */
  value: number | null;
  /** The categories it may go under, labelled with their full path, in tree order. */
  options: ParentOption[];
  onChange: (value: number | null) => void;
  hasError?: boolean;
  disabled?: boolean;
};

const HEIGHT = 38;

/**
 * A select for the parent category (38px tall, as the other fields of the module): its list opens
 * with a search bar on top that filters the categories by their path; "None (top level)" stays
 * first while nothing is typed.
 */
const ParentCategorySelect = ({ value, options, onChange, hasError, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.category';
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const rootLabel = t(`${p}.root`);
  const current = value === null ? rootLabel : options.find((o) => o.id === value)?.label ?? `#${value}`;

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    const all: { id: number | null; label: string }[] = [{ id: null, label: rootLabel }, ...options];
    return q ? all.filter((o) => o.id !== null && o.label.toLowerCase().includes(q)) : all;
  }, [term, options, rootLabel]);

  const toggle = (next: boolean) => {
    if (disabled) return;
    setOpen(next);
    if (next) setTerm('');
  };

  const choose = (id: number | null) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <Popover.Root open={open} onOpenChange={toggle}>
      <Popover.Trigger>
        <Flex
          ref={triggerRef}
          tag="button"
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          justifyContent="space-between"
          alignItems="center"
          gap={2}
          paddingLeft={4}
          paddingRight={3}
          hasRadius
          background={disabled ? 'neutral150' : 'neutral0'}
          borderColor={hasError ? 'danger600' : 'neutral200'}
          style={{
            width: '100%',
            height: HEIGHT,
            borderStyle: 'solid',
            borderWidth: 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'left',
          }}
        >
          <Typography textColor="neutral800" ellipsis>
            {current}
          </Typography>
          <CaretDown width="1.2rem" height="1.2rem" aria-hidden />
        </Flex>
      </Popover.Trigger>
      <Popover.Content
        align="start"
        sideOffset={4}
        style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 280 }}
      >
        <Box padding={2}>
          <TextInput
            aria-label={t(`${p}.parent.search`)}
            placeholder={t(`${p}.parent.search`)}
            startAction={<Search />}
            value={term}
            autoComplete="off"
            autoFocus
            style={{ height: HEIGHT }}
            onChange={(e: any) => setTerm(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              // Enter picks the only match.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (term.trim() && rows.length === 1) choose(rows[0].id);
              }
            }}
          />
        </Box>
        <Box style={{ maxHeight: 320, overflowY: 'auto' }} role="listbox">
          {rows.length === 0 && (
            <Box padding={3}>
              <Typography variant="omega" textColor="neutral600">
                {t(`${p}.parent.noResults`)}
              </Typography>
            </Box>
          )}
          {rows.map((row, i) => {
            const selected = row.id === value;
            return (
              <Box
                key={row.id ?? 'root'}
                role="option"
                aria-selected={selected}
                paddingTop={2}
                paddingBottom={2}
                paddingLeft={3}
                paddingRight={3}
                background={selected ? 'primary100' : undefined}
                borderColor="neutral150"
                onClick={() => choose(row.id)}
                style={{ cursor: 'pointer', borderStyle: 'solid', borderWidth: i > 0 ? '1px 0 0 0' : 0 }}
              >
                <Typography
                  textColor={selected ? 'primary600' : 'neutral800'}
                  style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
                >
                  {row.label}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
};

export { ParentCategorySelect };
