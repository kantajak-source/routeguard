/**
 * ============================================================================
 * ROUTEGUARD - CORRIDOR SERVICE (ÉTAPE 1 : INTELLIGENCE GÉOGRAPHIQUE LOCALE)
 * ============================================================================
 * 
 * Ce service fonctionne ENTIÈREMENT EN LOCAL :
 * - Zéro dépendance externe (ni Google Maps, ni Mapbox, ni OpenStreetMap).
 * - Zéro appel réseau / API HTTP.
 * - Zéro persistance (ni Firestore, ni localStorage, ni tracking permanent).
 * - Zéro envoi de coordonnées GPS.
 * 
 * Il implémente la géométrie simplifiée de l'axe routier camerounais N4 :
 * Corridor Yaoundé ⇄ Bafoussam (~295 km).
 * 
 * Les points kilométriques sont qualifiés de :
 * « PK de référence ROUTEGUARD » (valeurs initiales de modélisation).
 */

// ----------------------------------------------------------------------------
// 1. TYPES TYPESCRIPT STRICTS
// ----------------------------------------------------------------------------

export interface CorridorCoordinates {
  latitude: number;
  longitude: number;
}

export type CorridorDirection = 
  | 'YAOUNDE_TO_BAFOUSSAM' 
  | 'BAFOUSSAM_TO_YAOUNDE';

export type RelativePosition = 
  | 'AHEAD'       // 🟢 L'événement est DEVANT le chauffeur
  | 'BEHIND'      // 🔴 L'événement est DERRIÈRE le chauffeur (dépassé)
  | 'AT_EVENT'    // ⚪ Le chauffeur est au niveau de l'événement (dans la zone de tolérance)
  | 'UNKNOWN';    // Position indéterminable (coordonnées hors corridor ou invalides)

export interface CorridorMarker {
  name: string;
  pk: number; // PK de référence ROUTEGUARD
  latitude: number;
  longitude: number;
}

export interface CorridorPositionResult {
  isValid: boolean;
  estimatedPk: number | null;
  nearestMarkerName: string | null;
  nearestMarkerDistanceKm: number | null;
  lateralDistanceKm: number | null; // Écart perpendiculaire estimé par rapport à l'axe N4
  isOnCorridor: boolean; // true si lateralDistanceKm <= MAX_LATERAL_OFFSET_KM (25 km)
  warningMessage?: string;
}

export interface DistanceComparisonResult {
  driverPk: number;
  alertPk: number;
  estimatedDistanceKm: number;
  relativePosition: RelativePosition;
  direction: CorridorDirection;
  summaryText: string;
}

/**
 * Structure de retour normalisée pour la comparaison relative Chauffeur ↔ Alerte (Étape 4A)
 */
export interface RelativeAlertPositionResult {
  relativePosition: 'AHEAD' | 'BEHIND' | 'AT_EVENT';
  estimatedDistanceKm: number;
}

/**
 * Structure de retour pour la comparaison relative directe à partir de coordonnées GPS (Étape 5B)
 */
export interface RelativeAlertPositionFromCoordinatesResult {
  isDetermined: boolean;
  relativePosition: RelativePosition;
  estimatedDistanceKm: number | null;
  driverPk: number | null;
  alertPk: number | null;
  isDriverOnCorridor: boolean;
  isAlertOnCorridor: boolean;
  reason?: string;
}

/**
 * Alerte géographiquement pertinente retenue par le filtre GPS (Étape 5C)
 */
export interface RelevantAlertItem<T = any> {
  alert: T;
  relativePosition: 'AHEAD' | 'AT_EVENT';
  estimatedDistanceKm: number;
  alertPk: number;
  driverPk: number;
  ageMinutes?: number;
}

/**
 * Alerte non retenue par le filtre GPS avec son motif d'exclusion (Étape 5C)
 */
export interface ExcludedAlertItem<T = any> {
  alert: T;
  relativePosition: RelativePosition | 'GPS_UNAVAILABLE';
  estimatedDistanceKm: number | null;
  alertPk: number | null;
  reason:
    | 'BEHIND'
    | 'TOO_FAR'
    | 'DRIVER_OFF_CORRIDOR'
    | 'ALERT_OFF_CORRIDOR'
    | 'GPS_UNAVAILABLE'
    | 'COORDINATES_INVALID';
}

/**
 * Résultat du filtrage local des alertes par GPS (Étape 5C)
 */
export interface FilterRelevantAlertsByGpsResult<T = any> {
  relevantAlerts: RelevantAlertItem<T>[];
  excludedAlerts: ExcludedAlertItem<T>[];
  driverPk: number | null;
  isDriverOnCorridor: boolean;
  maxDistanceKm: number;
}

/**
 * Alerte exclue de la pertinence globale (Étape 5E)
 */
export interface GloballyExcludedAlertItem<T = any> {
  alert: T;

  geographicStatus:
    | 'RELEVANT'
    | 'BEHIND'
    | 'TOO_FAR'
    | 'DRIVER_OFF_CORRIDOR'
    | 'ALERT_OFF_CORRIDOR'
    | 'GPS_UNAVAILABLE'
    | 'COORDINATES_INVALID';

  temporalStatus:
    | 'FRESH'
    | 'STALE'
    | 'TEMPORAL_UNAVAILABLE';

  reason:
    | 'GEOGRAPHICALLY_EXCLUDED'
    | 'TEMPORALLY_EXCLUDED'
    | 'BOTH'
    | 'UNDETERMINED';

  estimatedDistanceKm: number | null;
  ageMinutes: number | null;
  alertPk: number | null;
  driverPk: number | null;
}

/**
 * Résultat du moteur de pertinence global ROUTEGUARD (Étape 5E : Géographie + Temps)
 */
export interface FilterRelevantAlertsResult<T = any> {
  relevantAlerts: (RelevantAlertItem<T> & { ageMinutes: number })[];
  excludedAlerts: GloballyExcludedAlertItem<T>[];

  driverPk: number | null;
  isDriverOnCorridor: boolean;

  maxDistanceKm: number;
  maxAgeMinutes: number;
}

// ----------------------------------------------------------------------------
// 2. RÉFÉRENTIEL DU CORRIDOR (PK de référence ROUTEGUARD)
// ----------------------------------------------------------------------------

export const ROUTEGUARD_CORRIDOR_MARKERS: readonly CorridorMarker[] = [
  { name: 'Yaoundé',     pk: 0,   latitude: 3.8667, longitude: 11.5167 },
  { name: 'Obala',       pk: 42,  latitude: 4.1672, longitude: 11.5333 },
  { name: 'Sa’a',        pk: 75,  latitude: 4.3667, longitude: 11.4500 },
  { name: 'Bafia',       pk: 125, latitude: 4.7500, longitude: 11.2333 },
  { name: 'Ombessa',     pk: 145, latitude: 4.6000, longitude: 11.2500 },
  { name: 'Makénéné',    pk: 180, latitude: 4.8833, longitude: 11.0333 },
  { name: 'Ndikiniméki', pk: 205, latitude: 4.7667, longitude: 10.8333 },
  { name: 'Bangangté',   pk: 245, latitude: 5.1500, longitude: 10.5167 },
  { name: 'Bafoussam',   pk: 295, latitude: 5.4667, longitude: 10.4167 },
] as const;

// Tolérance latérale maximale pour considérer qu'un véhicule est sur l'axe N4 (25 km)
export const MAX_LATERAL_OFFSET_KM = 25;

// Tolérance par défaut pour considérer qu'un chauffeur est « au niveau » de l'alerte (0.5 km)
export const DEFAULT_EVENT_TOLERANCE_KM = 0.5;

// Distance maximale par défaut pour considérer une alerte géographiquement pertinente (80 km)
// Valeur initiale de conception ROUTEGUARD, centralisée et configurable.
export const DEFAULT_MAX_ALERT_DISTANCE_KM = 80;

// Durée de fraîcheur maximale par défaut pour une alerte (120 minutes = 2 heures)
// Valeur initiale de conception ROUTEGUARD, centralisée et configurable (Étape 5D)
export const DEFAULT_MAX_ALERT_AGE_MINUTES = 120;

/**
 * Résultat du filtrage temporel pur des alertes (Étape 5D)
 */
export interface FilterFreshAlertsResult<T = any> {
  freshAlerts: T[];
  staleAlerts: T[];
  unavailableAlerts: T[];
}

// ----------------------------------------------------------------------------
// 3. FONCTIONS MATHÉMATIQUES LOCALES (HAVERSINE & PROJECTION DE SEGMENT)
// ----------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

/**
 * Calcule la distance orthodromique (Haversine) entre deux points géographiques (en km).
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

/**
 * Projette un point P(lat, lon) sur un segment [A, B] du corridor.
 * Utilise une projection plane locale équirectangulaire (valable pour des segments routiers de ~30-50 km).
 * Retourne le paramètre scalaire t (borné entre 0 et 1) et le point projeté le plus proche.
 */
function projectPointOnSegment(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): { t: number; projLat: number; projLon: number } {
  const meanLatRad = (((aLat + bLat) / 2) * Math.PI) / 180;
  const cosLat = Math.cos(meanLatRad);

  // Conversion en coordonnées planes relatives
  const ax = aLon * cosLat;
  const ay = aLat;
  const bx = bLon * cosLat;
  const by = bLat;
  const px = pLon * cosLat;
  const py = pLat;

  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;

  const segLengthSq = vx * vx + vy * vy;
  if (segLengthSq === 0) {
    return { t: 0, projLat: aLat, projLon: aLon };
  }

  // Projection orthogonale scalaire
  let t = (wx * vx + wy * vy) / segLengthSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const projLon = (ax + t * vx) / cosLat;
  const projLat = ay + t * vy;

  return { t, projLat, projLon };
}

// ----------------------------------------------------------------------------
// 4. CLASSE DE SERVICE : CorridorService
// ----------------------------------------------------------------------------

export class CorridorService {
  private static instance: CorridorService;

  private constructor() {}

  public static getInstance(): CorridorService {
    if (!CorridorService.instance) {
      CorridorService.instance = new CorridorService();
    }
    return CorridorService.instance;
  }

  /**
   * Retourne la liste des repères de référence ROUTEGUARD sur l'axe N4.
   */
  public getMarkers(): readonly CorridorMarker[] {
    return ROUTEGUARD_CORRIDOR_MARKERS;
  }

  /**
   * Recherche un repère de référence par son nom (insensible à la casse et aux accents).
   */
  public findMarkerByName(name: string): CorridorMarker | undefined {
    if (!name) return undefined;
    const cleanSearch = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    return ROUTEGUARD_CORRIDOR_MARKERS.find((m) => {
      const cleanMarker = m.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return cleanSearch.includes(cleanMarker) || cleanMarker.includes(cleanSearch);
    });
  }

