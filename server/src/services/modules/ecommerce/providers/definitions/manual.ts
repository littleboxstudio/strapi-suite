import type { ProviderDefinition } from '../registry';

const manual: ProviderDefinition = {
  id: 'manual',
  category: 'carrier',
  name: 'Manual',
  exclusive: false,
  verified: true,
  fields: [],
};

export default manual;
