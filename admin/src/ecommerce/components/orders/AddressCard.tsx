import { useIntl } from 'react-intl';
import { Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { Address } from '../../orderTypes';
import OrderSection from './OrderSection';
import EmptyNote from './EmptyNote';

const countryName = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** One address snapshot of the order, shown read-only (requirements 5.2–5.3). */
const AddressCard = ({ title, address }: { title: string; address: Address | null }) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  if (!address) {
    return (
      <OrderSection title={title}>
        <EmptyNote>{t('ecommerce.orders.detail.address.none')}</EmptyNote>
      </OrderSection>
    );
  }

  const lines = [
    [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.company,
    address.nif ? `${t('ecommerce.orders.address.nif')}: ${address.nif}` : undefined,
    address.line1,
    address.line2,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.country ? countryName(address.country, uiLocale) : undefined,
    address.phone,
  ].filter((l): l is string => !!l && !!l.trim());

  return (
    <OrderSection title={title}>
      <Flex direction="column" alignItems="flex-start" gap={1}>
        {lines.map((line, i) => (
          <Typography key={i} textColor={i === 0 ? 'neutral800' : 'neutral700'} fontWeight={i === 0 ? 'semiBold' : undefined}>
            {line}
          </Typography>
        ))}
      </Flex>
    </OrderSection>
  );
};

export default AddressCard;