  /**
   * Projette une coordonnée GPS (latitude, longitude) sur le corridor N4.
   * 
   * Détermine :
   * - le PK estimé (Point Kilométrique de référence ROUTEGUARD entre 0 et 295 km) ;
   * - le repère le plus proche ;
   * - la distance latérale par rapport à l'axe routier ;
   * - un indicateur d'appartenance au corridor (isOnCorridor).
   */
  public getCorridorPosition(latitude: number, longitude: number): CorridorPositionResult {
    // Validation des bornes géographiques
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      isNaN(latitude) ||
      isNaN(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return {
        isValid: false,
        estimatedPk: null,
        nearestMarkerName: null,
        nearestMarkerDistanceKm: null,
        lateralDistanceKm: null,
        isOnCorridor: false,
        warningMessage: 'Coordonnées GPS invalides ou hors bornes.',
      };
    }

    const markers = ROUTEGUARD_CORRIDOR_MARKERS;
    let minLateralDistanceKm = Infinity;
    let bestEstimatedPk = markers[0].pk;
    let bestSegmentIndex = 0;

    // 1. Recherche du segment de corridor le plus proche
    for (let i = 0; i < markers.length - 1; i++) {
      const a = markers[i];
      const b = markers[i + 1];

      const { t, projLat, projLon } = projectPointOnSegment(
        latitude,
        longitude,
        a.latitude,
        a.longitude,
        b.latitude,
        b.longitude
      );

      const lateralDist = calculateHaversineDistanceKm(latitude, longitude, projLat, projLon);

      if (lateralDist < minLateralDistanceKm) {
        minLateralDistanceKm = lateralDist;
        bestEstimatedPk = Math.round((a.pk + t * (b.pk - a.pk)) * 10) / 10;
        bestSegmentIndex = i;
      }
    }

    // 2. Recherche du repère nommé le plus proche
    let minMarkerDistKm = Infinity;
    let nearestMarkerName = markers[0].name;

    for (const marker of markers) {
      const dist = calculateHaversineDistanceKm(
        latitude,
        longitude,
        marker.latitude,
        marker.longitude
      );
      if (dist < minMarkerDistKm) {
        minMarkerDistKm = dist;
        nearestMarkerName = marker.name;
      }
    }

    const lateralDistanceRounded = Math.round(minLateralDistanceKm * 10) / 10;
    const markerDistanceRounded = Math.round(minMarkerDistKm * 10) / 10;
    const isOnCorridor = lateralDistanceRounded <= MAX_LATERAL_OFFSET_KM;

    return {
      isValid: true,
      estimatedPk: bestEstimatedPk,
      nearestMarkerName,
      nearestMarkerDistanceKm: markerDistanceRounded,
      lateralDistanceKm: lateralDistanceRounded,
      isOnCorridor,
      warningMessage: isOnCorridor
        ? undefined
        : `Position éloignée du corridor N4 (~${lateralDistanceRounded} km de l'axe). Fallback textuel recommandé.`,
    };
  }

  /**
   * Calcule la distance estimée sur le corridor entre deux points kilométriques (en km).
   * 
   * Ne prétend pas être une distance routière au mètre près :
   * concept de « distance estimée sur le corridor ».
   */
  public getEstimatedCorridorDistance(pkA: number, pkB: number): number {
    if (typeof pkA !== 'number' || typeof pkB !== 'number' || isNaN(pkA) || isNaN(pkB)) {
      return 0;
    }
    return Math.round(Math.abs(pkA - pkB) * 10) / 10;
  }

  /**
   * Détermine si une alerte est DEVANT ou DERRIÈRE le chauffeur selon son sens de circulation.
   * 
   * Règles :
   * - Sens YAOUNDE_TO_BAFOUSSAM (PK croissants de 0 vers 295) :
   *     alertPk > driverPk + tolérance → AHEAD
   *     alertPk < driverPk - tolérance → BEHIND
   * 
   * - Sens BAFOUSSAM_TO_YAOUNDE (PK décroissants de 295 vers 0) :
   *     alertPk < driverPk - tolérance → AHEAD
   *     alertPk > driverPk + tolérance → BEHIND
   * 
   * - Écart <= tolérance (défaut 0.5 km) → AT_EVENT
   */
  public isAhead(
    driverPk: number,
    alertPk: number,
    direction: CorridorDirection,
    toleranceKm: number = DEFAULT_EVENT_TOLERANCE_KM
  ): RelativePosition {
    if (
      typeof driverPk !== 'number' ||
      typeof alertPk !== 'number' ||
      isNaN(driverPk) ||
      isNaN(alertPk)
    ) {
      return 'UNKNOWN';
    }

    const deltaPk = alertPk - driverPk;

    // Dans la zone d'impact direct / au niveau de l'événement
    if (Math.abs(deltaPk) <= toleranceKm) {
      return 'AT_EVENT';
    }

    if (direction === 'YAOUNDE_TO_BAFOUSSAM') {
      return deltaPk > 0 ? 'AHEAD' : 'BEHIND';
    }

    if (direction === 'BAFOUSSAM_TO_YAOUNDE') {
      return deltaPk < 0 ? 'AHEAD' : 'BEHIND';
    }

    return 'UNKNOWN';
  }

  /**
   * Fournit une analyse complète et une description textuelle de la situation relative
   * entre le chauffeur et une alerte.
   */
  public comparePositions(
    driverPk: number,
    alertPk: number,
    direction: CorridorDirection,
    toleranceKm: number = DEFAULT_EVENT_TOLERANCE_KM
  ): DistanceComparisonResult {
    const estimatedDistanceKm = this.getEstimatedCorridorDistance(driverPk, alertPk);
    const relativePosition = this.isAhead(driverPk, alertPk, direction, toleranceKm);

    let summaryText = '';
    switch (relativePosition) {
      case 'AHEAD':
        summaryText = `Danger situé à environ ${estimatedDistanceKm} km devant vous sur l'axe N4.`;
        break;
      case 'BEHIND':
        summaryText = `Événement dépassé il y a environ ${estimatedDistanceKm} km derrière vous.`;
        break;
      case 'AT_EVENT':
        summaryText = `Vous êtes au niveau immédiat de l'événement (zone de danger actif).`;
        break;
      case 'UNKNOWN':
      default:
        summaryText = `Position relative indéterminée.`;
        break;
    }

    return {
      driverPk,
      alertPk,
      estimatedDistanceKm,
      relativePosition,
      direction,
      summaryText,
    };
  }

  /**
   * ÉTAPE 4A : Compare localement la position d'un chauffeur et celle d'une alerte
   * sur le corridor N4 (fonction pure locale sans état, sans réseau, sans GPS).
   * 
   * @param driverPk Point kilométrique estimé du chauffeur (0 à 295 km)
   * @param alertPk Point kilométrique estimé de l'alerte (0 à 295 km)
   * @param direction Sens de circulation choisi ('YAOUNDE_TO_BAFOUSSAM' ou 'BAFOUSSAM_TO_YAOUNDE')
   * @param toleranceKm Tolérance en km (par défaut DEFAULT_EVENT_TOLERANCE_KM = 0.5 km)
   * @returns { relativePosition: 'AHEAD' | 'BEHIND' | 'AT_EVENT', estimatedDistanceKm: number }
   */
  public getRelativeAlertPosition(
    driverPk: number,
    alertPk: number,
    direction: CorridorDirection,
    toleranceKm: number = DEFAULT_EVENT_TOLERANCE_KM
  ): RelativeAlertPositionResult {
    const estimatedDistanceKm = this.getEstimatedCorridorDistance(driverPk, alertPk);
    const rawPos = this.isAhead(driverPk, alertPk, direction, toleranceKm);

    // Normalisation stricte vers 'AHEAD' | 'BEHIND' | 'AT_EVENT'
    const relativePosition: 'AHEAD' | 'BEHIND' | 'AT_EVENT' =
      rawPos === 'UNKNOWN' ? 'AT_EVENT' : rawPos;

    return {
      relativePosition,
      estimatedDistanceKm,
    };
  }

  /**
   * ÉTAPE 4B : Convertit localement les coordonnées GPS d'une alerte en PK ROUTEGUARD.
   * Réutilise purement getCorridorPosition() sans recréer aucun calcul géographique.
   * 
   * @param latitude Coordonnée GPS décimale de l'alerte
   * @param longitude Coordonnée GPS décimale de l'alerte
   * @returns CorridorPositionResult (estimatedPk, nearestMarkerName, isOnCorridor, lateralDistanceKm, isValid)
   */
  public getAlertCorridorPosition(latitude: number, longitude: number): CorridorPositionResult {
    return this.getCorridorPosition(latitude, longitude);
  }

  /**
   * ÉTAPE 5B : Détermine la position relative d'une alerte par rapport au chauffeur
   * à partir de leurs coordonnées GPS et du sens de circulation.
   * Fonction locale pure sans effet de bord, sans réseau, sans GPS capteur.
   * 
   * Réutilise strictement :
   * 1. this.getCorridorPosition(driverLat, driverLon)
   * 2. this.getAlertCorridorPosition(alertLat, alertLon)
   * 3. this.getRelativeAlertPosition(driverPk, alertPk, direction, toleranceKm)
   */
  public getRelativeAlertPositionFromCoordinates(
    driverLatitude: number,
    driverLongitude: number,
    alertLatitude: number,
    alertLongitude: number,
    direction: CorridorDirection,
    toleranceKm: number = DEFAULT_EVENT_TOLERANCE_KM
  ): RelativeAlertPositionFromCoordinatesResult {
    // 0. Vérification préalable des types et valeurs numériques
    if (
      typeof driverLatitude !== 'number' ||
      typeof driverLongitude !== 'number' ||
      typeof alertLatitude !== 'number' ||
      typeof alertLongitude !== 'number' ||
      isNaN(driverLatitude) ||
      isNaN(driverLongitude) ||
      isNaN(alertLatitude) ||
      isNaN(alertLongitude)
    ) {
      return {
        isDetermined: false,
        relativePosition: 'UNKNOWN',
        estimatedDistanceKm: null,
        driverPk: null,
        alertPk: null,
        isDriverOnCorridor: false,
        isAlertOnCorridor: false,
        reason: 'Coordonnées GPS invalides ou manquantes (NaN ou non numériques).',
      };
    }

    // 1. Convertir les coordonnées GPS du chauffeur
    const driverPos = this.getCorridorPosition(driverLatitude, driverLongitude);

    // 2. Convertir les coordonnées GPS de l'alerte
    const alertPos = this.getAlertCorridorPosition(alertLatitude, alertLongitude);

    // 3. Vérifier que les deux positions sont valides géographiquement
    if (!driverPos.isValid || !alertPos.isValid) {
      return {
        isDetermined: false,
        relativePosition: 'UNKNOWN',
        estimatedDistanceKm: null,
        driverPk: null,
        alertPk: null,
        isDriverOnCorridor: driverPos.isOnCorridor,
        isAlertOnCorridor: alertPos.isOnCorridor,
        reason: 'Coordonnées GPS hors limites ou géométrie invalide.',
      };
    }

    // 4. Vérifier que le chauffeur est sur le corridor
    if (!driverPos.isOnCorridor || typeof driverPos.estimatedPk !== 'number') {
      return {
        isDetermined: false,
        relativePosition: 'UNKNOWN',
        estimatedDistanceKm: null,
        driverPk: null,
        alertPk: alertPos.isOnCorridor ? alertPos.estimatedPk : null,
        isDriverOnCorridor: false,
        isAlertOnCorridor: alertPos.isOnCorridor,
        reason: 'Chauffeur hors corridor N4 (écart > 25 km). Aucun PK inventé.',
      };
    }

    // 5. Vérifier que l'alerte est sur le corridor
    if (!alertPos.isOnCorridor || typeof alertPos.estimatedPk !== 'number') {
      return {
        isDetermined: false,
        relativePosition: 'UNKNOWN',
        estimatedDistanceKm: null,
        driverPk: driverPos.estimatedPk,
        alertPk: null,
        isDriverOnCorridor: true,
        isAlertOnCorridor: false,
        reason: 'Alerte hors corridor N4 (écart > 25 km). Aucun PK inventé.',
      };
    }

    // 6. Récupérer les PK et appeler getRelativeAlertPosition
    const driverPk = driverPos.estimatedPk;
    const alertPk = alertPos.estimatedPk;
    const relativeResult = this.getRelativeAlertPosition(driverPk, alertPk, direction, toleranceKm);

    // 7. Retourner le résultat consolidé
    return {
      isDetermined: true,
      relativePosition: relativeResult.relativePosition,
      estimatedDistanceKm: relativeResult.estimatedDistanceKm,
      driverPk,
      alertPk,
      isDriverOnCorridor: true,
      isAlertOnCorridor: true,
    };
  }

