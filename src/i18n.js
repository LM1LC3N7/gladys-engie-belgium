// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// carry a text of an ENGIE answer, only our own messages and numbers.
// -----------------------------------------------------------------------------

/** Join several { en, fr } texts. */
export const join = (...texts) => ({
  en: texts
    .filter(Boolean)
    .map((t) => t.en)
    .join(' '),
  fr: texts
    .filter(Boolean)
    .map((t) => t.fr)
    .join(' '),
});

/** A delay in words: "45 min", "6 h". */
export function age(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

const CHANNEL = {
  sms: { en: 'by SMS', fr: 'par SMS' },
  email: { en: 'by e-mail', fr: 'par e-mail' },
};

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and password of your ENGIE Belgium account, then save.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte ENGIE Belgique, puis enregistrez.',
  },
  needsCode: {
    en: 'ENGIE asks for a verification code: press "Send the verification code", then type the code received in "Verify the code".',
    fr: 'ENGIE demande un code de vérification : appuyez sur « Envoyer le code de vérification », puis saisissez le code reçu dans « Vérifier le code ».',
  },
  sessionLost: {
    en: 'ENGIE ended the session (this often happens when the same account signs in on engie.be or in the ENGIE Smart app). A new verification code is needed: use the two buttons of the configuration.',
    fr: 'ENGIE a mis fin à la session (cela arrive souvent quand le même compte se connecte sur engie.be ou dans l’application ENGIE Smart). Un nouveau code de vérification est nécessaire : utilisez les deux boutons de la configuration.',
  },
  refused: {
    en: 'ENGIE refused the e-mail or the password: check them, save, then send a new code.',
    fr: 'ENGIE a refusé l’e-mail ou le mot de passe : vérifiez-les, enregistrez, puis renvoyez un code.',
  },
  sessionRefused: (wait) => ({
    en: `ENGIE refused a fresh access token: one new try in ${wait} (or press "Test the connection").`,
    fr: `ENGIE a refusé un jeton d’accès tout neuf : un nouvel essai dans ${wait} (ou appuyez sur « Tester la connexion »).`,
  }),
  loginChanged: {
    en: 'The ENGIE sign-in pages changed: the integration may need an update.',
    fr: 'Les pages de connexion ENGIE ont changé : l’intégration doit peut-être être mise à jour.',
  },
  rateLimited: (wait) => ({
    en: `ENGIE asked to slow down: every call paused for ${wait}.`,
    fr: `ENGIE demande de ralentir : tous les appels sont suspendus ${wait}.`,
  }),
  retry: (reason) => ({
    en: `ENGIE could not be read (${reason}): new try at the next read (within 6 h), or press "Test the connection".`,
    fr: `ENGIE n’a pas pu être lu (${reason}) : nouvel essai à la prochaine lecture (dans 6 h au plus), ou appuyez sur « Tester la connexion ».`,
  }),
  connecting: {
    en: 'Connecting to ENGIE…',
    fr: 'Connexion à ENGIE…',
  },
  noAgreement: {
    en: 'Connected to ENGIE, but the account has no active contract (business agreement).',
    fr: 'Connecté à ENGIE, mais le compte n’a aucun contrat actif.',
  },
  ok: ({ meters, accounts }) => ({
    en: `Connected to ENGIE: ${meters} meter(s), ${accounts} contract(s). Read every 6 hours. Add the devices from the "Discover" tab.`,
    fr: `Connecté à ENGIE : ${meters} compteur(s), ${accounts} contrat(s). Lecture toutes les 6 heures. Ajoutez les appareils depuis l’onglet « Découverte ».`,
  }),
  partial: (parts) => ({
    en: `Some data could not be read and keeps its previous value (${parts.join(', ')}).`,
    fr: `Certaines données n’ont pas pu être lues et gardent leur valeur précédente (${parts.join(', ')}).`,
  }),
  busy: {
    en: 'A read of ENGIE is in progress: try again in a minute.',
    fr: 'Une lecture d’ENGIE est en cours : réessayez dans une minute.',
  },
  slow: {
    en: 'ENGIE is slow to answer: look at the integration status in a minute.',
    fr: 'ENGIE tarde à répondre : regardez l’état de l’intégration dans une minute.',
  },
  test: {
    cooldown: {
      en: 'Tested less than 30 seconds ago.',
      fr: 'Testé il y a moins de 30 secondes.',
    },
  },
  code: {
    needsFields: {
      en: 'This button needs Gladys 5.1 or later (action fields): update Gladys.',
      fr: 'Ce bouton demande Gladys 5.1 ou plus récent (champs d’action) : mettez Gladys à jour.',
    },
    alreadyConnected: {
      en: 'Already connected to ENGIE: no code is needed.',
      fr: 'Déjà connecté à ENGIE : aucun code n’est nécessaire.',
    },
    cooldown: {
      en: 'A code was sent less than a minute ago: wait for it, or try again in a minute.',
      fr: 'Un code a été envoyé il y a moins d’une minute : attendez-le, ou réessayez dans une minute.',
    },
    sent: (channel) => ({
      en: `ENGIE sent a code ${CHANNEL[channel].en}: type it in "Verify the code" within 10 minutes.`,
      fr: `ENGIE a envoyé un code ${CHANNEL[channel].fr} : saisissez-le dans « Vérifier le code » d’ici 10 minutes.`,
    }),
    notNeeded: {
      en: 'Signed in: ENGIE asked for no code this time.',
      fr: 'Connecté : ENGIE n’a pas demandé de code cette fois.',
    },
    badFormat: {
      en: 'The code is made of 4 to 10 digits.',
      fr: 'Le code compte de 4 à 10 chiffres.',
    },
    noPending: {
      en: 'No code is awaited (or it is older than 10 minutes): press "Send the verification code" first.',
      fr: 'Aucun code n’est attendu (ou il date de plus de 10 minutes) : appuyez d’abord sur « Envoyer le code de vérification ».',
    },
    refused: {
      en: 'ENGIE refused this code: check it and try again.',
      fr: 'ENGIE a refusé ce code : vérifiez-le et réessayez.',
    },
    expired: {
      en: 'This sign-in expired: press "Send the verification code" again.',
      fr: 'Cette connexion a expiré : appuyez de nouveau sur « Envoyer le code de vérification ».',
    },
    verified: {
      en: 'Code accepted: connected to ENGIE. The session is kept, no code at the next restarts.',
      fr: 'Code accepté : connecté à ENGIE. La session est gardée, pas de code aux prochains redémarrages.',
    },
    failed: (reason) => ({
      en: `The verification failed (${reason}): try again later.`,
      fr: `La vérification a échoué (${reason}) : réessayez plus tard.`,
    }),
  },
};
