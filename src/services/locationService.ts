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
   * Récupère la position ponctuelle actuelle de l'appareil.
   * Retourne null en cas de refus, d'indisponibilité ou d'incompatibilité,
   * sans jamais lever d'exception pour ne jamais bloquer le signalement du chauffeur.
   */
  public async getCurrentLocation(timeoutMs: number = 7000): Promise<LocationCoordinates | null> {
    if (typeof window === 'undefined' || !navigator || !navigator.geolocation) {
      console.warn('[LocationService] Geolocation API non supportée sur ce navigateur.');
      return null;
    }

    return new Promise<LocationCoordinates | null>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[LocationService] Timeout de la capture GPS ponctuelle.');
        resolve(null);
      }, timeoutMs);

      try {
        navigator.geolocation.getCurrentPosition(
          (position: GeolocationPosition) => {
            clearTimeout(timer);
            if (position && position.coords) {
              const coords: LocationCoordinates = {
                latitude: Number(position.coords.latitude),
                longitude: Number(position.coords.longitude),
                accuracy: Math.round(Number(position.coords.accuracy || 0)),
              };
              resolve(coords);
            } else {
              resolve(null);
            }
          },
          (error: GeolocationPositionError) => {
            clearTimeout(timer);
            // Codes d'erreur standard : PERMISSION_DENIED (1), POSITION_UNAVAILABLE (2), TIMEOUT (3)
            console.warn('[LocationService] Erreur GPS ponctuelle (non bloquante) :', error.message);
            resolve(null);
          },
          {
            enableHighAccuracy: true,
            timeout: timeoutMs,
            maximumAge: 15000, // Accepter une position récente de moins de 15 secondes pour rapidité
          }
        );
      } catch (err) {
        clearTimeout(timer);
        console.warn('[LocationService] Exception inattendue lors de getCurrentPosition :', err);
        resolve(null);
      }
    });
  }
}

export const locationService = LocationService.getInstance();
