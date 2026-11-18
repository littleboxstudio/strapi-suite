import { Typography } from '@strapi/design-system';

/** A section's error, right under its title (a required item missing, a server refusal). */
const SectionError = ({ text }: { text?: string | null }) =>
  text ? (
    <Typography variant="omega" textColor="danger600" role="alert">
      {text}
    </Typography>
  ) : null;

export default SectionError;
