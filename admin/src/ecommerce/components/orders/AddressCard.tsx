import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { Address } from '../../orderTypes';

const countryName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** A tinted panel, like the payment tiles, at the top of the section the address belongs to. */
const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
`;

/** One address snapshot of the order, shown read-only (requirements 5.2–5.3). */
const AddressCard = ({ title, address }: { title: string; address: Address | null }) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const lines = address
    ? [
        [address.firstName, address.lastName].filter(Boolean).join(' '),
        address.company,
        address.nif ? `${t('ecommerce.orders.address.nif')}: ${address.nif}` : undefined,
        address.line1,
        address.line2,
        [address.postalCode, address.city].filter(Boolean).join(' '),
        address.country ? countryName(address.country, uiLocale) : undefined,
        address.phone,
      ].filter((l): l is string => !!l && !!l.trim())
    : [];

  return (
    <Panel>
      <Typography variant="sigma" textColor="neutral600">
        {title}
      </Typography>
      {lines.length ? (
        <Flex direction="column" alignItems="flex-start" gap={1}>
          {lines.map((line, i) => (
            <Typography
              key={i}
              textColor={i === 0 ? 'neutral800' : 'neutral700'}
              fontWeight={i === 0 ? 'semiBold' : undefined}
            >
              {line}
            </Typography>
          ))}
        </Flex>
      ) : (
        <Typography textColor="neutral600">{t('ecommerce.orders.detail.address.none')}</Typography>
      )}
    </Panel>
  );
};

export default AddressCard;
