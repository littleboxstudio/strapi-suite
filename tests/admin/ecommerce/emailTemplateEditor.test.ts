import { describe, it, expect } from 'vitest';
import {
  EMAIL_TEMPLATE_TYPES,
  isEmailTemplateType,
} from '../../../admin/src/ecommerce/utils/emailTemplateEditor';
import { EMAIL_TEMPLATE_TYPES as SERVER_TYPES } from '../../../server/src/services/modules/ecommerce/email/catalog';
import en from '../../../admin/src/core/translations/en.json';
import pt from '../../../admin/src/core/translations/pt.json';

const key = (type: string, part: 'name' | 'description') =>
  `littlebox-strapi-suite.ecommerce.settings.emailTemplates.types.${type}.${part}`;

describe('emailTemplateEditor template types', () => {
  it('accepts EMAIL_VERIFICATION', () => {
    expect(EMAIL_TEMPLATE_TYPES).toContain('EMAIL_VERIFICATION');
    expect(isEmailTemplateType('EMAIL_VERIFICATION')).toBe(true);
    expect(isEmailTemplateType('NOPE')).toBe(false);
    expect(isEmailTemplateType(undefined)).toBe(false);
  });

  it('lists the same types as the server catalog', () => {
    expect([...EMAIL_TEMPLATE_TYPES].sort()).toEqual([...SERVER_TYPES].sort());
  });

  it.each(['en', 'pt'] as const)('every type has a %s name and description', (lang) => {
    const dict: Record<string, string> = lang === 'en' ? en : pt;
    for (const type of EMAIL_TEMPLATE_TYPES) {
      expect(dict[key(type, 'name')], `${type}.name`).toBeTruthy();
      expect(dict[key(type, 'description')], `${type}.description`).toBeTruthy();
    }
  });
});