  /**
   * ÉTAPE 5C : Filtrage local des alertes géographiquement pertinentes pour un chauffeur.
   * Fonction PURE sans état, sans réseau, sans GPS matériel, sans accès Firestore.
   * 
   * Identifie les alertes :
   * 1. Sur le même axe ROUTEGUARD (N4) ;
   * 2. Devant le chauffeur (AHEAD) ou à sa hauteur (AT_EVENT) ;
   * 3. Dans la limite de distance maximale configurable (maxDistanceKm, défaut 80 km).
   * 
   * Ne modifie jamais les alertes reçues.
   */
  public filterRelevantAlertsByGps<T extends { latitude?: number; longitude?: number }>(
    alerts: readonly T[],
    driverLatitude: number,
    driverLongitude: number,
    direction: CorridorDirection,
    maxDistanceKm: number = DEFAULT_MAX_ALERT_DISTANCE_KM
  ): FilterRelevantAlertsByGpsResult<T> {
    const relevantAlerts: RelevantAlertItem<T>[] = [];
    const excludedAlerts: ExcludedAlertItem<T>[] = [];

    // 1. Validation préalable des coordonnées du chauffeur
    if (
      typeof driverLatitude !== 'number' ||
      typeof driverLongitude !== 'number' ||
      isNaN(driverLatitude) ||
      isNaN(driverLongitude)
    ) {
      for (const alert of alerts) {
        excludedAlerts.push({
          alert,
          relativePosition: 'UNKNOWN',
          estimatedDistanceKm: null,
          alertPk: null,
          reason: 'COORDINATES_INVALID',
        });
      }
      return {
        relevantAlerts: [],
        excludedAlerts,
        driverPk: null,
        isDriverOnCorridor: false,
        maxDistanceKm,
      };
    }

    // 2. Projection du chauffeur sur le corridor
    const driverPos = this.getCorridorPosition(driverLatitude, driverLongitude);
    if (!driverPos.isValid || !driverPos.isOnCorridor || typeof driverPos.estimatedPk !== 'number') {
      // Chauffeur hors corridor : aucune alerte GPS pertinente, aucun PK inventé
      for (const alert of alerts) {
        excludedAlerts.push({
          alert,
          relativePosition: 'UNKNOWN',
          estimatedDistanceKm: null,
          alertPk: null,
          reason: 'DRIVER_OFF_CORRIDOR',
        });
      }
      return {
        relevantAlerts: [],
        excludedAlerts,
        driverPk: null,
        isDriverOnCorridor: false,
        maxDistanceKm,
      };
    }

    const driverPk = driverPos.estimatedPk;

    // 3. Évaluation individuelle de chaque alerte (sans modifier les objets reçus)
    for (const alert of alerts) {
      // Cas A : Coordonnées GPS absentes (ex: ancienne alerte sans champ GPS)
      if (
        alert.latitude === undefined ||
        alert.longitude === undefined ||
        alert.latitude === null ||
        alert.longitude === null
      ) {
        excludedAlerts.push({
          alert,
          relativePosition: 'GPS_UNAVAILABLE',
          estimatedDistanceKm: null,
          alertPk: null,
          reason: 'GPS_UNAVAILABLE',
        });
        continue;
      }

      // Cas B : Coordonnées GPS invalides (NaN, type erroné)
      if (
        typeof alert.latitude !== 'number' ||
        typeof alert.longitude !== 'number' ||
        isNaN(alert.latitude) ||
        isNaN(alert.longitude)
      ) {
        excludedAlerts.push({
          alert,
          relativePosition: 'UNKNOWN',
          estimatedDistanceKm: null,
          alertPk: null,
          reason: 'COORDINATES_INVALID',
        });
        continue;
      }

      // Calcul de la position relative directe
      const relResult = this.getRelativeAlertPositionFromCoordinates(
        driverLatitude,
        driverLongitude,
        alert.latitude,
        alert.longitude,
        direction
      );

      // Si la position relative n'a pas pu être déterminée
      if (!relResult.isDetermined) {
        excludedAlerts.push({
          alert,
          relativePosition: 'UNKNOWN',
          estimatedDistanceKm: null,
          alertPk: relResult.alertPk,
          reason: !relResult.isAlertOnCorridor ? 'ALERT_OFF_CORRIDOR' : 'COORDINATES_INVALID',
        });
        continue;
      }

      // Si l'alerte est derrière le chauffeur
      if (relResult.relativePosition === 'BEHIND') {
        excludedAlerts.push({
          alert,
          relativePosition: 'BEHIND',
          estimatedDistanceKm: relResult.estimatedDistanceKm,
          alertPk: relResult.alertPk,
          reason: 'BEHIND',
        });
        continue;
      }

      // Si l'alerte est AHEAD ou AT_EVENT
      if (relResult.relativePosition === 'AHEAD' || relResult.relativePosition === 'AT_EVENT') {
        const dist = relResult.estimatedDistanceKm ?? 0;
        if (dist <= maxDistanceKm) {
          // RETENUE
          relevantAlerts.push({
            alert,
            relativePosition: relResult.relativePosition,
            estimatedDistanceKm: dist,
            alertPk: relResult.alertPk!,
            driverPk,
          });
        } else {
          // Trop éloignée (> maxDistanceKm)
          excludedAlerts.push({
            alert,
            relativePosition: relResult.relativePosition,
            estimatedDistanceKm: dist,
            alertPk: relResult.alertPk,
            reason: 'TOO_FAR',
          });
        }
      } else {
        excludedAlerts.push({
          alert,
          relativePosition: 'UNKNOWN',
          estimatedDistanceKm: null,
          alertPk: relResult.alertPk,
          reason: 'COORDINATES_INVALID',
        });
      }
    }

    return {
      relevantAlerts,
      excludedAlerts,
      driverPk,
      isDriverOnCorridor: true,
      maxDistanceKm,
    };
  }

  /**
   * ÉTAPE 5D : Calcule l'âge d'une alerte en minutes à partir de son horodatage.
   * Fonction pure et déterministe, tolérante aux formats (timestamp ms, ISO string, Date).
   * 
   * @param createdAt Date de création de l'alerte
   * @param now Heure de référence actuelle (défaut Date.now())
   * @returns Nombre entier de minutes écoulées, ou null si absent, invalide ou futur
   */
  public getAlertAgeMinutes(
    createdAt: number | string | Date | undefined,
    now?: number | string | Date
  ): number | null {
    const parseTime = (val: number | string | Date | undefined): number | null => {
      if (val === undefined || val === null) return null;
      if (val instanceof Date) {
        const t = val.getTime();
        return isNaN(t) ? null : t;
      }
      if (typeof val === 'number') {
        if (isNaN(val) || !isFinite(val) || val <= 0) return null;
        return val;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return null;
        const parsed = Date.parse(trimmed);
        return isNaN(parsed) ? null : parsed;
      }
      return null;
    };

    const createdMs = parseTime(createdAt);
    const nowMs = now !== undefined ? parseTime(now) : Date.now();

    if (createdMs === null || nowMs === null) {
      return null;
    }

    if (createdMs > nowMs) {
      // Date dans le futur par rapport à now
      return null;
    }

    const diffMs = nowMs - createdMs;
    return Math.floor(diffMs / (60 * 1000));
  }

  /**
   * ÉTAPE 5D : Détermine si une alerte est encore fraîche dans le temps.
   * 
   * @param createdAt Date de création de l'alerte
   * @param now Heure de référence actuelle (défaut Date.now())
   * @param maxAgeMinutes Durée de validité maximale en minutes (défaut 120 min)
   * @returns true si valide, non future et âge <= maxAgeMinutes, false sinon
   */
  public isAlertFresh(
    createdAt: number | string | Date | undefined,
    now?: number | string | Date,
    maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
  ): boolean {
    if (typeof maxAgeMinutes !== 'number' || isNaN(maxAgeMinutes) || maxAgeMinutes < 0) {
      return false;
    }
    const age = this.getAlertAgeMinutes(createdAt, now);
    if (age === null) {
      return false;
    }
    return age <= maxAgeMinutes;
  }

  /**
   * ÉTAPE 5D : Filtrage temporel pur des alertes sans modifier les objets reçus.
   * Répartit exhaustivement les alertes dans l'une des 3 catégories (FRESH, STALE, UNAVAILABLE).
   * 
   * @param alerts Liste des alertes à analyser
   * @param now Heure de référence actuelle (défaut Date.now())
   * @param maxAgeMinutes Durée de validité maximale en minutes (défaut 120 min)
   * @returns Objet { freshAlerts, staleAlerts, unavailableAlerts }
   */
  public filterFreshAlerts<T extends { createdAt?: number | string | Date }>(
    alerts: readonly T[],
    now?: number | string | Date,
    maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
  ): FilterFreshAlertsResult<T> {
    const freshAlerts: T[] = [];
    const staleAlerts: T[] = [];
    const unavailableAlerts: T[] = [];

    const effectiveThreshold =
      typeof maxAgeMinutes === 'number' && !isNaN(maxAgeMinutes) && maxAgeMinutes >= 0
        ? maxAgeMinutes
        : DEFAULT_MAX_ALERT_AGE_MINUTES;

    for (const alert of alerts) {
      const age = this.getAlertAgeMinutes(alert.createdAt, now);
      if (age === null) {
        // Date absente, invalide ou future
        unavailableAlerts.push(alert);
      } else if (age <= effectiveThreshold) {
        // Alerte valide et fraîche (âge <= seuil)
        freshAlerts.push(alert);
      } else {
        // Alerte valide mais obsolète (âge > seuil)
        staleAlerts.push(alert);
      }
    }

    return {
      freshAlerts,
      staleAlerts,
      unavailableAlerts,
    };
  }

