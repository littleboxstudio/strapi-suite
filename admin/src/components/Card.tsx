import {
  Box,
  Card as StrapiCard,
  CardBody,
  CardBadge,
  CardContent,
  CardTitle,
  CardSubtitle,
} from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { getTranslation } from '../core/utils/getTranslation';
import styled from 'styled-components';

const StrapiCardWrapper = styled(StrapiCard)`
  width: 100%;
  & > div {
    height: 100%;
  }
`;

const BoxTitle = styled(Box)`
  flex-direction: column;
  @media (min-width: 768px) {
    flex-direction: row;
  }
`;

const BoxBadges = styled(Box)`
  justify-content: start;
  margin-top: 10px;
  & > div {
    margin-left: 0;
  }
  @media (min-width: 768px) {
    margin-top: 0;
  }
`;

const Card = ({ title, subtitle, badge, active, children }: any) => {
  const { formatMessage } = useIntl();

  return (
    <StrapiCardWrapper>
      <CardBody
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        <CardContent
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <BoxTitle display="flex">
            <CardTitle
              style={{
                fontSize: '1.6rem',
                paddingBottom: '5px',
                paddingRight: '20px',
                flex: 1,
                wordBreak: 'keep-all',
              }}
            >
              {title}
            </CardTitle>
            <BoxBadges display="flex">
              <CardBadge
                style={{
                  marginLeft: 0,
                }}
              >
                {badge}
              </CardBadge>
              {active && (
                <CardBadge
                  style={{
                    marginLeft: '8px',
                  }}
                  active
                >
                  {formatMessage({ id: getTranslation('app.enabled') })}
                </CardBadge>
              )}
              {!active && (
                <CardBadge
                  style={{
                    marginLeft: '8px',
                  }}
                >
                  {formatMessage({ id: getTranslation('app.disabled') })}
                </CardBadge>
              )}
            </BoxBadges>
          </BoxTitle>
          <CardSubtitle
            style={{
              fontSize: '1.4rem',
              paddingBottom: '20px',
              paddingTop: '15px',
              wordBreak: 'keep-all',
              flex: 1,
            }}
          >
            {subtitle}
          </CardSubtitle>
          <Box display="flex" style={{ flexDirection: 'column' }}>
            {children}
          </Box>
        </CardContent>
      </CardBody>
    </StrapiCardWrapper>
  );
};

export default Card;
