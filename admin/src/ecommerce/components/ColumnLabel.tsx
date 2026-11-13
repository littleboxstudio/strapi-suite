import { Flex, Typography } from '@strapi/design-system';

/**
 * A table column heading. The Actions column is right-aligned, over its buttons.
 */
const ColumnLabel = ({ column, children }: { column: string; children: string }) =>
  column === 'actions' ? (
    <Flex justifyContent="flex-end" width="100%">
      <Typography variant="sigma">{children}</Typography>
    </Flex>
  ) : (
    <Typography variant="sigma">{children}</Typography>
  );

export default ColumnLabel;