  /**
   * ÉTAPE 5E : Moteur local de pertinence des alertes ROUTEGUARD.
   * Compose purement le filtrage géographique (Étape 5C) et le filtrage temporel (Étape 5D).
   * 
   * Une alerte est pertinente uniquement si :
   * - Critères géographiques : chauffeur et alerte sur corridor, AHEAD/AT_EVENT, distance <= maxDistanceKm
   * - Critères temporels : createdAt valide, non futur, âge <= maxAgeMinutes
   * 
   * Ne modifie jamais les alertes reçues.
   */
  public filterRelevantAlerts<
    T extends {
      latitude?: number;
      longitude?: number;
      createdAt?: number | string | Date;
    }
  >(
    alerts: readonly T[],
    driverLatitude: number,
    driverLongitude: number,
    direction: CorridorDirection,
    now?: number | string | Date,
    maxDistanceKm: number = DEFAULT_MAX_ALERT_DISTANCE_KM,
    maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
  ): FilterRelevantAlertsResult<T> {
    // 1. Exécuter le filtrage géographique (Étape 5C)
    const gpsResult = this.filterRelevantAlertsByGps(
      alerts,
      driverLatitude,
      driverLongitude,
      direction,
      maxDistanceKm
    );

    // 2. Exécuter le filtrage temporel (Étape 5D)
    const tempResult = this.filterFreshAlerts(alerts, now, maxAgeMinutes);

    // Ensembles de référence pour repérage rapide
    const freshSet = new Set(tempResult.freshAlerts);
    const staleSet = new Set(tempResult.staleAlerts);

    const relevantAlerts: (RelevantAlertItem<T> & { ageMinutes: number })[] = [];
    const excludedAlerts: GloballyExcludedAlertItem<T>[] = [];

    // Map d'indexation pour retrouver rapidement les données géographiques de chaque alerte
    const gpsRelevantMap = new Map<T, RelevantAlertItem<T>>();
    for (const item of gpsResult.relevantAlerts) {
      gpsRelevantMap.set(item.alert, item);
    }

    const gpsExcludedMap = new Map<T, ExcludedAlertItem<T>>();
    for (const item of gpsResult.excludedAlerts) {
      gpsExcludedMap.set(item.alert, item);
    }

    // 3. Évaluation composite pour chaque alerte de la liste d'origine
    for (const alert of alerts) {
      // Évaluation temporelle
      const ageMinutes = this.getAlertAgeMinutes(alert.createdAt, now);
      let temporalStatus: 'FRESH' | 'STALE' | 'TEMPORAL_UNAVAILABLE';
      if (freshSet.has(alert)) {
        temporalStatus = 'FRESH';
      } else if (staleSet.has(alert)) {
        temporalStatus = 'STALE';
      } else {
        temporalStatus = 'TEMPORAL_UNAVAILABLE';
      }

      // Évaluation géographique
      const relGpsItem = gpsRelevantMap.get(alert);
      if (relGpsItem) {
        const geographicStatus: 'RELEVANT' = 'RELEVANT';
        if (temporalStatus === 'FRESH' && ageMinutes !== null) {
          // Double pertinence : GÉOGRAPHIQUE + TEMPORELLE
          relevantAlerts.push({
            alert,
            relativePosition: relGpsItem.relativePosition,
            estimatedDistanceKm: relGpsItem.estimatedDistanceKm,
            alertPk: relGpsItem.alertPk,
            driverPk: relGpsItem.driverPk,
            ageMinutes,
          });
        } else {
          // Géographiquement pertinent, mais temporellement exclu (obsolète ou date absente/invalide)
          excludedAlerts.push({
            alert,
            geographicStatus,
            temporalStatus,
            reason: 'TEMPORALLY_EXCLUDED',
            estimatedDistanceKm: relGpsItem.estimatedDistanceKm,
            ageMinutes,
            alertPk: relGpsItem.alertPk,
            driverPk: relGpsItem.driverPk,
          });
        }
      } else {
        const exclGpsItem = gpsExcludedMap.get(alert);
        const geographicStatus:
          | 'BEHIND'
          | 'TOO_FAR'
          | 'DRIVER_OFF_CORRIDOR'
          | 'ALERT_OFF_CORRIDOR'
          | 'GPS_UNAVAILABLE'
          | 'COORDINATES_INVALID' = exclGpsItem ? exclGpsItem.reason : 'COORDINATES_INVALID';

        let reason: 'GEOGRAPHICALLY_EXCLUDED' | 'TEMPORALLY_EXCLUDED' | 'BOTH' | 'UNDETERMINED';
        if (temporalStatus === 'FRESH') {
          reason = 'GEOGRAPHICALLY_EXCLUDED';
        } else if (
          (geographicStatus === 'GPS_UNAVAILABLE' || geographicStatus === 'COORDINATES_INVALID') &&
          temporalStatus === 'TEMPORAL_UNAVAILABLE'
        ) {
          reason = 'UNDETERMINED';
        } else {
          reason = 'BOTH';
        }

        excludedAlerts.push({
          alert,
          geographicStatus,
          temporalStatus,
          reason,
          estimatedDistanceKm: exclGpsItem ? exclGpsItem.estimatedDistanceKm : null,
          ageMinutes,
          alertPk: exclGpsItem ? exclGpsItem.alertPk : null,
          driverPk: gpsResult.driverPk,
        });
      }
    }

    return {
      relevantAlerts,
      excludedAlerts,
      driverPk: gpsResult.driverPk,
      isDriverOnCorridor: gpsResult.isDriverOnCorridor,
      maxDistanceKm,
      maxAgeMinutes,
    };
  }

