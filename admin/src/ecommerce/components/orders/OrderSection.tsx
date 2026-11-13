import type { ReactNode } from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';

/** White card with a title, used by every section of the order screen. */
const OrderSection = ({
  id,
  title,
  actions,
  children,
}: {
  /** Anchor the review alerts scroll to. */
  id?: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <Box id={id} background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {actions}
      </Flex>
      {children}
    </Flex>
  </Box>
);

export default OrderSection;
