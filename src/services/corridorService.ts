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