  /**
   * Suite de tests de validation géométrique interne (auto-diagnostic).
   * Vérifie les calculs de projection et les règles directionnelles.
   */
  public runCorridorSelfCheck(): { name: string; passed: boolean; details: string }[] {
    const results: { name: string; passed: boolean; details: string }[] = [];

    // Test 1 : Projection exacte sur Obala (~42 km)
    const posObala = this.getCorridorPosition(4.1672, 11.5333);
    const isObalaOk =
      posObala.isValid &&
      posObala.isOnCorridor &&
      posObala.nearestMarkerName === 'Obala' &&
      Math.abs((posObala.estimatedPk || 0) - 42) <= 2;
    results.push({
      name: 'Projection Obala (lat: 4.1672, lon: 11.5333)',
      passed: isObalaOk,
      details: `PK calculé: ${posObala.estimatedPk} (attendu ~42 km), Repère: ${posObala.nearestMarkerName}`,
    });

    // Test 2 : Projection exacte sur Bafia (~125 km)
    const posBafia = this.getCorridorPosition(4.7500, 11.2333);
    const isBafiaOk =
      posBafia.isValid &&
      posBafia.isOnCorridor &&
      posBafia.nearestMarkerName === 'Bafia' &&
      Math.abs((posBafia.estimatedPk || 0) - 125) <= 2;
    results.push({
      name: 'Projection Bafia (lat: 4.7500, lon: 11.2333)',
      passed: isBafiaOk,
      details: `PK calculé: ${posBafia.estimatedPk} (attendu ~125 km), Repère: ${posBafia.nearestMarkerName}`,
    });

    // Test 3 : Projection exacte sur Makénéné (~180 km)
    const posMakenene = this.getCorridorPosition(4.8833, 11.0333);
    const isMakeneneOk =
      posMakenene.isValid &&
      posMakenene.isOnCorridor &&
      posMakenene.nearestMarkerName === 'Makénéné' &&
      Math.abs((posMakenene.estimatedPk || 0) - 180) <= 2;
    results.push({
      name: 'Projection Makénéné (lat: 4.8833, lon: 11.0333)',
      passed: isMakeneneOk,
      details: `PK calculé: ${posMakenene.estimatedPk} (attendu ~180 km), Repère: ${posMakenene.nearestMarkerName}`,
    });

    // Test 4 : Direction YAOUNDE_TO_BAFOUSSAM - Chauffeur à Obala (PK 42) vs Alerte à Bafia (PK 125)
    const rel1 = this.isAhead(42, 125, 'YAOUNDE_TO_BAFOUSSAM');
    const dist1 = this.getEstimatedCorridorDistance(42, 125);
    results.push({
      name: 'Sens Yaoundé → Bafoussam (Chauffeur Obala PK 42, Alerte Bafia PK 125)',
      passed: rel1 === 'AHEAD' && dist1 === 83,
      details: `Position relative: ${rel1} (attendu AHEAD), Distance estimée: ${dist1} km (attendu 83 km)`,
    });

    // Test 5 : Direction YAOUNDE_TO_BAFOUSSAM - Chauffeur à Makénéné (PK 180) vs Alerte à Bafia (PK 125)
    const rel2 = this.isAhead(180, 125, 'YAOUNDE_TO_BAFOUSSAM');
    results.push({
      name: 'Sens Yaoundé → Bafoussam (Chauffeur Makénéné PK 180, Alerte Bafia PK 125)',
      passed: rel2 === 'BEHIND',
      details: `Position relative: ${rel2} (attendu BEHIND - alerte dépassée)`,
    });

    // Test 6 : Direction BAFOUSSAM_TO_YAOUNDE - Chauffeur à Bafoussam (PK 295) vs Alerte à Bangangté (PK 245)
    const rel3 = this.isAhead(295, 245, 'BAFOUSSAM_TO_YAOUNDE');
    const dist3 = this.getEstimatedCorridorDistance(295, 245);
    results.push({
      name: 'Sens Bafoussam → Yaoundé (Chauffeur Bafoussam PK 295, Alerte Bangangté PK 245)',
      passed: rel3 === 'AHEAD' && dist3 === 50,
      details: `Position relative: ${rel3} (attendu AHEAD), Distance estimée: ${dist3} km (attendu 50 km)`,
    });

    // Test 7 : Direction BAFOUSSAM_TO_YAOUNDE - Chauffeur à Obala (PK 42) vs Alerte à Bafia (PK 125)
    const rel4 = this.isAhead(42, 125, 'BAFOUSSAM_TO_YAOUNDE');
    results.push({
      name: 'Sens Bafoussam → Yaoundé (Chauffeur Obala PK 42, Alerte Bafia PK 125)',
      passed: rel4 === 'BEHIND',
      details: `Position relative: ${rel4} (attendu BEHIND - danger déjà franchi)`,
    });

    // Test 8 : Tolérance au niveau de l'événement (AT_EVENT)
    const rel5 = this.isAhead(125.1, 125.3, 'YAOUNDE_TO_BAFOUSSAM', 0.5);
    results.push({
      name: 'Zone de tolérance immédiate (Chauffeur PK 125.1, Alerte PK 125.3, Tolérance 0.5 km)',
      passed: rel5 === 'AT_EVENT',
      details: `Position relative: ${rel5} (attendu AT_EVENT)`,
    });

    // Test 9 : Coordonnées hors corridor (Douala lat: 4.05, lon: 9.7)
    const posDouala = this.getCorridorPosition(4.05, 9.7);
    results.push({
      name: 'Coordonnée hors corridor (Douala : écart > 25 km)',
      passed: posDouala.isValid && !posDouala.isOnCorridor,
      details: `isOnCorridor: ${posDouala.isOnCorridor}, Écart latéral: ${posDouala.lateralDistanceKm} km`,
    });

    // =========================================================================
    // TESTS OBLIGATOIRES ÉTAPE 4A (COMPARAISON CHAUFFEUR ↔ ALERTE)
    // =========================================================================

    // TEST 1 : Chauffeur PK 42, Alerte PK 125, YAOUNDE_TO_BAFOUSSAM -> AHEAD, 83 km
    const t1 = this.getRelativeAlertPosition(42, 125, 'YAOUNDE_TO_BAFOUSSAM');
    results.push({
      name: 'TEST 1 : Chauffeur PK 42, Alerte PK 125, YAOUNDE_TO_BAFOUSSAM',
      passed: t1.relativePosition === 'AHEAD' && t1.estimatedDistanceKm === 83,
      details: `Résultat: ${t1.relativePosition}, distance: ${t1.estimatedDistanceKm} km (attendu AHEAD, 83 km)`,
    });

    // TEST 2 : Chauffeur PK 125, Alerte PK 42, YAOUNDE_TO_BAFOUSSAM -> BEHIND, 83 km
    const t2 = this.getRelativeAlertPosition(125, 42, 'YAOUNDE_TO_BAFOUSSAM');
    results.push({
      name: 'TEST 2 : Chauffeur PK 125, Alerte PK 42, YAOUNDE_TO_BAFOUSSAM',
      passed: t2.relativePosition === 'BEHIND' && t2.estimatedDistanceKm === 83,
      details: `Résultat: ${t2.relativePosition}, distance: ${t2.estimatedDistanceKm} km (attendu BEHIND, 83 km)`,
    });

    // TEST 3 : Chauffeur PK 180, Alerte PK 125, BAFOUSSAM_TO_YAOUNDE -> AHEAD, 55 km
    const t3 = this.getRelativeAlertPosition(180, 125, 'BAFOUSSAM_TO_YAOUNDE');
    results.push({
      name: 'TEST 3 : Chauffeur PK 180, Alerte PK 125, BAFOUSSAM_TO_YAOUNDE',
      passed: t3.relativePosition === 'AHEAD' && t3.estimatedDistanceKm === 55,
      details: `Résultat: ${t3.relativePosition}, distance: ${t3.estimatedDistanceKm} km (attendu AHEAD, 55 km)`,
    });

    // TEST 4 : Chauffeur PK 125, Alerte PK 180, BAFOUSSAM_TO_YAOUNDE -> BEHIND, 55 km
    const t4 = this.getRelativeAlertPosition(125, 180, 'BAFOUSSAM_TO_YAOUNDE');
    results.push({
      name: 'TEST 4 : Chauffeur PK 125, Alerte PK 180, BAFOUSSAM_TO_YAOUNDE',
      passed: t4.relativePosition === 'BEHIND' && t4.estimatedDistanceKm === 55,
      details: `Résultat: ${t4.relativePosition}, distance: ${t4.estimatedDistanceKm} km (attendu BEHIND, 55 km)`,
    });

    // TEST 5 : Chauffeur PK 125.1, Alerte PK 125.3, YAOUNDE_TO_BAFOUSSAM -> AT_EVENT (tolérance 0.5 km)
    const t5 = this.getRelativeAlertPosition(125.1, 125.3, 'YAOUNDE_TO_BAFOUSSAM');
    results.push({
      name: 'TEST 5 : Chauffeur PK 125.1, Alerte PK 125.3, YAOUNDE_TO_BAFOUSSAM',
      passed: t5.relativePosition === 'AT_EVENT' && t5.estimatedDistanceKm === 0.2,
      details: `Résultat: ${t5.relativePosition}, distance: ${t5.estimatedDistanceKm} km (attendu AT_EVENT)`,
    });

    // TEST 6 : Chauffeur PK 42, Alerte PK 42 -> AT_EVENT dans les deux sens
    const t6a = this.getRelativeAlertPosition(42, 42, 'YAOUNDE_TO_BAFOUSSAM');
    const t6b = this.getRelativeAlertPosition(42, 42, 'BAFOUSSAM_TO_YAOUNDE');
    results.push({
      name: 'TEST 6 : Chauffeur PK 42, Alerte PK 42 (cas limite égalité)',
      passed: t6a.relativePosition === 'AT_EVENT' && t6b.relativePosition === 'AT_EVENT',
      details: `YAOUNDE_TO_BAFOUSSAM: ${t6a.relativePosition}, BAFOUSSAM_TO_YAOUNDE: ${t6b.relativePosition} (attendu AT_EVENT pour les deux)`,
    });

    // =========================================================================
    // TESTS OBLIGATOIRES ÉTAPE 4B (CONVERSION GPS ALERTE -> PK ROUTEGUARD)
    // =========================================================================

    // TEST 1 — Obala (4.1672, 11.5333) -> isValid: true, isOnCorridor: true, nearestMarkerName: 'Obala', estimatedPk: 42
    const obala = this.getAlertCorridorPosition(4.1672, 11.5333);
    results.push({
      name: 'ÉTAPE 4B - TEST 1 : Alerte GPS Obala (lat: 4.1672, lon: 11.5333)',
      passed: obala.isValid && obala.isOnCorridor && obala.nearestMarkerName === 'Obala' && obala.estimatedPk === 42,
      details: `isValid: ${obala.isValid}, isOnCorridor: ${obala.isOnCorridor}, marker: ${obala.nearestMarkerName}, PK: ${obala.estimatedPk}`,
    });

    // TEST 2 — Bafia (4.7500, 11.2333) -> isValid: true, isOnCorridor: true, nearestMarkerName: 'Bafia', estimatedPk: 125
    const bafia = this.getAlertCorridorPosition(4.7500, 11.2333);
    results.push({
      name: 'ÉTAPE 4B - TEST 2 : Alerte GPS Bafia (lat: 4.7500, lon: 11.2333)',
      passed: bafia.isValid && bafia.isOnCorridor && bafia.nearestMarkerName === 'Bafia' && bafia.estimatedPk === 125,
      details: `isValid: ${bafia.isValid}, isOnCorridor: ${bafia.isOnCorridor}, marker: ${bafia.nearestMarkerName}, PK: ${bafia.estimatedPk}`,
    });

    // TEST 3 — Makénéné (4.8833, 11.0333) -> isValid: true, isOnCorridor: true, nearestMarkerName: 'Makénéné', estimatedPk: 180
    const makenene = this.getAlertCorridorPosition(4.8833, 11.0333);
    results.push({
      name: 'ÉTAPE 4B - TEST 3 : Alerte GPS Makénéné (lat: 4.8833, lon: 11.0333)',
      passed: makenene.isValid && makenene.isOnCorridor && makenene.nearestMarkerName === 'Makénéné' && makenene.estimatedPk === 180,
      details: `isValid: ${makenene.isValid}, isOnCorridor: ${makenene.isOnCorridor}, marker: ${makenene.nearestMarkerName}, PK: ${makenene.estimatedPk}`,
    });

    // TEST 4 — Hors corridor Douala (4.05, 9.7) -> isOnCorridor: false
    const horsCorridor = this.getAlertCorridorPosition(4.05, 9.7);
    results.push({
      name: 'ÉTAPE 4B - TEST 4 : Alerte GPS Hors corridor (Douala lat: 4.05, lon: 9.7)',
      passed: horsCorridor.isValid && !horsCorridor.isOnCorridor,
      details: `isOnCorridor: ${horsCorridor.isOnCorridor}, lateralDistanceKm: ${horsCorridor.lateralDistanceKm} km`,
    });

    // TEST 5 — Chaînage réel : Chauffeur Obala -> Alerte Bafia -> YAOUNDE_TO_BAFOUSSAM -> AHEAD, ~83 km
    const driverObala = this.getCorridorPosition(4.1672, 11.5333);
    const alertBafia = this.getAlertCorridorPosition(4.7500, 11.2333);
    const chain1 = this.getRelativeAlertPosition(
      driverObala.estimatedPk!,
      alertBafia.estimatedPk!,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 4B - TEST 5 : Chaînage Obala -> Bafia (YAOUNDE_TO_BAFOUSSAM)',
      passed: chain1.relativePosition === 'AHEAD' && chain1.estimatedDistanceKm === 83,
      details: `Position relative: ${chain1.relativePosition}, Distance: ${chain1.estimatedDistanceKm} km (attendu AHEAD, 83 km)`,
    });

    // TEST 6 — Sens inverse : Chauffeur Bafoussam -> Alerte Bangangté -> BAFOUSSAM_TO_YAOUNDE -> AHEAD, ~50 km
    const driverBafoussam = this.getCorridorPosition(5.4667, 10.4167);
    const alertBangangte = this.getAlertCorridorPosition(5.1500, 10.5167);
    const chain2 = this.getRelativeAlertPosition(
      driverBafoussam.estimatedPk!,
      alertBangangte.estimatedPk!,
      'BAFOUSSAM_TO_YAOUNDE'
    );
    results.push({
      name: 'ÉTAPE 4B - TEST 6 : Chaînage Bafoussam -> Bangangté (BAFOUSSAM_TO_YAOUNDE)',
      passed: chain2.relativePosition === 'AHEAD' && chain2.estimatedDistanceKm === 50,
      details: `Position relative: ${chain2.relativePosition}, Distance: ${chain2.estimatedDistanceKm} km (attendu AHEAD, 50 km)`,
    });

    // =========================================================================
    // TESTS OBLIGATOIRES ÉTAPE 5B (POSITION RELATIVE GPS DIRECTE)
    // =========================================================================

