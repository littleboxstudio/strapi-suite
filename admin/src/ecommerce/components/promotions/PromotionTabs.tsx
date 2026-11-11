import { useIntl } from 'react-intl';
import { Link, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { Flex } from '@strapi/design-system';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import { usePromotionPermissions } from '../../hooks/usePromotionPermissions';

const TabLink = styled(Link)<{ $active: boolean }>`
  padding: 8px 16px;
  text-decoration: none;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  color: ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral800)};
  border-bottom: 2px solid ${({ theme, $active }) => ($active ? theme.colors.primary600 : 'transparent')};
  margin-bottom: -1px;

  &:hover {
    color: ${({ theme }) => theme.colors.primary600};
  }
`;

/** "Promotions" and "Store credit" at the top of both pages; the second needs `customers.read`. */
const PromotionTabs = () => {
  const { formatMessage } = useIntl();
  const { pathname } = useLocation();
  const { canReadCredits } = usePromotionPermissions();
  const base = `/plugins/${config.pluginId}/ecommerce/promotions`;
  const onCredits = pathname.replace(/\/+$/, '').endsWith('/store-credits');
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  return (
    <Flex
      gap={1}
      role="navigation"
      aria-label={t('ecommerce.promotions.tabs.label')}
      style={{ borderBottom: '1px solid var(--strapi-neutral-200, #eaeaef)' }}
    >
      <TabLink to={base} $active={!onCredits} aria-current={!onCredits ? 'page' : undefined}>
        {t('ecommerce.promotions.tabs.promotions')}
      </TabLink>
      {canReadCredits && (
        <TabLink
          to={`${base}/store-credits`}
          $active={onCredits}
          aria-current={onCredits ? 'page' : undefined}
        >
          {t('ecommerce.promotions.tabs.storeCredit')}
        </TabLink>
      )}
    </Flex>
  );
};

export default PromotionTabs;
