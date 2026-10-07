/**
 * ROUTEGUARD — OUTBOX SYNC SERVICE (J-1-2-3-C)
 * 
 * Synchroniseur d'alertes idempotent depuis l'Outbox locale vers Firestore.
 * 
 * RÈGLES STRICTES & ARCHITECTURE :
 * - Lecture sélective des alertes PENDING (et récupération sécurisée des entrées SYNCING expirées)
 * - Vérification stricte de l'identité Firebase : createdByUid === currentUser.uid
 * - Idempotence absolue : vérification de l'existence de alerts/{localId} avant création
 * - Aucun addDoc(), documentId déterministe = outbox.localId via setDoc(doc(db, 'alerts', localId))
 * - Verrouillage mémoire strict contre les exécutions concurrentes
 * - Aucun listener permanent, polling ou déclencheur global (online, setInterval)
 * - Aucune perte de données en cas d'erreur réseau ou Firestore
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { outboxService, OutboxAlert, MAX_SYNC_ATTEMPTS } from './outboxService';
import { authService } from './authService';

export const ALERTS_COLLECTION = 'alerts';

/**
 * Durée maximale (en ms) pendant laquelle une entrée peut rester à l'état SYNCING
 * avant d'être considérée comme bloquée suite à un crash/fermeture et remise à PENDING.
 * 60 secondes garantit une marge suffisante même en réseau 2G/3G instable.
 */
export const STALE_SYNCING_THRESHOLD_MS = 60 * 1000;

export type SyncItemResultCode =
  | 'SUCCESS'
  | 'ALREADY_SYNCED'
  | 'AUTH_MISMATCH'
  | 'NO_SESSION'
  | 'NETWORK_ERROR'
  | 'FIRESTORE_ERROR'
  | 'INVALID_PAYLOAD';

export interface SyncItemResult {
  localId: string;
  code: SyncItemResultCode;
  message: string;
  error?: any;
}

export interface OutboxSyncReport {
  timestamp: string;
  totalPendingExamined: number;
  syncedCount: number;
  alreadySyncedCount: number;
  skippedAuthMismatchCount: number;
  failedCount: number;
  results: SyncItemResult[];
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastReport: OutboxSyncReport | null;
}

class OutboxSyncService {
  private static instance: OutboxSyncService;

  // Verrou en mémoire empêchant les synchronisations concurrentes
  private isRunning: boolean = false;
  private lastSyncAt: string | null = null;
  private lastReport: OutboxSyncReport | null = null;

  private constructor() {}

  public static getInstance(): OutboxSyncService {
    if (!OutboxSyncService.instance) {
      OutboxSyncService.instance = new OutboxSyncService();
    }
    return OutboxSyncService.instance;
  }

  /**
   * Retourne l'état actuel du synchroniseur.
   */
  public getSyncStatus(): SyncStatus {
    return {
      isSyncing: this.isRunning,
      lastSyncAt: this.lastSyncAt,
      lastReport: this.lastReport,
    };
  }

  /**
   * Analyse et remet en 'PENDING' les entrées bloquées en 'SYNCING'
   * depuis plus de STALE_SYNCING_THRESHOLD_MS (crash, coupure ou fermeture d'onglet).
   */
  public recoverStaleSyncingAlerts(): number {
    const allAlerts = outboxService.getAllOutboxAlerts();
    const now = Date.now();
    let recoveredCount = 0;

    for (const alert of allAlerts) {
      if (alert.status === 'SYNCING') {
        const referenceTimeStr = alert.updatedAt || alert.createdAt;
        const referenceTime = new Date(referenceTimeStr).getTime();
        const elapsed = now - referenceTime;

        if (isNaN(referenceTime) || elapsed >= STALE_SYNCING_THRESHOLD_MS) {
          // Remettre l'alerte à disposition pour le prochain cycle
          outboxService.enqueueAlert(alert.originalAlertData, alert.localId);
          recoveredCount++;
        }
      }
    }

    return recoveredCount;
  }

