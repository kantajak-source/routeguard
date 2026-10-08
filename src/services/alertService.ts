import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  increment,
  arrayUnion,
  getDocs,
  getDoc,
  limit
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { AlertItem, AlertRecord, AlertStatus } from '../types/routeguard';
import { INITIAL_ALERTS } from '../data/initialAlerts';
import { authService } from './authService';
import {
  corridorService,
  filterRelevantAlerts,
  prioritizeRelevantAlerts,
  CorridorDirection,
  FilterRelevantAlertsResult,
  RelevantAlertItem,
  PrioritizedAlertItem,
  DEFAULT_MAX_ALERT_DISTANCE_KM,
  DEFAULT_MAX_ALERT_AGE_MINUTES,
} from './corridorService';

const CURRENT_DRIVER_KEY = 'routeguard_active_driver_v1';
const ALERTS_COLLECTION = 'alerts';

export interface AlertDataSourceInfo {
  isFirebaseConnected: boolean;
  collectionPath: string;
  sourceType: 'FIRESTORE' | 'SHARED_LOCAL_CHANNEL';
  activeDriver: string;
}

/**
 * Service de données partagées Firebase Firestore pour ROUTEGUARD.
 * Connecte la collection 'alerts' en temps réel via le SDK Firebase.
 */
export class FirebaseAlertService {
  private static instance: FirebaseAlertService;
  private activeDriver: string = 'Chauffeur A (Jean)';
  private isSeeded: boolean = false;
  private cachedAlerts: AlertItem[] = [];

  private constructor() {
    this.initActiveDriver();
  }

  public static getInstance(): FirebaseAlertService {
    if (!FirebaseAlertService.instance) {
      FirebaseAlertService.instance = new FirebaseAlertService();
    }
    return FirebaseAlertService.instance;
  }

  private initActiveDriver(): void {
    if (typeof window === 'undefined') return;
    try {
      const savedDriver = localStorage.getItem(CURRENT_DRIVER_KEY);
      if (savedDriver) {
        this.activeDriver = savedDriver;
      }
    } catch {}
  }

  /**
   * Initialise les données de référence sur Firestore si la collection est vide
   */
  private async seedInitialAlertsIfEmpty(): Promise<void> {
    if (this.isSeeded) return;
    this.isSeeded = true;

    try {
      const snapshot = await getDocs(query(collection(db, ALERTS_COLLECTION), limit(1)));
      if (snapshot.empty) {
        // Ensemencer les alertes initiales
        for (const alert of INITIAL_ALERTS) {
          const docRef = doc(db, ALERTS_COLLECTION, alert.id);
          await setDoc(docRef, {
            id: alert.id,
            type: alert.type,
            description: alert.description || alert.title,
            location: alert.location || alert.sector,
            direction: alert.direction.replace('→', '').trim(),
            route: alert.route || 'Yaoundé-Bafoussam',
            status: 'CONFIRMED',
            confirmationCount: alert.confirmationsCount || alert.confirmationCount || 1,
            audioDuration: alert.audioDuration || '0:12',
            audioTranscript: alert.audioTranscript || alert.description,
            createdBy: alert.createdBy || 'Chauffeur N4',
            createdAt: alert.createdAt || Date.now(),
            confirmedBy: alert.confirmedBy || ['Chauffeur 101', 'Chauffeur 104', 'Chauffeur 208', 'Chauffeur 312'],
          });
        }
      }
    } catch (error) {
      // Ignorer si la collection a déjà des documents ou si hors-ligne
      console.warn('Initial seeding verification:', error);
    }
  }

