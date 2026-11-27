import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from './config/index';
import { createTabsMiddleware } from './middlewares/tabs';
import { createEcommerceRawBodyMiddleware } from './middlewares/ecommerceRawBody';
import { createEcommerceModuleGate } from './middlewares/ecommerceModuleGate';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.customFields.register({
    name: 'ltbslug',
    plugin: PLUGIN_ID,
    type: 'uid',
  });

  // Image (single or gallery): the value is the Strapi media shape, stored as JSON.
  strapi.customFields.register({
    name: 'ltbimage',
    plugin: PLUGIN_ID,
    type: 'json',
  });

  // Registered during `register` so it runs before the router, which is mounted in `bootstrap`.
  strapi.server.use(createTabsMiddleware({ strapi }));
  // E-commerce endpoints answer 404 while the module is off, before any authentication.
  strapi.server.use(createEcommerceModuleGate({ strapi }));
  // Before strapi::body (mounted later, in bootstrap): keeps the Stripe webhook's raw bytes.
  strapi.server.use(createEcommerceRawBodyMiddleware({ strapi }));
};

export default register;
