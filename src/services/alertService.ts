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
  private mapDocToAlertItem(id: string, data: any): AlertItem {
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

    return {
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

    if (typeof record.latitude === 'number' && typeof record.longitude === 'number') {
      firestorePayload.latitude = record.latitude;
      firestorePayload.longitude = record.longitude;
      if (typeof record.accuracy === 'number') {
        firestorePayload.accuracy = record.accuracy;
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
