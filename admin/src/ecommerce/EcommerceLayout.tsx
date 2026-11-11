import { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  Main,
  Box,
  Flex,
  Button,
  Typography,
  Breadcrumbs,
  Crumb,
  CrumbLink,
} from '@strapi/design-system';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import { useSettings } from '../contexts/settings';
import Logo from '../components/Logo';
import EmptyProducts from './illustrations/EmptyProducts';
import { usePromotionPermissions } from './hooks/usePromotionPermissions';
import { PROMOTIONS_READ_ACTION, filterMenu } from './utils/rbac';

/** Text-only side menu. */
const MENU = [
  { key: 'products' },
  { key: 'orders' },
  { key: 'customers' },
  { key: 'promotions' },
  { key: 'settings' },
] as const;

type MenuKey = (typeof MENU)[number]['key'];

const TOP_BAR_HEIGHT = 56;

/** E-commerce top bar: 56px high, 12px padding (20px on the left) — logo, breadcrumbs, then the module switch. */
const TopBar = styled.header`
  display: flex;
  align-items: center;
  gap: 24px;
  box-sizing: border-box;
  flex-shrink: 0;
  height: ${TOP_BAR_HEIGHT}px;
  padding: 12px 12px 12px 20px;
  background: ${({ theme }) => theme.colors.neutral0};
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

/** Fits the shared logo inside the bar (32px = 56px − 2 × 12px). */
const LogoSlot = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 100%;

  a,
  svg {
    display: block;
    height: 100%;
    width: auto;
  }
`;

/** Fills the viewport; only the side menu and the content scroll, the top bar stays put. */
const Shell = styled(Main)`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  padding: 0;
  overflow: hidden;
`;

/** Everything below the top bar. */
const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`;

/** Left menu: flush with the left edge, from the top bar to the bottom of the page; scrolls on its own if needed. */
const SideNav = styled.nav`
  box-sizing: border-box;
  width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 12px 8px;
  background: ${({ theme }) => theme.colors.neutral0};
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

/**
 * The only scrolling area for page content. Sticky children (`top: 0`) stop right under the top bar —
 * see `StickyTabs` in `components/StickyTabs.tsx`.
 */
const Content = styled.div`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 32px 40px;
`;

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
  const navigate = useNavigate();
  const settings = useSettings();
  const active = settings.provide(module).active;
  const section = activeSection(pathname);
  const { canRead: canReadPromotions } = usePromotionPermissions();
  const menu = filterMenu(MENU, canReadPromotions ? [PROMOTIONS_READ_ACTION] : []);
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

  const switchButton = active ? (
    <Button size="S" onClick={() => toggleState(false)}>
      {formatMessage({ id: getTranslation('app.enabled') })}
    </Button>
  ) : (
    <Button variant="danger" size="S" onClick={() => toggleState(true)}>
      {formatMessage({ id: getTranslation('app.disabled') })}
    </Button>
  );

  return (
    <Shell>
      <TopBar>
        <LogoSlot>
          <Logo />
        </LogoSlot>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Breadcrumbs>
            {breadcrumbs.map((crumb, index) =>
              index === breadcrumbs.length - 1 ? (
                <Crumb key={index} isCurrent>
                  {crumb.title}
                </Crumb>
              ) : (
                <CrumbLink key={index} onClick={() => crumb.link && navigate(crumb.link)}>
                  {crumb.title}
                </CrumbLink>
              )
            )}
          </Breadcrumbs>
        </Box>
        <Flex alignItems="center" style={{ flexShrink: 0 }}>
          {switchButton}
        </Flex>
      </TopBar>

      {!active && (
        <Box padding={10} style={{ flex: 1, overflowY: 'auto' }}>
          <Flex
            direction="column"
            alignItems="center"
            gap={3}
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
        </Box>
      )}

      {active && (
        <Body>
          <SideNav aria-label={formatMessage({ id: getTranslation(`module.${module}.name`) })}>
            <Flex direction="column" alignItems="stretch" gap={1}>
              {menu.map(({ key }) => (
                <NavItem
                  key={key}
                  to={`${basePath}/${key}`}
                  $active={section === key}
                  aria-current={section === key ? 'page' : undefined}
                >
                  {formatMessage({ id: getTranslation(`ecommerce.menu.${key}`) })}
                </NavItem>
              ))}
            </Flex>
          </SideNav>
          <Content>{children}</Content>
        </Body>
      )}
    </Shell>
  );
};

export default EcommerceLayout;
