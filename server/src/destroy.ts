import type { Core } from '@strapi/strapi';
import { stopRetentionSweep } from './services/modules/ecommerce/retentionSweep';

const destroy = ({ strapi }: { strapi: Core.Strapi }) => {
  stopRetentionSweep();
};

export default destroy;
