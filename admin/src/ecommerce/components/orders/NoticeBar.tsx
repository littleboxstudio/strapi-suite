import type { ReactNode } from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';

/** The notice colours: a fixed dark amber background with white text (light and dark mode). */
const NOTICE_BACKGROUND = '#43311a';
const NOTICE_TEXT = '#ffffff';

type Props = {
  /** One line of text; a long one ends in an ellipsis (the full text is the tooltip). */
  text: string;
  /** Buttons on the right. */
  actions?: ReactNode;
};

/** A one-line notice at the top of the order page, with its buttons on the right. */
const NoticeBar = ({ text, actions }: Props) => (
  <Box
    role="alert"
    hasRadius
    paddingTop={2}
    paddingBottom={2}
    paddingLeft={4}
    paddingRight={2}
    style={{ background: NOTICE_BACKGROUND, color: NOTICE_TEXT }}
  >
    <Flex gap={3} alignItems="center" justifyContent="space-between">
      <Typography
        variant="omega"
        ellipsis
        title={text}
        style={{ color: NOTICE_TEXT, fontWeight: 'normal', minWidth: 0, flex: 1 }}
      >
        {text}
      </Typography>
      {actions && (
        <Flex gap={2} alignItems="center" shrink={0}>
          {actions}
        </Flex>
      )}
    </Flex>
  </Box>
);

export default NoticeBar;