  /**
   * Convertit un document Firestore en objet AlertItem pour l'interface
   */
  public mapDocToAlertItem(id: string, data: any): AlertItem {
    const currentUid = authService.getCurrentUserId();

    // Détermination de userConfirmed :
    // 1. Pour les nouvelles alertes : utiliser confirmedByUids.includes(currentUid) si disponible
    // 2. Pour les anciennes alertes sans confirmedByUids : conserver temporairement le mécanisme historique
    let isUserConfirmed = false;
    if (data.confirmedByUids && Array.isArray(data.confirmedByUids) && currentUid) {
      isUserConfirmed = data.confirmedByUids.includes(currentUid);
    } else {
      isUserConfirmed = (data.confirmedBy || []).includes(this.activeDriver);
    }

    const count = typeof data.confirmationCount === 'number' ? data.confirmationCount : (data.confirmationsCount || 1);

    const type = data.type || 'VEHICULE_IMMOBILISE';
    const severity = type === 'ACCIDENT' ? 'CRITIQUE' : (type === 'FORTE_PLUIE' ? 'INFO' : 'PRUDENCE');

    const formattedDirection = data.direction?.startsWith('→') ? data.direction : `→ ${data.direction || 'Bafoussam'}`;

    const isUserCreated = Boolean(
      (currentUid && data.createdByUid && data.createdByUid === currentUid)
      || (data.createdBy && data.createdBy.includes(this.activeDriver))
    );

    const item: AlertItem = {
      id,
      type,
      severity,
      title: type.replace('_', ' '),
      badgeText: type.replace('_', ' '),
      description: data.description || '',
      location: data.location || data.sector || 'Axe Bafia',
      route: data.route || 'Yaoundé-Bafoussam',
      status: (data.status as AlertStatus) || 'CONFIRMED',
      createdBy: data.createdBy || 'Chauffeur',
      createdByUid: data.createdByUid,
      distanceText: data.location || data.sector || 'Secteur N4',
      sector: data.location || data.sector || 'Secteur N4',
      direction: formattedDirection,
      subDetail: `Signalé par ${data.createdBy || 'un confrère'} • Corridor N4`,
      audioDuration: data.audioDuration || '0:12',
      audioTranscript: data.audioTranscript || data.description || '',
      confirmationsCount: count,
      confirmationCount: count,
      confirmedBy: data.confirmedBy || [],
      confirmedByUids: data.confirmedByUids || [],
      timeAgo: this.calculateTimeAgo(data.createdAt || Date.now()),
      createdAt: data.createdAt || Date.now(),
      isUserCreated,
      userConfirmed: isUserConfirmed,
      latitude: typeof data.latitude === 'number' ? data.latitude : undefined,
      longitude: typeof data.longitude === 'number' ? data.longitude : undefined,
      accuracy: typeof data.accuracy === 'number' ? data.accuracy : undefined,
    };

    // ÉTAPE 5A : Conserver estimatedPk et roadAxis si présents dans Firestore (rétrocompatibilité totale)
    if (typeof data.estimatedPk === 'number') {
      (item as any).estimatedPk = data.estimatedPk;
    }
    if (typeof data.roadAxis === 'string') {
      (item as any).roadAxis = data.roadAxis;
    }

    return item;
  }

  private calculateTimeAgo(timestamp: number): string {
    const elapsedMinutes = Math.floor((Date.now() - timestamp) / (60 * 1000));
    if (elapsedMinutes <= 1) return 'À l’instant';
    if (elapsedMinutes < 60) return `Il y a ${elapsedMinutes} min`;
    const hours = Math.floor(elapsedMinutes / 60);
    return `Il y a ${hours} h`;
  }

  /**
   * Abonnement temps réel à la collection Firestore 'alerts'
   */
  public subscribeAlerts(callback: (alerts: AlertItem[]) => void): () => void {
    // Tenter l'ensemencement au démarrage si nécessaire
    this.seedInitialAlertsIfEmpty();

    const alertsQuery = query(
      collection(db, ALERTS_COLLECTION),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      alertsQuery,
      (snapshot) => {
        const items: AlertItem[] = [];
        snapshot.forEach((docSnap) => {
          items.push(this.mapDocToAlertItem(docSnap.id, docSnap.data()));
        });

        // Si Firestore est pour le moment vide, utiliser les alertes locales initiales en attendant
        if (items.length === 0 && INITIAL_ALERTS.length > 0) {
          const defaults = INITIAL_ALERTS.map(a => ({
            ...a,
            userConfirmed: (a.confirmedBy || []).includes(this.activeDriver),
          }));
          this.cachedAlerts = defaults;
          callback(defaults);
        } else {
          this.cachedAlerts = items;
          callback(items);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, ALERTS_COLLECTION);
      }
    );

    return () => {
      unsubscribe();
    };
  }

