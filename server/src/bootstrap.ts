import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from './config';
import {
  BeforeCreateSlug,
  BeforeUpdateSlug,
  AfterCreateSlug,
  AfterUpdateSlug,
  AfterFindOneSlug,
  AfterFindManySlug,
  AfterDeleteSlug,
  AfterUnpublishSlug
} from './lifecycles';
import { registerEcommercePermissions } from './services/modules/ecommerce/permissions';
import { migrateOrderEditingData } from './services/modules/ecommerce/orderEditingMigration';
import { migratePromotionEligibility } from './services/modules/ecommerce/promotionEligibilityMigration';
import { migrateCustomerAccounts, fillGuestHashes } from './services/modules/ecommerce/customerAccountsMigration';
import { subscribeNotifications } from './services/modules/ecommerce/notifications';
import { subscribeStripeSessionRetirement } from './services/modules/ecommerce/stripePayments';
import { startRetentionSweep } from './services/modules/ecommerce/retentionSweep';
import { bootDuplicate } from './services/modules/duplicate/boot';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  
  const defaultSettings = [
    {
      module: "menu",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "attribute",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "parameter",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "translation",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "translation",
      property: 'aiEnabled',
      type: 'boolean',
      value: 'false',
    },
    {
      module: "translation",
      property: 'aiApiKey',
      type: 'string',
      value: null,
    },
    {
      module: "translation",
      property: 'aiModel',
      type: 'string',
      value: 'gpt-4o',
    },
    {
      module: "slug",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "slug",
      property: 'showDefaultLanguage',
      type: 'boolean',
      value: 'false',
    },
    {
      module: "slug",
      property: 'homepageContentId',
      type: 'string',
      value: null,
    },
    {
      module: "slug",
      property: 'homepageContentModel',
      type: 'string',
      value: null,
    },
    {
      module: "slug",
      property: 'homepageSlugStrategy',
      type: 'string',
      value: 'language',
    },
    {
      module: "template",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "locale",
      property: 'active',
      type: 'boolean',
      value: 'true',
    },
    {
      module: "ecommerce",
      property: 'active',
      type: 'boolean',
      value: 'false',
    },
  ];

  for (const setting of defaultSettings) {
    try {
      const current = await strapi.db.query(config.uuid.app.setting).findOne({
        where: {
          module: setting.module,
          property: setting.property,
        },
      });
      if (current) continue;
      await strapi.db.query(config.uuid.app.setting).create({ data: setting });
    } catch (e) { }
  }

  await registerEcommercePermissions(strapi);
  // Duplicate content: its permission, and runs a stopped process left RUNNING become INTERRUPTED.
  await bootDuplicate(strapi);

  try {
    await migrateOrderEditingData(strapi);
  } catch (e) {
    strapi.log?.warn?.('[ecommerce] order editing migration failed: ' + (e instanceof Error ? e.name : typeof e));
  }

  try {
    await migratePromotionEligibility(strapi);
  } catch (e) {
    strapi.log?.warn?.('[ecommerce] promotion eligibility migration failed: ' + (e instanceof Error ? e.name : typeof e));
  }

  try {
    await migrateCustomerAccounts(strapi);
  } catch (e) {
    strapi.log?.warn?.('[ecommerce] customer accounts migration failed: ' + (e instanceof Error ? e.name : typeof e));
  }
  // Slow (Argon2id) and not needed to serve requests: runs in the background.
  void fillGuestHashes(strapi);

  // Customer e-mails on domain events (each event checks that the e-commerce module is active).
  subscribeNotifications(strapi);
  // Outdated Stripe payment links are retired whenever the amount due changes.
  subscribeStripeSessionRetirement(strapi);
  // Expired sessions and link tokens are deleted daily, even without storefront traffic.
  startRetentionSweep(strapi);

  try {
    await strapi.db.query(config.uuid.modules.template).createMany({
      data: [
        {
          uid: "default",
          name: 'Default'
        }
      ],
    });
  } catch (e) { }

  strapi.documents.use(async (ctx, next) => {
    if (ctx.action === "unpublish") { 
      await AfterUnpublishSlug(ctx);
    }
    if (ctx.action === "delete") { 
      await AfterDeleteSlug(ctx);
    }
    return next();
  });

  // Image field: validates values and deletes the field's files that no value uses any more.
  const imageField = strapi.plugin(PLUGIN_ID).service('ImageFieldModuleService');
  strapi.documents.use(imageField.documentMiddleware());
  // Orphan files (uploaded, never saved) are collected in the background, never blocking start.
  imageField.collectOrphansThrottled();
  
  strapi.db.lifecycles.subscribe({
    async beforeCreate(event: any) {
      await BeforeCreateSlug(event);
    },
    async afterCreate(event: any) {
      await AfterCreateSlug(event);
    },
    async beforeUpdate(event: any) {
      await BeforeUpdateSlug(event);
    },
    async afterUpdate(event: any) { 
      await AfterUpdateSlug(event);
    },
    async afterFindOne(event: any) { 
      await AfterFindOneSlug(event);
    },
    async afterFindMany(event: any) { 
      await AfterFindManySlug(event);
    }
  });
};

export default bootstrap;