import { button, greeting, heading, layout, note, paragraph } from './layout';

export const en = {
  subject: 'Someone tried to register with your e-mail address - {{store.name}}',
  html: layout(
    'There is already an account with this e-mail address.',
    [
      heading('You already have an account'),
      greeting('en'),
      paragraph(
        'Someone tried to create an account at {{store.name}} with this e-mail address, but an account already exists. You can sign in, or reset your password if you forgot it.'
      ),
      button('loginUrl', 'Go to the store'),
      paragraph('Forgot your password? You can choose a new one on the reset page.'),
      button('resetUrl', 'Reset password'),
      note('If this was not you, contact the store. No changes were made to your account.'),
    ].join('\n'),
    'en'
  ),
};

export const pt = {
  subject: 'Alguém tentou registar-se com o seu email - {{store.name}}',
  html: layout(
    'Já existe uma conta com este email.',
    [
      heading('Já tem uma conta'),
      greeting('pt'),
      paragraph(
        'Alguém tentou criar uma conta em {{store.name}} com este email, mas já existe uma conta. Pode iniciar sessão ou repor a palavra-passe se se esqueceu dela.'
      ),
      button('loginUrl', 'Ir para a loja'),
      paragraph('Esqueceu-se da palavra-passe? Pode escolher uma nova na página de reposição.'),
      button('resetUrl', 'Repor palavra-passe'),
      note('Se não fez este pedido, contacte a loja. Não foi feita nenhuma alteração à sua conta.'),
    ].join('\n'),
    'pt'
  ),
};
