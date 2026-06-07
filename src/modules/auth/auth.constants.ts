/**
 * Politique de mot de passe — source unique de vérité.
 *
 * Utilisée à la fois par les DTO (validation de la requête) et par le service
 * (règle métier), pour qu'elles ne puissent jamais diverger. C'est cette
 * divergence (DTO=8 vs service=12) qui causait l'erreur MOT_DE_PASSE_TROP_COURT
 * sur des mots de passe pourtant valides côté DTO.
 */
export const PASSWORD_MIN_LENGTH = 8;
