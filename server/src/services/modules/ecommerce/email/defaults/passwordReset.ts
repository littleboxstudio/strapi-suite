import { button, greeting, heading, layout, note, paragraph } from './layout';

export const en = {
  subject: 'Reset your password - {{store.name}}',
  html: layout(
    'Use this link to choose a new password.',
    [
      heading('Reset your password'),
      greeting('en'),
      paragraph('We received a request to reset the password of your account at {{store.name}}.'),
      button('resetUrl', 'Choose a new password'),
      paragraph('This link expires in {{expiresInMinutes}} minutes and can be used once.'),
      note('If you did not ask for this, ignore this e-mail. Your password stays the same.'),
    ].join('\n'),
    'en'
  ),
};

export const pt = {
  subject: 'Reponha a sua palavra-passe - {{store.name}}',
  html: layout(
    'Use esta ligação para escolher uma nova palavra-passe.',
    [
      heading('Reponha a sua palavra-passe'),
      greeting('pt'),
      paragraph('Recebemos um pedido para repor a palavra-passe da sua conta em {{store.name}}.'),
      button('resetUrl', 'Escolher nova palavra-passe'),
      paragraph('Esta ligação expira dentro de {{expiresInMinutes}} minutos e só pode ser usada uma vez.'),
      note('Se não fez este pedido, ignore este email. A sua palavra-passe mantém-se.'),
    ].join('\n'),
    'pt'
  ),
};
