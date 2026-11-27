import { linkButton, greeting, heading, layout, note, paragraph } from './layout';

export const en = {
  subject: 'Confirm your new e-mail address - {{store.name}}',
  html: layout(
    'Confirm your new e-mail address.',
    [
      heading('Confirm your new e-mail address'),
      greeting('en'),
      paragraph('You asked to use {{newEmail}} as the e-mail address of your account at {{store.name}}.'),
      linkButton('{{store.url}}/account/confirm-email?token={{token}}', 'Confirm new e-mail address'),
      paragraph('This link expires in {{expiresInHours}} hours.'),
      note('If you did not ask for this, ignore this e-mail. Your address stays the same.'),
    ].join('\n'),
    'en'
  ),
};

export const pt = {
  subject: 'Confirme o seu novo email - {{store.name}}',
  html: layout(
    'Confirme o seu novo email.',
    [
      heading('Confirme o seu novo email'),
      greeting('pt'),
      paragraph('Pediu para usar {{newEmail}} como email da sua conta em {{store.name}}.'),
      linkButton('{{store.url}}/account/confirm-email?token={{token}}', 'Confirmar novo email'),
      paragraph('Esta ligação expira dentro de {{expiresInHours}} horas.'),
      note('Se não fez este pedido, ignore este email. O seu endereço mantém-se.'),
    ].join('\n'),
    'pt'
  ),
};
