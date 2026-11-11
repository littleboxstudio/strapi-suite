import type { ProviderDefinition } from '../registry';

const L = 'ecommerce.settings.providers.ctt-expresso.fields';

const cttExpresso: ProviderDefinition = {
  id: 'ctt-expresso',
  category: 'carrier',
  name: 'CTT Expresso',
  exclusive: false,
  verified: false,
  fields: [
    { key: 'clientId', type: 'string', required: true, label: `${L}.clientId` },
    { key: 'contractNumber', type: 'string', required: true, label: `${L}.contractNumber` },
    { key: 'username', type: 'string', required: true, label: `${L}.username` },
    { key: 'password', type: 'secret', required: true, label: `${L}.password` },
  ],
  async testConnection() {
    return { ok: false, code: 'NOT_IMPLEMENTED' };
  },
};

export default cttExpresso;
