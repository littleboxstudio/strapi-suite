import styled from 'styled-components';
import { Flex } from '@strapi/design-system';

type Props = {
  locales: { code: string; name: string }[];
  defaultLocale: string;
  value: string;
  onChange: (code: string) => void;
  /** Locales that already have content get a dot. */
  isFilled?: (code: string) => boolean;
  label: string;
};

const LocaleButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral200)};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral0)};
  color: ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral800)};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  cursor: pointer;
  text-transform: uppercase;
`;

const FilledDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.success500};
`;

const LocaleSwitcher = ({ locales, defaultLocale, value, onChange, isFilled, label }: Props) => (
  <Flex role="tablist" aria-label={label} gap={1} wrap="wrap">
    {locales.map(({ code, name }) => (
      <LocaleButton
        key={code}
        type="button"
        role="tab"
        title={name}
        aria-selected={value === code}
        $active={value === code}
        onClick={() => onChange(code)}
      >
        {code}
        {code === defaultLocale && <span aria-hidden>*</span>}
        {isFilled?.(code) && <FilledDot aria-hidden />}
      </LocaleButton>
    ))}
  </Flex>
);

export { LocaleSwitcher };
