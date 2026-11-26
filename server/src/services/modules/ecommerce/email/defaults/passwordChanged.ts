import { greeting, heading, layout, note, paragraph } from './layout';

export const en = {
  subject: 'Your password was changed - {{store.name}}',
  html: layout(
    'The password of your account was changed.',
    [
      heading('Your password was changed'),
      greeting('en'),
      paragraph('The password of your account at {{store.name}} was changed on {{changedAt}}.'),
      note('If this was not you, contact the store right away so we can secure your account.'),
    ].join('\n'),
    'en'
  ),
};

export const pt = {
  subject: 'A sua palavra-passe foi alterada - {{store.name}}',
  html: layout(
    'A palavra-passe da sua conta foi alterada.',
    [
      heading('A sua palavra-passe foi alterada'),
      greeting('pt'),
      paragraph('A palavra-passe da sua conta em {{store.name}} foi alterada em {{changedAt}}.'),
      note('Se não fez esta alteração, contacte a loja de imediato para protegermos a sua conta.'),
    ].join('\n'),
    'pt'
  ),
};
