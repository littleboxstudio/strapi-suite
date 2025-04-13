import { Box } from '@strapi/design-system';
import styled from 'styled-components';

const BoxGrid = styled(Box)`
  display: grid;
  gap: 30px;
  grid-template-columns: 1fr;
  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 992px) {
    grid-template-columns: repeat(3, 1fr);
  }
  @media (min-width: 1200px) {
    grid-template-columns: repeat(4, 1fr);
  }
`;

export default BoxGrid;
