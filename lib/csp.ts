// Politique de sécurité du contenu : seuls les scripts portant le nonce de la requête s'exécutent (et ceux qu'ils
// chargent : strict-dynamic). Une injection HTML ne lance donc aucun script, et ne peut rien envoyer ailleurs
// (connect-src, form-action, img-src limités à l'application).
// Styles : 'unsafe-inline' reste nécessaire (attributs style de React, styles injectés par CodeMirror) ; un nonce
// dans style-src l'annulerait.
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
