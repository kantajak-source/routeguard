/**
 * Service de géolocalisation ponctuelle pour ROUTEGUARD.
 * 
 * RÈGLES DE CONFIDENTIALITÉ ET DE SÉCURITÉ :
 * - Aucun suivi continu (pas de watchPosition).
 * - Aucun historique de déplacement.
 * - Aucune transmission à l'IA Gemini.
 * - Capture ponctuelle non-bloquante déclenchée uniquement lors du signalement.
 * - Échec silencieux (graceful fallback) si la permission est refusée, le GPS indisponible ou absent.
 */

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type LocationErrorReason =
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface LocationDiagnosticResult {
  location: LocationCoordinates | null;
  errorReason: LocationErrorReason | null;
  errorMessage: string | null;
}

export class LocationService {
  private static instance: LocationService;

  private constructor() {}

  public static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  /**
   * Récupère la position ponctuelle actuelle avec diagnostic d'erreur typé.
   * Ne lève jamais d'exception et garantit une capture ponctuelle unique.
   */
  public async getCurrentLocationDetailed(timeoutMs: number = 7000): Promise<LocationDiagnosticResult> {
    if (typeof window === 'undefined' || !navigator || !navigator.geolocation) {
      console.warn('[LocationService] Geolocation API non supportée sur ce navigateur.');
      return {
        location: null,
        errorReason: 'UNSUPPORTED',
        errorMessage: 'La géolocalisation n\'est pas supportée par cet appareil ou ce navigateur.',
      };
    }

    return new Promise<LocationDiagnosticResult>((resolve) => {
      let isSettled = false;

      const timer = setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        console.warn('[LocationService] Timeout de la capture GPS ponctuelle.');
        resolve({
          location: null,
          errorReason: 'TIMEOUT',
          errorMessage: 'Délai d\'attente de la géolocalisation dépassé.',
        });
      }, timeoutMs);

      try {
        navigator.geolocation.getCurrentPosition(
          (position: GeolocationPosition) => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            if (position && position.coords) {
              const coords: LocationCoordinates = {
                latitude: Number(position.coords.latitude),
                longitude: Number(position.coords.longitude),
                accuracy: Math.round(Number(position.coords.accuracy || 0)),
              };
              resolve({
                location: coords,
                errorReason: null,
                errorMessage: null,
              });
            } else {
              resolve({
                location: null,
                errorReason: 'POSITION_UNAVAILABLE',
                errorMessage: 'Position introuvable ou coordonnées invalides.',
              });
            }
          },
          (error: GeolocationPositionError) => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            let reason: LocationErrorReason = 'UNKNOWN';
            let message = 'Impossible d\'obtenir la position GPS.';

            if (error.code === 1) { // PERMISSION_DENIED
              reason = 'PERMISSION_DENIED';
              message = 'Accès à la géolocalisation refusé par le navigateur ou les paramètres de sécurité.';
            } else if (error.code === 2) { // POSITION_UNAVAILABLE
              reason = 'POSITION_UNAVAILABLE';
              message = 'Signal GPS introuvable ou position indisponible actuellement.';
            } else if (error.code === 3) { // TIMEOUT
              reason = 'TIMEOUT';
              message = 'Délai d\'attente de la géolocalisation dépassé.';
            }

            console.warn('[LocationService] Erreur GPS ponctuelle (non bloquante) :', error.message);
            resolve({
              location: null,
              errorReason: reason,
              errorMessage: message,
            });
          },
          {
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 15000, // Accepter une position récente de moins de 15 secondes pour rapidité
          }
        );
      } catch (err: any) {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        console.warn('[LocationService] Exception inattendue lors de getCurrentPosition :', err);
        resolve({
          location: null,
          errorReason: 'UNKNOWN',
          errorMessage: err?.message || 'Erreur inattendue lors de la capture GPS.',
        });
      }
    });
  }

  /**
   * Récupère la position ponctuelle actuelle de l'appareil.
   * Conserve sa signature exacte, sa valeur par défaut de 7000ms et son comportement d'origine.
   * Retourne null en cas de refus, d'indisponibilité ou d'incompatibilité,
   * sans jamais lever d'exception pour ne jamais bloquer le signalement du chauffeur.
   */
  public async getCurrentLocation(timeoutMs: number = 7000): Promise<LocationCoordinates | null> {
    const result = await this.getCurrentLocationDetailed(timeoutMs);
    return result.location;
  }
}

export const locationService = LocationService.getInstance();
