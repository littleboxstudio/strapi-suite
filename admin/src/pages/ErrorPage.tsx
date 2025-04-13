import { Main } from '@strapi/design-system';
import { Box } from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import { Typography } from '@strapi/design-system';
import { Button } from '@strapi/design-system';
import config from '../core/config';
import { getTranslation } from '../core/utils/getTranslation';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import ProductIcon from '../components/ProductIcon';
import styled from 'styled-components';

const BoxWrapper = styled(Box)`
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
`;

const ErrorPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();

  return (
    <Main
      style={{
        width: '100%',
        height: '100vh',
        padding: '40px 50px',
      }}
    >
      <BoxWrapper display="flex">
        <Logo size="L" />

        <Box style={{ maxWidth: '450px', textAlign: 'center', padding: '30px 0' }}>
          <Typography variant="omega" style={{ color: '#a5a5ba' }}>
            {formatMessage({ id: getTranslation('app.not-found') })}
          </Typography>
        </Box>

        <Box display="flex" style={{ gap: '10px' }}>
          <a
            style={{ cursor: 'pointer' }}
            onClick={() => window.open('https://littlebox.pt', '_blank')}
          >
            <ProductIcon product="ST" />
          </a>
          <a
            style={{ cursor: 'pointer' }}
            onClick={() => window.open('https://littlebox.pt', '_blank')}
          >
            <ProductIcon product="CD" />
          </a>
          <a
            style={{ cursor: 'pointer' }}
            onClick={() => window.open('https://littlebox.pt', '_blank')}
          >
            <ProductIcon product="AI" />
          </a>
          <a
            style={{ cursor: 'pointer' }}
            onClick={() => window.open('https://littlebox.pt', '_blank')}
          >
            <ProductIcon product="EC" />
          </a>
        </Box>

        <Box style={{ paddingTop: '30px' }}>
          <Button
            variant="ghost"
            startIcon={<ArrowLeft />}
            onClick={() => navigate(`/plugins/${config.pluginId}`)}
          >
            {formatMessage({ id: getTranslation('app.back-to-list') })}
          </Button>
        </Box>
      </BoxWrapper>
    </Main>
  );
};

export { ErrorPage };
