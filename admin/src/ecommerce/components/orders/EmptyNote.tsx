import type { ReactNode } from 'react';
import { Box, Typography } from '@strapi/design-system';

/** A section with nothing to list: one line in a tinted box (as "Refunds and credits"). */
const EmptyNote = ({ children }: { children: ReactNode }) => (
  <Box padding={4} background="neutral100" hasRadius>
    <Typography variant="omega" textColor="neutral600">
      {children}
    </Typography>
  </Box>
);

export default EmptyNote;
