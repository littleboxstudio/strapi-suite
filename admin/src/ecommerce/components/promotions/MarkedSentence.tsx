import { Fragment } from 'react';
import { Box, Typography } from '@strapi/design-system';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from '../orders/NoticeBar';
import { markedParts } from '../../utils/promotionForm';

type Props = {
  /** A sentence with `markValue` values (what the user filled in). */
  text: string;
  /** Box background: neutral100 on a white section, neutral0 inside a darker box. */
  background?: 'neutral0' | 'neutral100';
};

/** A plain-words sentence (when a promotion applies, what a benefit gives), its filled-in values in the notice colours. */
const MarkedSentence = ({ text, background = 'neutral100' }: Props) => (
  <Box padding={3} hasRadius background={background}>
    <Typography variant="omega" textColor="neutral800" fontWeight="semiBold">
      {markedParts(text).map((part, i) =>
        part.value ? (
          <Box
            key={i}
            tag="span"
            hasRadius
            paddingLeft={1}
            paddingRight={1}
            style={{ background: NOTICE_BACKGROUND, color: NOTICE_TEXT }}
          >
            {part.text}
          </Box>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        )
      )}
    </Typography>
  </Box>
);

export default MarkedSentence;