  /**
   * Récupère la liste des alertes une fois
   */
  public async getAlerts(): Promise<AlertItem[]> {
    try {
      const q = query(collection(db, ALERTS_COLLECTION), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const items: AlertItem[] = [];
      snapshot.forEach((docSnap) => {
        items.push(this.mapDocToAlertItem(docSnap.id, docSnap.data()));
      });
      return items.length > 0 ? items : INITIAL_ALERTS;
    } catch {
      return this.cachedAlerts.length > 0 ? this.cachedAlerts : INITIAL_ALERTS;
    }
  }

  /**
   * ÉTAPE 6A : Récupère les alertes Firestore et calcule localement lesquelles sont pertinentes pour un chauffeur.
   * Chaîne complète : Firestore -> mapDocToAlertItem -> filterRelevantAlerts()
   * 
   * Ne modifie aucun document Firestore.
   * N'effectue aucun appel GPS matériel ni Gemini.
   */
  public async getRelevantAlertsForDriver(
    driverLatitude: number,
    driverLongitude: number,
    direction: CorridorDirection,
    now?: number | string | Date,
    maxDistanceKm: number = DEFAULT_MAX_ALERT_DISTANCE_KM,
    maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
  ): Promise<FilterRelevantAlertsResult<AlertItem>> {
    // 1. Lire les alertes depuis Firestore avec la logique existante (sans modifier les documents)
    const alerts = await this.getAlerts();

    // 2. Filtrer localement via le moteur pur de pertinence
    const result = filterRelevantAlerts(
      alerts,
      driverLatitude,
      driverLongitude,
      direction,
      now,
      maxDistanceKm,
      maxAgeMinutes
    );

    // 3. Prioriser UNIQUEMENT les alertes pertinentes (Étape J-1-3-3-A)
    return {
      ...result,
      relevantAlerts: prioritizeRelevantAlerts(result.relevantAlerts) as (RelevantAlertItem<AlertItem> & { ageMinutes: number })[],
    };
  }

  /**
   * ÉTAPE 6A : Auto-diagnostic local du branchement alertService -> corridorService.
   * Utilise des données purement simulées, SANS aucun appel Firestore, SANS GPS, SANS Gemini.
   */
  public runAlertServiceSelfCheck(): { name: string; passed: boolean; details: string }[] {
    const results: { name: string; passed: boolean; details: string }[] = [];
    const NOW_TEST = '2026-10-04T12:00:00.000Z';
    const nowMs = Date.parse(NOW_TEST);

    // TEST A : Chauffeur Obala, Alerte Bafia (83 km > 80 km) -> TOO_FAR
    const alertA = this.mapDocToAlertItem('alert-a', {
      type: 'ACCIDENT',
      description: 'Accident vers Bafia',
      latitude: 4.7500,
      longitude: 11.2333,
      createdAt: nowMs - 30 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const resA = filterRelevantAlerts([alertA], 4.1672, 11.5333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    results.push({
      name: 'TEST A : Chauffeur Obala, Alerte Bafia (83 km > 80 km) -> TOO_FAR',
      passed: resA.relevantAlerts.length === 0 &&
              resA.excludedAlerts.length === 1 &&
              resA.excludedAlerts[0]?.geographicStatus === 'TOO_FAR' &&
              resA.excludedAlerts[0]?.reason === 'GEOGRAPHICALLY_EXCLUDED',
      details: `relevant: ${resA.relevantAlerts.length}, excluded: ${resA.excludedAlerts.length}, geoStatus: ${resA.excludedAlerts[0]?.geographicStatus}`,
    });

    // TEST B : Chauffeur Bafia, Alerte Ombessa (20 km, FRESH 30 min) -> RELEVANT
    const alertB = this.mapDocToAlertItem('alert-b', {
      type: 'VEHICULE_IMMOBILISE',
      description: 'Camion en panne Ombessa',
      latitude: 4.6000,
      longitude: 11.2500,
      createdAt: nowMs - 30 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const resB = filterRelevantAlerts([alertB], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    results.push({
      name: 'TEST B : Chauffeur Bafia, Alerte Ombessa (20 km, FRESH) -> RELEVANT',
      passed: resB.relevantAlerts.length === 1 &&
              resB.relevantAlerts[0]?.relativePosition === 'AHEAD' &&
              resB.relevantAlerts[0]?.estimatedDistanceKm === 20 &&
              resB.relevantAlerts[0]?.ageMinutes === 30,
      details: `relevant: ${resB.relevantAlerts.length}, rel: ${resB.relevantAlerts[0]?.relativePosition}, dist: ${resB.relevantAlerts[0]?.estimatedDistanceKm} km`,
    });

    // TEST C : Chauffeur Bafia, Alerte Ombessa vieille de 180 min -> TEMPORALLY_EXCLUDED
    const alertC = this.mapDocToAlertItem('alert-c', {
      type: 'VEHICULE_IMMOBILISE',
      description: 'Panne ancienne Ombessa',
      latitude: 4.6000,
      longitude: 11.2500,
      createdAt: nowMs - 180 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const resC = filterRelevantAlerts([alertC], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    results.push({
      name: 'TEST C : Ombessa vieille de 180 min -> TEMPORALLY_EXCLUDED',
      passed: resC.relevantAlerts.length === 0 &&
              resC.excludedAlerts.length === 1 &&
              resC.excludedAlerts[0]?.reason === 'TEMPORALLY_EXCLUDED',
      details: `relevant: ${resC.relevantAlerts.length}, reason: ${resC.excludedAlerts[0]?.reason}`,
    });

    // TEST D : Chauffeur Bafia, Alerte Yaoundé (BEHIND) -> GEOGRAPHICALLY_EXCLUDED
    const alertD = this.mapDocToAlertItem('alert-d', {
      type: 'RALENTISSEMENT',
      description: 'Ralentissement Yaoundé',
      latitude: 3.8667,
      longitude: 11.5167,
      createdAt: nowMs - 30 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const resD = filterRelevantAlerts([alertD], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    results.push({
      name: 'TEST D : Chauffeur Bafia, Alerte Yaoundé (BEHIND) -> GEOGRAPHICALLY_EXCLUDED',
      passed: resD.relevantAlerts.length === 0 &&
              resD.excludedAlerts.length === 1 &&
              resD.excludedAlerts[0]?.geographicStatus === 'BEHIND' &&
              resD.excludedAlerts[0]?.reason === 'GEOGRAPHICALLY_EXCLUDED',
      details: `relevant: ${resD.relevantAlerts.length}, geoStatus: ${resD.excludedAlerts[0]?.geographicStatus}`,
    });

    // TEST E : Chauffeur à Douala (hors corridor), Alerte Ombessa -> DRIVER_OFF_CORRIDOR
    const resE = filterRelevantAlerts([alertB], 4.05, 9.7, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    results.push({
      name: 'TEST E : Chauffeur à Douala (hors corridor) -> DRIVER_OFF_CORRIDOR',
      passed: resE.relevantAlerts.length === 0 &&
              resE.isDriverOnCorridor === false &&
              resE.excludedAlerts[0]?.geographicStatus === 'DRIVER_OFF_CORRIDOR',
      details: `relevant: ${resE.relevantAlerts.length}, isDriverOnCorridor: ${resE.isDriverOnCorridor}, geoStatus: ${resE.excludedAlerts[0]?.geographicStatus}`,
    });

    // TEST F : Alerte sans latitude/longitude -> aucune exception, GPS_UNAVAILABLE
    const alertF = this.mapDocToAlertItem('alert-f', {
      type: 'ZONE_DANGEREUSE',
      description: 'Alerte textuelle historique',
      createdAt: nowMs - 30 * 60 * 1000,
      direction: 'Bafoussam',
    });
    let threwF = false;
    let resF: any = null;
    try {
      resF = filterRelevantAlerts([alertF], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    } catch {
      threwF = true;
    }
    results.push({
      name: 'TEST F : Alerte sans GPS -> aucune exception, excludedAlerts présent',
      passed: !threwF &&
              resF?.relevantAlerts.length === 0 &&
              resF?.excludedAlerts.length === 1 &&
              resF?.excludedAlerts[0]?.geographicStatus === 'GPS_UNAVAILABLE',
      details: `exception: ${threwF}, relevant: ${resF?.relevantAlerts.length}, geoStatus: ${resF?.excludedAlerts[0]?.geographicStatus}`,
    });

    // TEST 8 : TEST D'INTÉGRATION AVEC mapDocToAlertItem()
    const rawFirestoreDoc = {
      id: 'doc-full-integration',
      type: 'ACCIDENT',
      description: 'Accident grave PK 145',
      location: 'Ombessa Centre',
      direction: 'Bafoussam',
      route: 'Yaoundé-Bafoussam',
      createdAt: nowMs - 25 * 60 * 1000,
      status: 'CONFIRMED',
      confirmationCount: 4,
      createdBy: 'Chauffeur 102',
      latitude: 4.6000,
      longitude: 11.2500,
      accuracy: 12,
      estimatedPk: 145,
      roadAxis: 'N4',
    };
    const mappedItem = this.mapDocToAlertItem(rawFirestoreDoc.id, rawFirestoreDoc);
    const isIntegrityOk =
      mappedItem.latitude === 4.6000 &&
      mappedItem.longitude === 11.2500 &&
      mappedItem.createdAt === rawFirestoreDoc.createdAt &&
      (mappedItem as any).estimatedPk === 145 &&
      (mappedItem as any).roadAxis === 'N4' &&
      mappedItem.type === 'ACCIDENT' &&
      mappedItem.confirmationCount === 4;

    const resIntegration = filterRelevantAlerts([mappedItem], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    const isIntegrationFilterOk =
      resIntegration.relevantAlerts.length === 1 &&
      resIntegration.relevantAlerts[0]?.alert.id === 'doc-full-integration' &&
      resIntegration.relevantAlerts[0]?.alert.latitude === 4.6000 &&
      resIntegration.relevantAlerts[0]?.alert.longitude === 11.2500 &&
      resIntegration.relevantAlerts[0]?.relativePosition === 'AHEAD';

    results.push({
      name: 'TEST INTÉGRATION mapDocToAlertItem -> filterRelevantAlerts',
      passed: isIntegrityOk && isIntegrationFilterOk,
      details: `intégrité: ${isIntegrityOk}, filtrage moteur: ${isIntegrationFilterOk}`,
    });

    // =========================================================================
    // TESTS J-1-3-3-A : INTÉGRATION DE LA PRIORISATION DANS ALERTSERVICE
    // =========================================================================

    // T01 : Deux alertes pertinentes : ACCIDENT AHEAD 50 km, ACCIDENT AHEAD 5 km -> 5 km première
    const alertT01_50 = this.mapDocToAlertItem('t01-50', {
      type: 'ACCIDENT',
      description: 'Accident 50km',
      latitude: 4.8428,
      longitude: 11.0643, // PK 175 -> 50 km devant Chauffeur Bafia PK 125
      createdAt: nowMs - 10 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const alertT01_5 = this.mapDocToAlertItem('t01-5', {
      type: 'ACCIDENT',
      description: 'Accident 5km',
      latitude: 4.7125,
      longitude: 11.2375, // PK 130 -> 5 km devant Chauffeur Bafia PK 125
      createdAt: nowMs - 10 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const filterT01 = filterRelevantAlerts([alertT01_50, alertT01_5], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    const prioritizedT01 = prioritizeRelevantAlerts(filterT01.relevantAlerts);
    results.push({
      name: 'J-1-3-3-A - T01 : ACCIDENT 50 km vs ACCIDENT 5 km -> 5 km première',
      passed: prioritizedT01.length === 2 && prioritizedT01[0].alert.id === 't01-5' && prioritizedT01[1].alert.id === 't01-50',
      details: `premier: ${prioritizedT01[0]?.alert.id} (${prioritizedT01[0]?.estimatedDistanceKm} km)`,
    });

    // T02 : ACCIDENT AHEAD 5 km vs VEHICULE_IMMOBILISE AHEAD 5 km -> ACCIDENT premier
    const alertT02_panne = this.mapDocToAlertItem('t02-panne', {
      type: 'VEHICULE_IMMOBILISE',
      description: 'Camion en panne 5km',
      latitude: 4.7125,
      longitude: 11.2375, // PK 130 -> 5 km
      createdAt: nowMs - 10 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const filterT02 = filterRelevantAlerts([alertT02_panne, alertT01_5], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    const prioritizedT02 = prioritizeRelevantAlerts(filterT02.relevantAlerts);
    results.push({
      name: 'J-1-3-3-A - T02 : ACCIDENT AHEAD 5 km vs VEHICULE_IMMOBILISE AHEAD 5 km -> ACCIDENT premier',
      passed: prioritizedT02.length === 2 && prioritizedT02[0].alert.id === 't01-5' && prioritizedT02[1].alert.id === 't02-panne',
      details: `premier: ${prioritizedT02[0]?.alert.id} (type: ${prioritizedT02[0]?.alert.type})`,
    });

    // T03 : VEHICULE_IMMOBILISE AT_EVENT vs ACCIDENT AHEAD 5 km -> AT_EVENT premier
    const alertT03_atevent = this.mapDocToAlertItem('t03-atevent', {
      type: 'VEHICULE_IMMOBILISE',
      description: 'Panne au niveau immédiat (Bafia)',
      latitude: 4.7500,
      longitude: 11.2333, // PK 125 -> 0 km (AT_EVENT)
      createdAt: nowMs - 10 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const filterT03 = filterRelevantAlerts([alertT01_5, alertT03_atevent], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    const prioritizedT03 = prioritizeRelevantAlerts(filterT03.relevantAlerts);
    results.push({
      name: 'J-1-3-3-A - T03 : VEHICULE_IMMOBILISE AT_EVENT vs ACCIDENT AHEAD 5 km -> AT_EVENT premier',
      passed: prioritizedT03.length === 2 && prioritizedT03[0].alert.id === 't03-atevent' && prioritizedT03[1].alert.id === 't01-5',
      details: `premier: ${prioritizedT03[0]?.alert.id} (pos: ${prioritizedT03[0]?.relativePosition})`,
    });

    // T04 : Deux alertes : une pertinente (ACCIDENT 5 km), une exclue (trop loin 170 km) -> seule la pertinente apparaît
    const alertT04_far = this.mapDocToAlertItem('t04-far', {
      type: 'ACCIDENT',
      description: 'Accident très loin',
      latitude: 5.4667,
      longitude: 10.4167, // Bafoussam PK 295 -> 170 km > 80 km (TOO_FAR)
      createdAt: nowMs - 10 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const filterT04 = filterRelevantAlerts([alertT01_5, alertT04_far], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    const resultT04 = {
      ...filterT04,
      relevantAlerts: prioritizeRelevantAlerts(filterT04.relevantAlerts),
    };
    results.push({
      name: 'J-1-3-3-A - T04 : Une alerte pertinente + une exclue -> seule la pertinente dans relevantAlerts',
      passed: resultT04.relevantAlerts.length === 1 && resultT04.relevantAlerts[0].alert.id === 't01-5' && resultT04.excludedAlerts.length === 1,
      details: `relevantCount: ${resultT04.relevantAlerts.length}, excludedCount: ${resultT04.excludedAlerts.length}`,
    });

    // T05 : excludedAlerts reste strictement inchangé par la priorisation
    const isExcludedUnchanged = filterT04.excludedAlerts === resultT04.excludedAlerts &&
      resultT04.excludedAlerts[0]?.alert.id === 't04-far' &&
      resultT04.excludedAlerts[0]?.geographicStatus === 'TOO_FAR';
    results.push({
      name: 'J-1-3-3-A - T05 : excludedAlerts reste strictement inchangé par la priorisation',
      passed: isExcludedUnchanged,
      details: `excludedAlerts inchangé: ${isExcludedUnchanged}`,
    });

    // T06 : Métadonnées du résultat préservées (driverPk, isDriverOnCorridor, maxDistanceKm, maxAgeMinutes)
    const areMetadataPreserved =
      resultT04.driverPk === filterT04.driverPk &&
      resultT04.isDriverOnCorridor === filterT04.isDriverOnCorridor &&
      resultT04.maxDistanceKm === filterT04.maxDistanceKm &&
      resultT04.maxAgeMinutes === filterT04.maxAgeMinutes &&
      resultT04.relevantAlerts[0].alertPk !== undefined &&
      resultT04.relevantAlerts[0].driverPk !== undefined &&
      resultT04.relevantAlerts[0].relativePosition !== undefined &&
      resultT04.relevantAlerts[0].estimatedDistanceKm !== undefined;
    results.push({
      name: 'J-1-3-3-A - T06 : driverPk, métadonnées et intégrité des alertes conservés',
      passed: areMetadataPreserved,
      details: `driverPk: ${resultT04.driverPk}, isDriverOnCorridor: ${resultT04.isDriverOnCorridor}`,
    });

    // T07 : Une alerte exclue ne peut pas être promue par confirmationCount ou type
    const alertT07_promoted = this.mapDocToAlertItem('t07-promoted', {
      type: 'ACCIDENT', // type critique
      confirmationCount: 99, // 99 confirmations
      description: 'Accident derrière le chauffeur',
      latitude: 4.1672,
      longitude: 11.5333, // Obala PK 42 -> derrière Bafia PK 125 (BEHIND)
      createdAt: nowMs - 5 * 60 * 1000,
      direction: 'Bafoussam',
    });
    const filterT07 = filterRelevantAlerts([alertT07_promoted], 4.7500, 11.2333, 'YAOUNDE_TO_BAFOUSSAM', NOW_TEST, 80);
    const resultT07 = {
      ...filterT07,
      relevantAlerts: prioritizeRelevantAlerts(filterT07.relevantAlerts),
    };
    const isExclusionSealed = resultT07.relevantAlerts.length === 0 &&
      resultT07.excludedAlerts.length === 1 &&
      resultT07.excludedAlerts[0].alert.id === 't07-promoted';
    results.push({
      name: 'J-1-3-3-A - T07 : Alerte exclue jamais promue malgré 99 confirmations et type ACCIDENT',
      passed: isExclusionSealed,
      details: `relevantCount: ${resultT07.relevantAlerts.length} (attendu 0), excludedReason: ${resultT07.excludedAlerts[0]?.reason}`,
    });

    return results;
  }

  /**
   * ÉTAPE 5A : Calcule localement les données corridor d'une alerte confirmée à partir de ses coordonnées GPS.
   * Fonction pure sans effet de bord :
   * - Si coordonnées valides et sur le corridor -> { estimatedPk: number, roadAxis: 'N4' }
   * - Si hors corridor ou invalides -> {} (aucun estimatedPk inventé)
   */
  public computeAlertCorridorData(
    latitude?: number,
    longitude?: number
  ): { estimatedPk?: number; roadAxis?: string } {
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      isNaN(latitude) ||
      isNaN(longitude)
    ) {
      return {};
    }

    try {
      const corridorPos = corridorService.getAlertCorridorPosition(latitude, longitude);
      if (
        corridorPos &&
        corridorPos.isValid &&
        corridorPos.isOnCorridor &&
        typeof corridorPos.estimatedPk === 'number'
      ) {
        return {
          estimatedPk: corridorPos.estimatedPk,
          roadAxis: 'N4',
        };
      }
    } catch (err) {
      console.warn('[AlertService] Erreur calcul position corridor alerte :', err);
    }

    return {};
  }

  /**
   * RÈGLE ABSOLUE :
   * Une alerte n'est enregistrée comme alerte confirmée QU'APRÈS la confirmation explicite du chauffeur (OUI).
   * Persiste l'alerte dans la collection Firestore 'alerts'.
   */
  public async createAndPublishAlert(record: {
    type: AlertRecord['type'];
    description: string;
    location: string;
    direction: string;
    route?: string;
    audioTranscript?: string;
    audioDuration?: string;
    severity?: AlertItem['severity'];
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  }): Promise<AlertItem> {
    const now = Date.now();
    const id = `alert-${now}-${Math.random().toString(36).substring(2, 6)}`;
    const currentDriver = this.activeDriver;

    // Récupérer l'UID Firebase du chauffeur connecté (attente session si nécessaire)
    let currentUid = authService.getCurrentUserId();
    if (!currentUid) {
      const user = await authService.ensureAnonymousSession();
      currentUid = user?.uid || null;
    }

    const firestorePayload: any = {
      id,
      type: record.type,
      description: record.description.slice(0, 250),
      location: record.location.slice(0, 100),
      direction: record.direction.replace('→', '').trim().slice(0, 100),
      route: (record.route || 'Yaoundé-Bafoussam').slice(0, 100),
      status: 'CONFIRMED' as AlertStatus,
      confirmationCount: 1,
      audioDuration: record.audioDuration || '0:12',
      audioTranscript: (record.audioTranscript || record.description).slice(0, 500),
      createdBy: currentDriver.slice(0, 100),
      createdAt: now,
      confirmedBy: [currentDriver],
    };

    if (
      typeof record.latitude === 'number' &&
      typeof record.longitude === 'number' &&
      !isNaN(record.latitude) &&
      !isNaN(record.longitude)
    ) {
      firestorePayload.latitude = record.latitude;
      firestorePayload.longitude = record.longitude;
      if (typeof record.accuracy === 'number' && !isNaN(record.accuracy)) {
        firestorePayload.accuracy = record.accuracy;
      }

      // ÉTAPE 5A : Calcul local du PK de référence ROUTEGUARD de l'alerte confirmée
      const corridorData = this.computeAlertCorridorData(record.latitude, record.longitude);
      if (typeof corridorData.estimatedPk === 'number') {
        firestorePayload.estimatedPk = corridorData.estimatedPk;
        firestorePayload.roadAxis = corridorData.roadAxis || 'N4';
      }
    }

    if (currentUid) {
      firestorePayload.createdByUid = currentUid;
      firestorePayload.confirmedByUids = [currentUid];
    }

    try {
      const docRef = doc(db, ALERTS_COLLECTION, id);
      await setDoc(docRef, firestorePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${ALERTS_COLLECTION}/${id}`);
    }

    const mapped = this.mapDocToAlertItem(id, firestorePayload);
    this.cachedAlerts = [mapped, ...this.cachedAlerts.filter(a => a.id !== id)];
    return mapped;
  }

  /**
   * Confirmation d'une alerte existante par un autre chauffeur sur Firestore
   */
  public async confirmAlert(alertId: string, driverIdentifier?: string, customUid?: string): Promise<{ success: boolean; newCount: number }> {
    const driver = driverIdentifier || this.activeDriver;

    // Récupérer l'UID Firebase via authService (attendre une session valide si nécessaire)
    let currentUid = customUid || authService.getCurrentUserId();
    if (!currentUid) {
      const user = await authService.ensureAnonymousSession();
      currentUid = user?.uid || null;
    }

    // Récupérer l'alerte depuis le cache ou Firestore
    let existingAlert = this.cachedAlerts.find(a => a.id === alertId);
    if (!existingAlert) {
      try {
        const snap = await getDoc(doc(db, ALERTS_COLLECTION, alertId));
        if (snap.exists()) {
          existingAlert = this.mapDocToAlertItem(snap.id, snap.data());
          this.cachedAlerts = [existingAlert, ...this.cachedAlerts];
        }
      } catch (err) {
        console.warn('Erreur lecture alerte pour confirmation:', err);
      }
    }

    if (existingAlert) {
      // 1. Pour les nouvelles alertes (si confirmedByUids existe)
      if (currentUid && existingAlert.confirmedByUids && existingAlert.confirmedByUids.length > 0) {
        if (existingAlert.confirmedByUids.includes(currentUid) || existingAlert.userConfirmed) {
          return { success: false, newCount: existingAlert.confirmationsCount };
        }
      } else {
        // 2. Pour les anciennes alertes sans confirmedByUids : mécanisme historique
        if (existingAlert.confirmedBy?.includes(driver) || existingAlert.userConfirmed) {
          return { success: false, newCount: existingAlert.confirmationsCount };
        }
      }
    }

    try {
      const docRef = doc(db, ALERTS_COLLECTION, alertId);
      const updateData: any = {
        confirmationCount: increment(1),
        confirmedBy: arrayUnion(driver),
      };

      if (currentUid) {
        updateData.confirmedByUids = arrayUnion(currentUid);
      }

      await updateDoc(docRef, updateData);

      const updatedCount = (existingAlert?.confirmationsCount || existingAlert?.confirmationCount || 1) + 1;
      
      // Mettre à jour le cache local immédiatement
      if (existingAlert) {
        existingAlert.confirmationsCount = updatedCount;
        existingAlert.confirmationCount = updatedCount;
        existingAlert.userConfirmed = true;
        if (driver && !existingAlert.confirmedBy?.includes(driver)) {
          existingAlert.confirmedBy = [...(existingAlert.confirmedBy || []), driver];
        }
        if (currentUid && !existingAlert.confirmedByUids?.includes(currentUid)) {
          existingAlert.confirmedByUids = [...(existingAlert.confirmedByUids || []), currentUid];
        }
      }

      return { success: true, newCount: updatedCount };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${ALERTS_COLLECTION}/${alertId}`);
      return { success: false, newCount: existingAlert?.confirmationsCount || 0 };
    }
  }

  public getActiveDriver(): string {
    return this.activeDriver;
  }

  public setActiveDriver(driverName: string): void {
    this.activeDriver = driverName;
    try {
      localStorage.setItem(CURRENT_DRIVER_KEY, driverName);
    } catch {}

    const currentUid = authService.getCurrentUserId();

    // Mise à jour immédiate du statut de confirmation par rapport au nouveau chauffeur actif
    this.cachedAlerts = this.cachedAlerts.map((alert) => {
      let isConfirmed = false;
      if (alert.confirmedByUids && alert.confirmedByUids.length > 0 && currentUid) {
        isConfirmed = alert.confirmedByUids.includes(currentUid);
      } else {
        isConfirmed = (alert.confirmedBy || []).includes(driverName);
      }
      return {
        ...alert,
        userConfirmed: isConfirmed,
      };
    });
  }

  public getSourceInfo(): AlertDataSourceInfo {
    return {
      isFirebaseConnected: true,
      collectionPath: ALERTS_COLLECTION,
      sourceType: 'FIRESTORE',
      activeDriver: this.activeDriver,
    };
  }

  public async resetToDefault(): Promise<void> {
    try {
      for (const alert of INITIAL_ALERTS) {
        const docRef = doc(db, ALERTS_COLLECTION, alert.id);
        await setDoc(docRef, {
          id: alert.id,
          type: alert.type,
          description: alert.description || alert.title,
          location: alert.location || alert.sector,
          direction: alert.direction.replace('→', '').trim(),
          route: alert.route || 'Yaoundé-Bafoussam',
          status: 'CONFIRMED',
          confirmationCount: alert.confirmationsCount || 1,
          audioDuration: alert.audioDuration || '0:12',
          audioTranscript: alert.audioTranscript || alert.description,
          createdBy: alert.createdBy || 'Chauffeur N4',
          createdAt: alert.createdAt || Date.now(),
          confirmedBy: alert.confirmedBy || [],
        });
      }
    } catch (error) {
      console.error('Reset default error:', error);
    }
  }

  /**
   * Diagnostic method to test Firestore write and read on the 'alerts' collection.
   */
  public async runDiagnostic(): Promise<DiagnosticResult> {
    return runFirestoreDiagnostic();
  }
}

export interface DiagnosticResult {
  writeSuccess: boolean;
  readSuccess: boolean;
  documentId: string;
  writeError?: string;
  readError?: string;
  data?: any;
}

/**
 * Diagnostic utility function that verifies Firestore read and write operations.
 * Attempts to write a test document to the 'alerts' collection using the configured Firestore instance,
 * then immediately attempts to read it back, logging results to console.
 */
export async function runFirestoreDiagnostic(): Promise<DiagnosticResult> {
  const testDocId = `diag-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  console.log(`[Firestore Diagnostic] Starting verification on collection '${ALERTS_COLLECTION}' (id: ${testDocId})...`);

  const testPayload = {
    id: testDocId,
    type: 'OBSTACLE',
    description: 'Test de diagnostic Firestore automatique',
    location: 'Bafia',
    direction: 'Bafoussam',
    route: 'Yaoundé-Bafoussam',
    status: 'CONFIRMED' as AlertStatus,
    confirmationCount: 1,
    audioDuration: '0:05',
    audioTranscript: 'Test de diagnostic de connexion Firestore',
    createdBy: 'Diagnostic RouteGuard',
    createdAt: Date.now(),
    confirmedBy: ['Diagnostic RouteGuard'],
  };

  const result: DiagnosticResult = {
    writeSuccess: false,
    readSuccess: false,
    documentId: testDocId,
  };

  // 1. Attempt Write
  try {
    const docRef = doc(db, ALERTS_COLLECTION, testDocId);
    await setDoc(docRef, testPayload);
    result.writeSuccess = true;
    console.log(`[Firestore Diagnostic] WRITE SUCCESS: Document '${testDocId}' written to '${ALERTS_COLLECTION}'.`);
  } catch (error: any) {
    result.writeSuccess = false;
    result.writeError = error?.message || String(error);
    console.error(`[Firestore Diagnostic] WRITE FAILED:`, result.writeError);
    return result;
  }

  // 2. Attempt Read Back
  try {
    const docRef = doc(db, ALERTS_COLLECTION, testDocId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      result.readSuccess = true;
      result.data = snap.data();
      console.log(`[Firestore Diagnostic] READ SUCCESS: Document '${testDocId}' read back successfully from '${ALERTS_COLLECTION}'.`, result.data);
    } else {
      result.readSuccess = false;
      result.readError = `Document '${testDocId}' does not exist after write.`;
      console.error(`[Firestore Diagnostic] READ FAILED:`, result.readError);
    }
  } catch (error: any) {
    result.readSuccess = false;
    result.readError = error?.message || String(error);
    console.error(`[Firestore Diagnostic] READ FAILED:`, result.readError);
  }

  return result;
}

// Export de l'instance sous les deux noms pour compatibilité complète
export const alertService = FirebaseAlertService.getInstance();
export const AlertService = FirebaseAlertService;

/**
 * Fonction pure exportée pour le calcul direct des métadonnées corridor d'une alerte (Étape 5A)
 */
export const computeAlertCorridorData = (
  latitude?: number,
  longitude?: number
): { estimatedPk?: number; roadAxis?: string } => {
  return alertService.computeAlertCorridorData(latitude, longitude);
};

/**
 * Fonction exportée pour convertir un document Firestore en objet AlertItem (Étape 6A)
 */
export const mapDocToAlertItem = (id: string, data: any): AlertItem => {
  return alertService.mapDocToAlertItem(id, data);
};

/**
 * Fonction exportée pour récupérer et filtrer les alertes pertinentes pour un chauffeur (Étape 6A)
 */
export async function getRelevantAlertsForDriver(
  driverLatitude: number,
  driverLongitude: number,
  direction: CorridorDirection,
  now?: number | string | Date,
  maxDistanceKm: number = DEFAULT_MAX_ALERT_DISTANCE_KM,
  maxAgeMinutes: number = DEFAULT_MAX_ALERT_AGE_MINUTES
): Promise<FilterRelevantAlertsResult<AlertItem>> {
  return alertService.getRelevantAlertsForDriver(
    driverLatitude,
    driverLongitude,
    direction,
    now,
    maxDistanceKm,
    maxAgeMinutes
  );
}

/**
 * Fonction exportée pour l'auto-diagnostic local du branchement alertService -> corridorService (Étape 6A)
 */
export const runAlertServiceSelfCheck = (): { name: string; passed: boolean; details: string }[] => {
  return alertService.runAlertServiceSelfCheck();
};
