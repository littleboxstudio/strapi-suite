import { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Link, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { Main, Box, Flex, Button, Typography } from '@strapi/design-system';
import { PriceTag, ShoppingCart, User, Gift, Cog } from '@strapi/icons';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import { useSettings } from '../contexts/settings';
import HeaderLayout from '../components/HeaderLayout';
import EmptyProducts from './illustrations/EmptyProducts';

const MENU = [
  { key: 'products', icon: PriceTag },
  { key: 'orders', icon: ShoppingCart },
  { key: 'customers', icon: User },
  { key: 'promotions', icon: Gift },
  { key: 'settings', icon: Cog },
] as const;

type MenuKey = (typeof MENU)[number]['key'];

const NavItem = styled(Link)<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: ${({ theme }) => theme.borderRadius};
  text-decoration: none;
  font-size: ${({ theme }) => theme.fontSizes[2]};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  color: ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral800)};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : 'transparent')};

  &:hover {
    background: ${({ theme, $active }) =>
      $active ? theme.colors.primary100 : theme.colors.neutral150};
  }

  svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
`;

/** The menu section of the current url: /plugins/<id>/ecommerce/<section>/... */
function activeSection(pathname: string): MenuKey | undefined {
  const segments = pathname.split('/');
  const section = segments[segments.indexOf('ecommerce') + 1];
  return MENU.find((item) => item.key === section)?.key;
}

const EcommerceLayout = ({ children }: { children: ReactNode }) => {
  const module = config.uuid.modules.ecommerce;
  const { formatMessage } = useIntl();
  const { pathname } = useLocation();
  const settings = useSettings();
  const active = settings.provide(module).active;
  const section = activeSection(pathname);
  const basePath = `/plugins/${config.pluginId}/ecommerce`;

  async function toggleState(value: boolean) {
    const updateSetting = new UpdateSetting();
    await updateSetting.execute({ property: 'active', module, value });
  }

  const breadcrumbs: { title: string; link?: string }[] = [
    { title: 'Suite Modules', link: `/plugins/${config.pluginId}` },
    { title: formatMessage({ id: getTranslation(`module.${module}.name`) }), link: basePath },
  ];
  if (section) {
    breadcrumbs.push({ title: formatMessage({ id: getTranslation(`ecommerce.menu.${section}`) }) });
  }

  return (
    <Main style={{ width: '100%', padding: '40px 50px' }}>
      <HeaderLayout
        breadcrumbs={breadcrumbs}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
        {!active && (
          <Button variant="danger" size="S" onClick={() => toggleState(true)}>
            {formatMessage({ id: getTranslation('app.disabled') })}
          </Button>
        )}
        {active && (
          <Button size="S" onClick={() => toggleState(false)}>
            {formatMessage({ id: getTranslation('app.enabled') })}
          </Button>
        )}
      </HeaderLayout>

      {!active && (
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          marginTop={10}
          padding={10}
          background="neutral0"
          shadow="tableShadow"
          hasRadius
        >
          <EmptyProducts />
          <Typography variant="beta" tag="h2">
            {formatMessage({ id: getTranslation('ecommerce.disabled.title') })}
          </Typography>
          <Typography variant="omega" textColor="neutral600" textAlign="center">
            {formatMessage({ id: getTranslation('ecommerce.disabled.description') })}
          </Typography>
          <Box paddingTop={2}>
            <Button onClick={() => toggleState(true)}>
              {formatMessage({ id: getTranslation('ecommerce.disabled.cta') })}
            </Button>
          </Box>
        </Flex>
      )}

      {active && (
        <Flex alignItems="flex-start" gap={6} paddingTop={10}>
          <Box
            tag="nav"
            aria-label={formatMessage({ id: getTranslation(`module.${module}.name`) })}
            background="neutral0"
            shadow="tableShadow"
            hasRadius
            padding={2}
            style={{ width: '220px', flexShrink: 0 }}
          >
            <Flex direction="column" alignItems="stretch" gap={1}>
              {MENU.map(({ key, icon: Icon }) => (
                <NavItem
                  key={key}
                  to={`${basePath}/${key}`}
                  $active={section === key}
                  aria-current={section === key ? 'page' : undefined}
                >
                  <Icon aria-hidden />
                  {formatMessage({ id: getTranslation(`ecommerce.menu.${key}`) })}
                </NavItem>
              ))}
            </Flex>
          </Box>
          <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
        </Flex>
      )}
    </Main>
  );
};

export default EcommerceLayout;