  /**
   * Point d'entrée principal pour synchroniser les alertes en attente vers Firestore.
   * Gère le verrou mémoire, l'identité Firebase, l'idempotence et les états d'erreurs.
   */
  public async syncPendingAlerts(): Promise<OutboxSyncReport> {
    // 1. Protection contre les appels concurrents (Verrou en mémoire)
    if (this.isRunning) {
      console.warn('[OutboxSyncService] Synchronisation déjà en cours. Appel ignoré.');
      return {
        timestamp: new Date().toISOString(),
        totalPendingExamined: 0,
        syncedCount: 0,
        alreadySyncedCount: 0,
        skippedAuthMismatchCount: 0,
        failedCount: 0,
        results: [
          {
            localId: '',
            code: 'FIRESTORE_ERROR',
            message: 'Synchronisation concurrente déjà active',
          },
        ],
      };
    }

    this.isRunning = true;

    const report: OutboxSyncReport = {
      timestamp: new Date().toISOString(),
      totalPendingExamined: 0,
      syncedCount: 0,
      alreadySyncedCount: 0,
      skippedAuthMismatchCount: 0,
      failedCount: 0,
      results: [],
    };

    try {
      // 2. Récupération des entrées bloquées en SYNCING (post-crash)
      this.recoverStaleSyncingAlerts();

      // 3. Récupération des alertes PENDING
      const pendingAlerts = outboxService.getPendingAlerts();
      report.totalPendingExamined = pendingAlerts.length;

      if (pendingAlerts.length === 0) {
        return report;
      }

      // 4. Traitement séquentiel de chaque alerte PENDING
      for (const alert of pendingAlerts) {
        const itemResult = await this.syncSingleAlert(alert);
        report.results.push(itemResult);

        switch (itemResult.code) {
          case 'SUCCESS':
            report.syncedCount++;
            break;
          case 'ALREADY_SYNCED':
            report.alreadySyncedCount++;
            break;
          case 'AUTH_MISMATCH':
          case 'NO_SESSION':
            report.skippedAuthMismatchCount++;
            break;
          default:
            report.failedCount++;
            break;
        }
      }

      return report;
    } finally {
      this.isRunning = false;
      this.lastSyncAt = new Date().toISOString();
      this.lastReport = report;
    }
  }

  /**
   * Alias de commodité pour syncPendingAlerts().
   */
  public async syncOutbox(): Promise<OutboxSyncReport> {
    return this.syncPendingAlerts();
  }

