import { linkButton, greeting, heading, layout, note, paragraph } from './layout';

export const en = {
  subject: 'Verify your e-mail address - {{store.name}}',
  html: layout(
    'Verify your e-mail address to activate your account.',
    [
      heading('Verify your e-mail address'),
      greeting('en'),
      paragraph('Thank you for creating an account at {{store.name}}. Confirm your e-mail address to activate it.'),
      linkButton('{{store.url}}/account/verify-email?token={{token}}', 'Verify e-mail address'),
      paragraph('This link expires in {{expiresInHours}} hours.'),
      note('If you did not create this account, ignore this e-mail.'),
    ].join('\n'),
    'en'
  ),
};

export const pt = {
  subject: 'Confirme o seu email - {{store.name}}',
  html: layout(
    'Confirme o seu email para ativar a conta.',
    [
      heading('Confirme o seu email'),
      greeting('pt'),
      paragraph('Obrigado por criar uma conta em {{store.name}}. Confirme o seu email para a ativar.'),
      linkButton('{{store.url}}/account/verify-email?token={{token}}', 'Confirmar email'),
      paragraph('Esta ligação expira dentro de {{expiresInHours}} horas.'),
      note('Se não criou esta conta, ignore este email.'),
    ].join('\n'),
    'pt'
  ),
};
