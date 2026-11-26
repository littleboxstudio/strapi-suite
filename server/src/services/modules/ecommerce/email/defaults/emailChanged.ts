import { greeting, heading, layout, note, paragraph } from './layout';

export const en = {
  subject: 'The e-mail address of your account was changed - {{store.name}}',
  html: layout(
    'The e-mail address of your account was changed.',
    [
      heading('Your e-mail address was changed'),
      greeting('en'),
      paragraph(
        'The e-mail address of your account at {{store.name}} was changed to {{newEmail}} on {{changedAt}}.'
      ),
      note('If this was not you, contact the store right away so we can secure your account.'),
    ].join('\n'),
    'en'
  ),
};

export const pt = {
  subject: 'O email da sua conta foi alterado - {{store.name}}',
  html: layout(
    'O email da sua conta foi alterado.',
    [
      heading('O seu email foi alterado'),
      greeting('pt'),
      paragraph('O email da sua conta em {{store.name}} foi alterado para {{newEmail}} em {{changedAt}}.'),
      note('Se não fez esta alteração, contacte a loja de imediato para protegermos a sua conta.'),
    ].join('\n'),
    'pt'
  ),
};