  /**
   * Synchronise une alerte unitaire avec vérifications d'identité et d'idempotence.
   */
  private async syncSingleAlert(alert: OutboxAlert): Promise<SyncItemResult> {
    const localId = alert.localId;
    const payload = alert.originalAlertData;

    // A. Validation minimale des données requises
    if (!payload || !payload.type || !payload.description || !payload.location || !payload.direction) {
      outboxService.markAlertFailed(localId, 'Données Outbox incomplètes ou invalides');
      return {
        localId,
        code: 'INVALID_PAYLOAD',
        message: 'Alerte invalide : données requises absentes',
      };
    }

    // B. Vérification de la session Firebase active
    const currentUid = authService.getCurrentUserId();
    if (!currentUid) {
      // RÈGLE : Si aucun utilisateur n'est connecté, NE PAS créer de session anonyme d'office.
      // Conserver l'alerte localement pour quand la session sera rétablie.
      return {
        localId,
        code: 'NO_SESSION',
        message: 'Aucun utilisateur Firebase actuellement connecté. En attente de session.',
      };
    }

    // C. Vérification stricte d'identité : createdByUid === currentUser.uid
    const itemUid = payload.createdByUid;
    if (!itemUid || itemUid !== currentUid) {
      // RÈGLE : Incompatibilité d'identité. NE PAS publier. NE PAS supprimer. Conserver dans l'Outbox.
      return {
        localId,
        code: 'AUTH_MISMATCH',
        message: `Incompatibilité d'identité (UID alerte: ${itemUid || 'non défini'}, UID session: ${currentUid}). Conservation locale.`,
      };
    }

    // D. Passage à l'état SYNCING
    outboxService.markAlertSyncing(localId);

    try {
      const alertDocRef = doc(db, ALERTS_COLLECTION, localId);

      // E. IDEMPOTENCE : Vérification préalable si alerts/{localId} existe déjà
      let existingSnap;
      try {
        existingSnap = await getDoc(alertDocRef);
      } catch (readError: any) {
        // En cas d'erreur de lecture réseau, marquer l'échec et conserver pour réessai
        const isOffline = this.isNetworkError(readError);
        outboxService.markAlertFailed(
          localId,
          isOffline ? 'Réseau indisponible lors de la vérification Firestore' : readError.message
        );
        return {
          localId,
          code: isOffline ? 'NETWORK_ERROR' : 'FIRESTORE_ERROR',
          message: `Erreur lors de la lecture Firestore : ${readError.message || readError}`,
          error: readError,
        };
      }

      if (existingSnap && existingSnap.exists()) {
        const existingData = existingSnap.data();

        // Vérification de sécurité d'intégrité
        if (existingData.createdByUid && existingData.createdByUid !== itemUid) {
          outboxService.markAlertFailed(
            localId,
            `Conflit d'intégrité : un document ${localId} existe avec un UID différent (${existingData.createdByUid})`
          );
          return {
            localId,
            code: 'AUTH_MISMATCH',
            message: `Document distant existant avec UID incompatible. Conservation locale de l'Outbox.`,
          };
        }

        // Le document distant existe déjà et correspond à la même alerte :
        // Idempotence : Marquer comme SYNCED puis retirer de l'Outbox locale.
        outboxService.markAlertSynced(localId);
        outboxService.removeAlert(localId);

        return {
          localId,
          code: 'ALREADY_SYNCED',
          message: `Document alerts/${localId} déjà présent sur Firestore. Alerte marquée synchronisée et purgée de l'Outbox.`,
        };
      }

      // F. Construction du payload distant strictement conforme aux règles Firestore
      // (request.resource.data.status == 'CONFIRMED', confirmationCount == 1, createdByUid == auth.uid, etc.)
      const rawCreatedAt = payload.timestamp || new Date(alert.createdAt).getTime();
      const safeCreatedAt = (typeof rawCreatedAt === 'number' && !isNaN(rawCreatedAt) && rawCreatedAt > 0)
        ? rawCreatedAt
        : Date.now();

      const firestoreRecord: Record<string, any> = {
        id: localId,
        type: payload.type,
        description: payload.description,
        location: payload.location,
        direction: payload.direction,
        route: payload.route || 'Yaoundé-Bafoussam',
        status: 'CONFIRMED',
        confirmationCount: 1,
        audioDuration: payload.audioDuration || '0:12',
        audioTranscript: payload.audioTranscript || `Alerte confirmée par ${payload.createdBy || 'Chauffeur'}`,
        createdBy: payload.createdBy || 'Chauffeur',
        createdAt: safeCreatedAt,
        confirmedBy: [payload.createdBy || 'Chauffeur'],
        createdByUid: itemUid,
        confirmedByUids: [itemUid],
      };

      // Attacher les métadonnées GPS et corridor si disponibles
      if (typeof payload.latitude === 'number' && !isNaN(payload.latitude)) {
        firestoreRecord.latitude = payload.latitude;
      }
      if (typeof payload.longitude === 'number' && !isNaN(payload.longitude)) {
        firestoreRecord.longitude = payload.longitude;
      }
      if (typeof payload.accuracy === 'number' && !isNaN(payload.accuracy)) {
        firestoreRecord.accuracy = payload.accuracy;
      }
      if (typeof payload.estimatedPk === 'number' && !isNaN(payload.estimatedPk)) {
        firestoreRecord.estimatedPk = payload.estimatedPk;
      }
      if (typeof payload.roadAxis === 'string' && payload.roadAxis.trim() !== '') {
        firestoreRecord.roadAxis = payload.roadAxis;
      }

      // G. Écriture idempotente avec setDoc (JAMAIS d'addDoc)
      await setDoc(alertDocRef, firestoreRecord);

      // H. Succès : marquer SYNCED puis supprimer localement
      outboxService.markAlertSynced(localId);
      outboxService.removeAlert(localId);

      return {
        localId,
        code: 'SUCCESS',
        message: `Alerte ${localId} synchronisée avec succès dans Firestore.`,
      };
    } catch (writeError: any) {
      console.warn(`[OutboxSyncService] Échec synchronisation ${localId}:`, writeError);

      const isOffline = this.isNetworkError(writeError);
      const errorMessage = writeError.message || String(writeError);

      outboxService.markAlertFailed(localId, errorMessage);

      return {
        localId,
        code: isOffline ? 'NETWORK_ERROR' : 'FIRESTORE_ERROR',
        message: isOffline
          ? 'Réseau indisponible pendant l\'écriture Firestore. Données conservées.'
          : `Erreur Firestore : ${errorMessage}`,
        error: writeError,
      };
    }
  }

  /**
   * Détecte si une erreur est due à une absence de connectivité réseau.
   */
  private isNetworkError(error: any): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return true;
    }
    if (!error) return false;
    const msg = (error.message || error.code || '').toLowerCase();
    return (
      msg.includes('unavailable') ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('offline') ||
      msg.includes('timeout')
    );
  }
}

// Export singleton et fonctions pratiques
export const outboxSyncService = OutboxSyncService.getInstance();

export const syncPendingAlerts = () => outboxSyncService.syncPendingAlerts();
export const syncOutbox = () => outboxSyncService.syncOutbox();
export const getSyncStatus = () => outboxSyncService.getSyncStatus();
export const recoverStaleSyncingAlerts = () => outboxSyncService.recoverStaleSyncingAlerts();

export default outboxSyncService;