    // TEST 1 — OBALA -> BAFIA (YAOUNDE_TO_BAFOUSSAM)
    const t5b1 = this.getRelativeAlertPositionFromCoordinates(
      4.1672, 11.5333,
      4.7500, 11.2333,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 1 : Obala -> Bafia (YAOUNDE_TO_BAFOUSSAM)',
      passed: t5b1.isDetermined && t5b1.driverPk === 42 && t5b1.alertPk === 125 && t5b1.relativePosition === 'AHEAD' && t5b1.estimatedDistanceKm === 83,
      details: `driverPk: ${t5b1.driverPk}, alertPk: ${t5b1.alertPk}, rel: ${t5b1.relativePosition}, dist: ${t5b1.estimatedDistanceKm} km`,
    });

    // TEST 2 — OBALA -> BAFIA EN SENS INVERSE (BAFOUSSAM_TO_YAOUNDE)
    const t5b2 = this.getRelativeAlertPositionFromCoordinates(
      4.1672, 11.5333,
      4.7500, 11.2333,
      'BAFOUSSAM_TO_YAOUNDE'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 2 : Obala -> Bafia en sens inverse (BAFOUSSAM_TO_YAOUNDE)',
      passed: t5b2.isDetermined && t5b2.relativePosition === 'BEHIND' && t5b2.estimatedDistanceKm === 83,
      details: `rel: ${t5b2.relativePosition}, dist: ${t5b2.estimatedDistanceKm} km (attendu BEHIND, 83 km)`,
    });

    // TEST 3 — BAFOUSSAM -> BANGANGTÉ (BAFOUSSAM_TO_YAOUNDE)
    const t5b3 = this.getRelativeAlertPositionFromCoordinates(
      5.4667, 10.4167,
      5.1500, 10.5167,
      'BAFOUSSAM_TO_YAOUNDE'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 3 : Bafoussam -> Bangangté (BAFOUSSAM_TO_YAOUNDE)',
      passed: t5b3.isDetermined && t5b3.driverPk === 295 && t5b3.alertPk === 245 && t5b3.relativePosition === 'AHEAD' && t5b3.estimatedDistanceKm === 50,
      details: `driverPk: ${t5b3.driverPk}, alertPk: ${t5b3.alertPk}, rel: ${t5b3.relativePosition}, dist: ${t5b3.estimatedDistanceKm} km`,
    });

    // TEST 4 — BAFOUSSAM -> BANGANGTÉ EN SENS INVERSE (YAOUNDE_TO_BAFOUSSAM)
    const t5b4 = this.getRelativeAlertPositionFromCoordinates(
      5.4667, 10.4167,
      5.1500, 10.5167,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 4 : Bafoussam -> Bangangté en sens inverse (YAOUNDE_TO_BAFOUSSAM)',
      passed: t5b4.isDetermined && t5b4.relativePosition === 'BEHIND' && t5b4.estimatedDistanceKm === 50,
      details: `rel: ${t5b4.relativePosition}, dist: ${t5b4.estimatedDistanceKm} km (attendu BEHIND, 50 km)`,
    });

    // TEST 5 — MÊME POSITION
    const t5b5 = this.getRelativeAlertPositionFromCoordinates(
      4.1672, 11.5333,
      4.1672, 11.5333,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 5 : Même position (Obala <-> Obala)',
      passed: t5b5.isDetermined && t5b5.relativePosition === 'AT_EVENT' && t5b5.estimatedDistanceKm === 0,
      details: `rel: ${t5b5.relativePosition}, dist: ${t5b5.estimatedDistanceKm} km (attendu AT_EVENT, 0 km)`,
    });

    // TEST 6 — CHAUFFEUR HORS CORRIDOR
    const t5b6 = this.getRelativeAlertPositionFromCoordinates(
      4.05, 9.7,
      4.7500, 11.2333,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 6 : Chauffeur hors corridor (Douala)',
      passed: !t5b6.isDetermined && t5b6.driverPk === null && t5b6.relativePosition === 'UNKNOWN',
      details: `isDetermined: ${t5b6.isDetermined}, driverPk: ${t5b6.driverPk}, rel: ${t5b6.relativePosition}`,
    });

    // TEST 7 — ALERTE HORS CORRIDOR
    const t5b7 = this.getRelativeAlertPositionFromCoordinates(
      4.1672, 11.5333,
      4.05, 9.7,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 7 : Alerte hors corridor (Douala)',
      passed: !t5b7.isDetermined && t5b7.alertPk === null && t5b7.relativePosition === 'UNKNOWN',
      details: `isDetermined: ${t5b7.isDetermined}, alertPk: ${t5b7.alertPk}, rel: ${t5b7.relativePosition}`,
    });

    // TEST 8 — COORDONNÉES INVALIDES (NaN)
    const t5b8 = this.getRelativeAlertPositionFromCoordinates(
      NaN, 11.5333,
      4.7500, NaN,
      'YAOUNDE_TO_BAFOUSSAM'
    );
    results.push({
      name: 'ÉTAPE 5B - TEST 8 : Coordonnées invalides (NaN)',
      passed: !t5b8.isDetermined && t5b8.relativePosition === 'UNKNOWN',
      details: `isDetermined: ${t5b8.isDetermined}, rel: ${t5b8.relativePosition}, reason: ${t5b8.reason}`,
    });

    // =========================================================================
    // TESTS OBLIGATOIRES ÉTAPE 5C (FILTRAGE GÉOGRAPHIQUE LOCAL DES ALERTES)
    // =========================================================================
    const t5c_bafia = { id: 't5c_bafia', latitude: 4.7500, longitude: 11.2333 };
    const t5c1 = this.filterRelevantAlertsByGps([t5c_bafia], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', 80);
    results.push({
      name: 'ÉTAPE 5C - TEST 1 : Obala -> Bafia (83 km > 80 km) -> TOO_FAR',
      passed: t5c1.relevantAlerts.length === 0 && t5c1.excludedAlerts[0]?.reason === 'TOO_FAR',
      details: `relevant: ${t5c1.relevantAlerts.length}, reason: ${t5c1.excludedAlerts[0]?.reason}`,
    });

    const t5c_ombessa = { id: 't5c_ombessa', latitude: 4.6000, longitude: 11.2500 };
    const t5c2 = this.filterRelevantAlertsByGps([t5c_ombessa], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', 80);
    results.push({
      name: 'ÉTAPE 5C - TEST 2 : Bafia -> Ombessa (20 km <= 80 km) -> RETENUE',
      passed: t5c2.relevantAlerts.length === 1 && t5c2.relevantAlerts[0]?.relativePosition === 'AHEAD',
      details: `relevant: ${t5c2.relevantAlerts.length}, rel: ${t5c2.relevantAlerts[0]?.relativePosition}, dist: ${t5c2.relevantAlerts[0]?.estimatedDistanceKm} km`,
    });

    const t5c_obala = { id: 't5c_obala', latitude: 4.1672, longitude: 11.5333 };
    const t5c3 = this.filterRelevantAlertsByGps([t5c_obala], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', 80);
    results.push({
      name: 'ÉTAPE 5C - TEST 3 : Bafia -> Obala (BEHIND) -> EXCLUE',
      passed: t5c3.relevantAlerts.length === 0 && t5c3.excludedAlerts[0]?.reason === 'BEHIND',
      details: `relevant: ${t5c3.relevantAlerts.length}, reason: ${t5c3.excludedAlerts[0]?.reason}`,
    });

    const t5c4 = this.filterRelevantAlertsByGps([t5c_obala], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', 80);
    results.push({
      name: 'ÉTAPE 5C - TEST 4 : Obala -> Obala (AT_EVENT, 0 km) -> RETENUE',
      passed: t5c4.relevantAlerts.length === 1 && t5c4.relevantAlerts[0]?.relativePosition === 'AT_EVENT',
      details: `relevant: ${t5c4.relevantAlerts.length}, dist: ${t5c4.relevantAlerts[0]?.estimatedDistanceKm} km`,
    });

    const t5c5 = this.filterRelevantAlertsByGps([t5c_bafia], 4.05, 9.7, 'YAOUNDE_TO_BAFOUSSAM', 80);
    results.push({
      name: 'ÉTAPE 5C - TEST 5 : Chauffeur Douala (hors corridor) -> DRIVER_OFF_CORRIDOR',
      passed: t5c5.relevantAlerts.length === 0 && t5c5.excludedAlerts[0]?.reason === 'DRIVER_OFF_CORRIDOR',
      details: `relevant: ${t5c5.relevantAlerts.length}, reason: ${t5c5.excludedAlerts[0]?.reason}`,
    });

    // =========================================================================
    // TESTS OBLIGATOIRES ÉTAPE 5D (PERTINENCE TEMPORELLE DES ALERTES)
    // =========================================================================
    const TEST_NOW = '2026-10-04T12:00:00.000Z';

    // TEST 1 : 11:55:00Z -> âge = 5 min -> FRESH
    const t5d1_age = this.getAlertAgeMinutes('2026-10-04T11:55:00.000Z', TEST_NOW);
    const t5d1_fresh = this.isAlertFresh('2026-10-04T11:55:00.000Z', TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 1 : 5 min -> FRESH',
      passed: t5d1_age === 5 && t5d1_fresh === true,
      details: `age: ${t5d1_age} min (attendu 5), isFresh: ${t5d1_fresh} (attendu true)`,
    });

    // TEST 2 : 11:00:00Z -> âge = 60 min -> FRESH
    const t5d2_age = this.getAlertAgeMinutes('2026-10-04T11:00:00.000Z', TEST_NOW);
    const t5d2_fresh = this.isAlertFresh('2026-10-04T11:00:00.000Z', TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 2 : 60 min -> FRESH',
      passed: t5d2_age === 60 && t5d2_fresh === true,
      details: `age: ${t5d2_age} min (attendu 60), isFresh: ${t5d2_fresh} (attendu true)`,
    });

    // TEST 3 : 10:00:00Z -> âge = 120 min exactement -> FRESH
    const t5d3_age = this.getAlertAgeMinutes('2026-10-04T10:00:00.000Z', TEST_NOW);
    const t5d3_fresh = this.isAlertFresh('2026-10-04T10:00:00.000Z', TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 3 : 120 min exactement -> FRESH',
      passed: t5d3_age === 120 && t5d3_fresh === true,
      details: `age: ${t5d3_age} min (attendu 120), isFresh: ${t5d3_fresh} (attendu true)`,
    });

    // TEST 4 : 09:59:00Z -> âge = 121 min -> STALE
    const t5d4_age = this.getAlertAgeMinutes('2026-10-04T09:59:00.000Z', TEST_NOW);
    const t5d4_fresh = this.isAlertFresh('2026-10-04T09:59:00.000Z', TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 4 : 121 min -> STALE',
      passed: t5d4_age === 121 && t5d4_fresh === false,
      details: `age: ${t5d4_age} min (attendu 121), isFresh: ${t5d4_fresh} (attendu false)`,
    });

    // TEST 5 : 13:00:00Z -> date future -> UNAVAILABLE / false
    const t5d5_age = this.getAlertAgeMinutes('2026-10-04T13:00:00.000Z', TEST_NOW);
    const t5d5_fresh = this.isAlertFresh('2026-10-04T13:00:00.000Z', TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 5 : Date future -> UNAVAILABLE / null',
      passed: t5d5_age === null && t5d5_fresh === false,
      details: `age: ${t5d5_age} (attendu null), isFresh: ${t5d5_fresh} (attendu false)`,
    });

    // TEST 6 : createdAt absent -> UNAVAILABLE / false
    const t5d6_age = this.getAlertAgeMinutes(undefined, TEST_NOW);
    const t5d6_fresh = this.isAlertFresh(undefined, TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 6 : createdAt absent -> UNAVAILABLE / null',
      passed: t5d6_age === null && t5d6_fresh === false,
      details: `age: ${t5d6_age} (attendu null), isFresh: ${t5d6_fresh} (attendu false)`,
    });

    // TEST 7 : createdAt invalide -> UNAVAILABLE / false sans exception
    const t5d7_age = this.getAlertAgeMinutes('invalid-iso-string-xyz', TEST_NOW);
    const t5d7_fresh = this.isAlertFresh('invalid-iso-string-xyz', TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 7 : createdAt invalide -> UNAVAILABLE / null sans exception',
      passed: t5d7_age === null && t5d7_fresh === false,
      details: `age: ${t5d7_age} (attendu null), isFresh: ${t5d7_fresh} (attendu false)`,
    });

    // TEST 8 : 09:30:00Z -> âge = 150 min (180 min -> FRESH, 120 min -> STALE)
    const t5d8_age = this.getAlertAgeMinutes('2026-10-04T09:30:00.000Z', TEST_NOW);
    const t5d8_fresh180 = this.isAlertFresh('2026-10-04T09:30:00.000Z', TEST_NOW, 180);
    const t5d8_fresh120 = this.isAlertFresh('2026-10-04T09:30:00.000Z', TEST_NOW, 120);
    results.push({
      name: 'ÉTAPE 5D - TEST 8 : 150 min configurable (180 min -> FRESH, 120 min -> STALE)',
      passed: t5d8_age === 150 && t5d8_fresh180 === true && t5d8_fresh120 === false,
      details: `age: ${t5d8_age} min, fresh@180: ${t5d8_fresh180}, fresh@120: ${t5d8_fresh120}`,
    });

    // TEST 9 : Vérifier les timestamps Unix en millisecondes
    const t5d9_ts = Date.parse('2026-10-04T11:55:00.000Z');
    const t5d9_age = this.getAlertAgeMinutes(t5d9_ts, TEST_NOW);
    const t5d9_fresh = this.isAlertFresh(t5d9_ts, TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 9 : Timestamp Unix ms -> 5 min FRESH',
      passed: t5d9_age === 5 && t5d9_fresh === true,
      details: `timestamp: ${t5d9_ts}, age: ${t5d9_age} min, isFresh: ${t5d9_fresh}`,
    });

    // TEST 10 : Vérifier les objets Date
    const t5d10_date = new Date('2026-10-04T11:55:00.000Z');
    const t5d10_age = this.getAlertAgeMinutes(t5d10_date, new Date(TEST_NOW));
    const t5d10_fresh = this.isAlertFresh(t5d10_date, new Date(TEST_NOW));
    results.push({
      name: 'ÉTAPE 5D - TEST 10 : Objet Date -> 5 min FRESH',
      passed: t5d10_age === 5 && t5d10_fresh === true,
      details: `Date object, age: ${t5d10_age} min, isFresh: ${t5d10_fresh}`,
    });

    // TEST 11 : Filtrage de liste (1 fraîche, 1 obsolète, 1 sans createdAt)
    const t5d11_alerts = [
      { id: 'fresh-1', createdAt: '2026-10-04T11:30:00.000Z' },
      { id: 'stale-1', createdAt: '2026-10-04T08:00:00.000Z' },
      { id: 'unavail-1' },
    ];
    const t5d11_res = this.filterFreshAlerts(t5d11_alerts, TEST_NOW);
    results.push({
      name: 'ÉTAPE 5D - TEST 11 : filterFreshAlerts -> fresh=1, stale=1, unavailable=1',
      passed: t5d11_res.freshAlerts.length === 1 &&
              t5d11_res.staleAlerts.length === 1 &&
              t5d11_res.unavailableAlerts.length === 1,
      details: `fresh: ${t5d11_res.freshAlerts.length}, stale: ${t5d11_res.staleAlerts.length}, unavailable: ${t5d11_res.unavailableAlerts.length}`,
    });

    // =========================================================================
    // TESTS OBLIGATOIRES ÉTAPE 5E (MOTEUR DE PERTINENCE GÉO + TEMPS)
    // =========================================================================
    const NOW_5E = '2026-10-04T12:00:00.000Z';

    // TEST 1 : Bafia (83 km > 80 km), 11:30 (30 min FRESH)
    const t5e1_alert = { id: 't5e1', latitude: 4.7500, longitude: 11.2333, createdAt: '2026-10-04T11:30:00.000Z' };
    const t5e1_res = this.filterRelevantAlerts([t5e1_alert], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 1 : Bafia (83 km > 80 km) -> TOO_FAR, FRESH -> GEOGRAPHICALLY_EXCLUDED',
      passed: t5e1_res.relevantAlerts.length === 0 &&
              t5e1_res.excludedAlerts.length === 1 &&
              t5e1_res.excludedAlerts[0].geographicStatus === 'TOO_FAR' &&
              t5e1_res.excludedAlerts[0].temporalStatus === 'FRESH' &&
              t5e1_res.excludedAlerts[0].reason === 'GEOGRAPHICALLY_EXCLUDED',
      details: `geo: ${t5e1_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e1_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e1_res.excludedAlerts[0]?.reason}`,
    });

    // TEST 2 : Ombessa PK 145 (20 km devant Chauffeur Bafia PK 125), 11:30 (30 min FRESH)
    const t5e2_alert = { id: 't5e2', latitude: 4.6000, longitude: 11.2500, createdAt: '2026-10-04T11:30:00.000Z' };
    const t5e2_res = this.filterRelevantAlerts([t5e2_alert], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 2 : Ombessa devant Bafia (20 km, FRESH) -> RELEVANT',
      passed: t5e2_res.relevantAlerts.length === 1 &&
              t5e2_res.relevantAlerts[0].relativePosition === 'AHEAD' &&
              t5e2_res.relevantAlerts[0].estimatedDistanceKm === 20 &&
              t5e2_res.relevantAlerts[0].ageMinutes === 30,
      details: `rel: ${t5e2_res.relevantAlerts[0]?.relativePosition}, dist: ${t5e2_res.relevantAlerts[0]?.estimatedDistanceKm} km, age: ${t5e2_res.relevantAlerts[0]?.ageMinutes} min`,
    });

    // TEST 3 : Ombessa 20 km devant, createdAt 09:00:00Z (180 min -> STALE)
    const t5e3_alert = { id: 't5e3', latitude: 4.6000, longitude: 11.2500, createdAt: '2026-10-04T09:00:00.000Z' };
    const t5e3_res = this.filterRelevantAlerts([t5e3_alert], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 3 : Ombessa (20 km, STALE 180 min) -> TEMPORALLY_EXCLUDED',
      passed: t5e3_res.relevantAlerts.length === 0 &&
              t5e3_res.excludedAlerts.length === 1 &&
              t5e3_res.excludedAlerts[0].geographicStatus === 'RELEVANT' &&
              t5e3_res.excludedAlerts[0].temporalStatus === 'STALE' &&
              t5e3_res.excludedAlerts[0].reason === 'TEMPORALLY_EXCLUDED',
      details: `geo: ${t5e3_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e3_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e3_res.excludedAlerts[0]?.reason}`,
    });

    // TEST 4 : Obala même position que chauffeur (AT_EVENT, 0 km), 11:55 (5 min FRESH)
    const t5e4_alert = { id: 't5e4', latitude: 4.1672, longitude: 11.5333, createdAt: '2026-10-04T11:55:00.000Z' };
    const t5e4_res = this.filterRelevantAlerts([t5e4_alert], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 4 : Obala AT_EVENT (0 km, FRESH) -> RELEVANT',
      passed: t5e4_res.relevantAlerts.length === 1 &&
              t5e4_res.relevantAlerts[0].relativePosition === 'AT_EVENT' &&
              t5e4_res.relevantAlerts[0].estimatedDistanceKm === 0,
      details: `rel: ${t5e4_res.relevantAlerts[0]?.relativePosition}, dist: ${t5e4_res.relevantAlerts[0]?.estimatedDistanceKm} km`,
    });

    // TEST 5 : Yaoundé PK 0, Chauffeur Obala PK 42 (BEHIND), 11:55 (FRESH)
    const t5e5_alert = { id: 't5e5', latitude: 3.8667, longitude: 11.5167, createdAt: '2026-10-04T11:55:00.000Z' };
    const t5e5_res = this.filterRelevantAlerts([t5e5_alert], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 5 : Yaoundé derrière Obala (BEHIND, FRESH) -> GEOGRAPHICALLY_EXCLUDED',
      passed: t5e5_res.relevantAlerts.length === 0 &&
              t5e5_res.excludedAlerts.length === 1 &&
              t5e5_res.excludedAlerts[0].geographicStatus === 'BEHIND' &&
              t5e5_res.excludedAlerts[0].temporalStatus === 'FRESH' &&
              t5e5_res.excludedAlerts[0].reason === 'GEOGRAPHICALLY_EXCLUDED',
      details: `geo: ${t5e5_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e5_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e5_res.excludedAlerts[0]?.reason}`,
    });

    // TEST 6 : Ombessa 20 km devant, Date future (13:00)
    const t5e6_alert = { id: 't5e6', latitude: 4.6000, longitude: 11.2500, createdAt: '2026-10-04T13:00:00.000Z' };
    const t5e6_res = this.filterRelevantAlerts([t5e6_alert], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 6 : Ombessa (Date future) -> TEMPORALLY_EXCLUDED',
      passed: t5e6_res.relevantAlerts.length === 0 &&
              t5e6_res.excludedAlerts.length === 1 &&
              t5e6_res.excludedAlerts[0].geographicStatus === 'RELEVANT' &&
              t5e6_res.excludedAlerts[0].temporalStatus === 'TEMPORAL_UNAVAILABLE' &&
              t5e6_res.excludedAlerts[0].reason === 'TEMPORALLY_EXCLUDED',
      details: `geo: ${t5e6_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e6_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e6_res.excludedAlerts[0]?.reason}`,
    });

    // TEST 7 : Ombessa 20 km devant, createdAt absent
    const t5e7_alert = { id: 't5e7', latitude: 4.6000, longitude: 11.2500 };
    const t5e7_res = this.filterRelevantAlerts([t5e7_alert], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 7 : Ombessa (createdAt absent) -> TEMPORALLY_EXCLUDED',
      passed: t5e7_res.relevantAlerts.length === 0 &&
              t5e7_res.excludedAlerts.length === 1 &&
              t5e7_res.excludedAlerts[0].geographicStatus === 'RELEVANT' &&
              t5e7_res.excludedAlerts[0].temporalStatus === 'TEMPORAL_UNAVAILABLE' &&
              t5e7_res.excludedAlerts[0].reason === 'TEMPORALLY_EXCLUDED',
      details: `geo: ${t5e7_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e7_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e7_res.excludedAlerts[0]?.reason}`,
    });

    // TEST 8 : Chauffeur à Douala (hors corridor), alerte Ombessa fraîche
    const t5e8_res = this.filterRelevantAlerts([t5e2_alert], 4.0500, 9.7000, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 8 : Chauffeur Douala (hors corridor) -> GEOGRAPHICALLY_EXCLUDED',
      passed: t5e8_res.relevantAlerts.length === 0 &&
              t5e8_res.isDriverOnCorridor === false &&
              t5e8_res.excludedAlerts[0].geographicStatus === 'DRIVER_OFF_CORRIDOR' &&
              t5e8_res.excludedAlerts[0].reason === 'GEOGRAPHICALLY_EXCLUDED',
      details: `geo: ${t5e8_res.excludedAlerts[0]?.geographicStatus}, isDriverOnCorridor: ${t5e8_res.isDriverOnCorridor}`,
    });

    // TEST 9 : Liste de 5 alertes
    const alertA = { id: 'A', name: 'Ombessa fraîche', latitude: 4.6000, longitude: 11.2500, createdAt: '2026-10-04T11:30:00.000Z' };
    const alertB = { id: 'B', name: 'Obala fraîche', latitude: 4.1672, longitude: 11.5333, createdAt: '2026-10-04T11:55:00.000Z' };
    const alertC = { id: 'C', name: 'Yaoundé fraîche', latitude: 3.8667, longitude: 11.5167, createdAt: '2026-10-04T11:55:00.000Z' };
    const alertD = { id: 'D', name: 'Ombessa obsolète', latitude: 4.6000, longitude: 11.2500, createdAt: '2026-10-04T08:00:00.000Z' };
    const alertE = { id: 'E', name: 'Ombessa sans date', latitude: 4.6000, longitude: 11.2500 };
    const t5e9_res = this.filterRelevantAlerts([alertA, alertB, alertC, alertD, alertE], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E, 120);
    const t5e9_relIds = t5e9_res.relevantAlerts.map(r => r.alert.id).sort().join(',');
    const t5e9_exclIds = t5e9_res.excludedAlerts.map(e => e.alert.id).sort().join(',');
    results.push({
      name: 'ÉTAPE 5E - TEST 9 : Liste 5 alertes -> rel=A,B, excl=C,D,E',
      passed: t5e9_relIds === 'A,B' && t5e9_exclIds === 'C,D,E',
      details: `relevant: [${t5e9_relIds}], excluded: [${t5e9_exclIds}]`,
    });

    // TEST 10 : Limites exactes (80 km pile, 120 min pile)
    const alertNdiki = { id: 'ndiki', latitude: 4.7667, longitude: 10.8333, createdAt: '2026-10-04T10:00:00.000Z' }; // 80 km, 120 min
    const t5e10_res = this.filterRelevantAlerts([alertNdiki], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E, 80, 120);
    const alertNdikiOverDist = { id: 'ndiki-far', latitude: 4.7667, longitude: 10.8333, createdAt: '2026-10-04T10:00:00.000Z' };
    const t5e10_resDist = this.filterRelevantAlerts([alertNdikiOverDist], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E, 79, 120);
    const alertNdikiOverTime = { id: 'ndiki-stale', latitude: 4.7667, longitude: 10.8333, createdAt: '2026-10-04T09:59:00.000Z' }; // 121 min
    const t5e10_resTime = this.filterRelevantAlerts([alertNdikiOverTime], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E, 80, 120);
    results.push({
      name: 'ÉTAPE 5E - TEST 10 : Limites exactes (80 km pile, 120 min pile)',
      passed: t5e10_res.relevantAlerts.length === 1 &&
              t5e10_resDist.relevantAlerts.length === 0 &&
              t5e10_resTime.relevantAlerts.length === 0,
      details: `exacte: ${t5e10_res.relevantAlerts.length}, overDist: ${t5e10_resDist.relevantAlerts.length}, overTime: ${t5e10_resTime.relevantAlerts.length}`,
    });

    // TEST 11 : Yaoundé PK 0 (BEHIND), createdAt 08:00 (STALE 240 min) -> reason = BOTH
    const t5e11_alert = { id: 't5e11', latitude: 3.8667, longitude: 11.5167, createdAt: '2026-10-04T08:00:00.000Z' };
    const t5e11_res = this.filterRelevantAlerts([t5e11_alert], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 11 : BEHIND + STALE -> reason = BOTH',
      passed: t5e11_res.excludedAlerts[0]?.geographicStatus === 'BEHIND' &&
              t5e11_res.excludedAlerts[0]?.temporalStatus === 'STALE' &&
              t5e11_res.excludedAlerts[0]?.reason === 'BOTH',
      details: `geo: ${t5e11_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e11_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e11_res.excludedAlerts[0]?.reason}`,
    });

    // TEST 12 : latitude = NaN, createdAt frais -> COORDINATES_INVALID, FRESH -> GEOGRAPHICALLY_EXCLUDED
    const t5e12_alert = { id: 't5e12', latitude: NaN, longitude: 11.2333, createdAt: '2026-10-04T11:30:00.000Z' };
    const t5e12_res = this.filterRelevantAlerts([t5e12_alert], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_5E);
    results.push({
      name: 'ÉTAPE 5E - TEST 12 : latitude = NaN, FRESH -> COORDINATES_INVALID, GEOGRAPHICALLY_EXCLUDED',
      passed: t5e12_res.excludedAlerts[0]?.geographicStatus === 'COORDINATES_INVALID' &&
              t5e12_res.excludedAlerts[0]?.temporalStatus === 'FRESH' &&
              t5e12_res.excludedAlerts[0]?.reason === 'GEOGRAPHICALLY_EXCLUDED',
      details: `geo: ${t5e12_res.excludedAlerts[0]?.geographicStatus}, temp: ${t5e12_res.excludedAlerts[0]?.temporalStatus}, reason: ${t5e12_res.excludedAlerts[0]?.reason}`,
    });

    // =========================================================================
    // SYNTHÈSE GLOBALE DES BLOCS ROUTEGUARD
    // =========================================================================
    const c5cTests = results.filter(r => r.name.includes('ÉTAPE 5C') || r.name.includes('ÉTAPE 5B'));
    const c5dTests = results.filter(r => r.name.includes('ÉTAPE 5D'));
    const c5eTests = results.filter(r => r.name.includes('ÉTAPE 5E'));

    const is5CPassed = c5cTests.length > 0 && c5cTests.every(r => r.passed);
    const is5DPassed = c5dTests.length > 0 && c5dTests.every(r => r.passed);
    const is5EPassed = c5eTests.length > 0 && c5eTests.every(r => r.passed);

    results.push({
      name: '5C : ' + (is5CPassed ? 'PASS' : 'FAIL'),
      passed: is5CPassed,
      details: `5C : ${is5CPassed ? 'PASS' : 'FAIL'} (${c5cTests.length} tests unitaires géographiques validés)`,
    });
    results.push({
      name: '5D : ' + (is5DPassed ? 'PASS' : 'FAIL'),
      passed: is5DPassed,
      details: `5D : ${is5DPassed ? 'PASS' : 'FAIL'} (${c5dTests.length} tests unitaires temporels validés)`,
    });
    results.push({
      name: '5E : ' + (is5EPassed ? 'PASS' : 'FAIL'),
      passed: is5EPassed,
      details: `5E : ${is5EPassed ? 'PASS' : 'FAIL'} (${c5eTests.length} tests de composition validés)`,
    });

    return results;
  }
}

