import React from 'react';
import { Flex, Typography, Box, Breadcrumbs, Crumb, CrumbLink } from '@strapi/design-system';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import Logo from './Logo';
import { getTranslation } from '../core/utils/getTranslation';

const HeaderWrapper = styled(Box)`
  position: relative;
  z-index: 2;
  width: 100%;
`;

const HeaderLayout = ({ children, breadcrumbs, description }: any) => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();

  return (
    <HeaderWrapper>
      <Box
        style={{
          padding: '0 0 20px 0',
        }}
      >
        <Flex direction="column" alignItems="stretch" gap={3}>
          <Breadcrumbs>
            {breadcrumbs.map((breadcrumb: any, index: number) => (
              <React.Fragment key={index}>
                {index === breadcrumbs.length - 1 && <Crumb isCurrent>{breadcrumb.title}</Crumb>}
                {index !== breadcrumbs.length - 1 && (
                  <CrumbLink onClick={() => navigate(breadcrumb.link)}>
                    {breadcrumb.title}
                  </CrumbLink>
                )}
              </React.Fragment>
            ))}
          </Breadcrumbs>
        </Flex>
      </Box>

      <Box>
        <Box
          display="flex"
          style={{
            width: '100%',
            justifyContent: 'space-between',
          }}
        >
          <Box display="flex">
            <Logo />
          </Box>
          <Box
            display="flex"
            style={{
              alignItems: 'center',
            }}
          >
            {children}
          </Box>
        </Box>

        <Box
          style={{
            padding: '20px 20px 0 0',
            maxWidth: '600px',
          }}
        >
          <Typography variant="omega">
            {!description && formatMessage({ id: getTranslation('app.description') })}
            {description}
          </Typography>
        </Box>
      </Box>
    </HeaderWrapper>
  );
};

export default HeaderLayout;