export const corridorService = CorridorService.getInstance();

/**
 * Fonction pure exportée pour la projection directe de coordonnées GPS sur l'axe N4 (Étape 1)
 */
export const getCorridorPosition = (
  latitude: number,
  longitude: number
): CorridorPositionResult => {
  return corridorService.getCorridorPosition(latitude, longitude);
};

/**
 * Fonction pure exportée pour la comparaison directe Chauffeur ↔ Alerte (Étape 4A)
 */
export const getRelativeAlertPosition = (
  driverPk: number,
  alertPk: number,
  direction: CorridorDirection,
  toleranceKm: number = DEFAULT_EVENT_TOLERANCE_KM
): RelativeAlertPositionResult => {
  return corridorService.getRelativeAlertPosition(driverPk, alertPk, direction, toleranceKm);
};

/**
 * Fonction pure exportée pour la conversion directe des coordonnées d'une alerte en PK ROUTEGUARD (Étape 4B)
 */
export const getAlertCorridorPosition = (
  latitude: number,
  longitude: number
): CorridorPositionResult => {
  return corridorService.getAlertCorridorPosition(latitude, longitude);
};

/**
 * Fonction pure exportée pour déterminer la position relative d'une alerte à partir des coordonnées GPS (Étape 5B)
 */
export const getRelativeAlertPositionFromCoordinates = (
  driverLatitude: number,
  driverLongitude: number,
  alertLatitude: number,
  alertLongitude: number,
  direction: CorridorDirection,
  toleranceKm: number = DEFAULT_EVENT_TOLERANCE_KM
): RelativeAlertPositionFromCoordinatesResult => {
  return corridorService.getRelativeAlertPositionFromCoordinates(
    driverLatitude,
    driverLongitude,
    alertLatitude,
    alertLongitude,
    direction,
    toleranceKm
  );
};

/**
 * Fonction pure exportée pour le filtrage local des alertes géographiquement pertinentes (Étape 5C)
 */
export const filterRelevantAlertsByGps = <T extends { latitude?: number; longitude?: number }>(
  alerts: readonly T[],
  driverLatitude: number,
  driverLongitude: number,
  direction: CorridorDirection,
  maxDistanceKm: number = DEFAULT_MAX_ALERT_DISTANCE_KM
): FilterRelevantAlertsByGpsResult<T> => {
  return corridorService.filterRelevantAlertsByGps(
    alerts,
    driverLatitude,
    driverLongitude,
    direction,
    maxDistanceKm
  );
};

/**
 * Fonction pure exportée pour le calcul de l'âge d'une alerte en minutes (Étape 5D)
 */
export const getAlertAgeMinutes = (
  createdAt: number | string | Date | undefined,
  now?: number | string | Date
): number | null => {
  return corridorService.getAlertAgeMinutes(createdAt, now);
};

/**
 * Fonction pure exportée pour tester si une alerte est fraîche (Étape 5D)
 */
export const isAlertFresh = (
  createdAt: number | string | Date | undefined,
  now?: number | string | Date,
  maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
): boolean => {
  return corridorService.isAlertFresh(createdAt, now, maxAgeMinutes);
};

/**
 * Fonction pure exportée pour le filtrage temporel pur des alertes (Étape 5D)
 */
export const filterFreshAlerts = <T extends { createdAt?: number | string | Date }>(
  alerts: readonly T[],
  now?: number | string | Date,
  maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
): FilterFreshAlertsResult<T> => {
  return corridorService.filterFreshAlerts(alerts, now, maxAgeMinutes);
};

/**
 * Fonction pure exportée pour le moteur de pertinence global ROUTEGUARD (Étape 5E)
 */
export const filterRelevantAlerts = <
  T extends {
    latitude?: number;
    longitude?: number;
    createdAt?: number | string | Date;
  }
>(
  alerts: readonly T[],
  driverLatitude: number,
  driverLongitude: number,
  direction: CorridorDirection,
  now?: number | string | Date,
  maxDistanceKm: number = DEFAULT_MAX_ALERT_DISTANCE_KM,
  maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
): FilterRelevantAlertsResult<T> => {
  return corridorService.filterRelevantAlerts(
    alerts,
    driverLatitude,
    driverLongitude,
    direction,
    now,
    maxDistanceKm,
    maxAgeMinutes
  );
};

