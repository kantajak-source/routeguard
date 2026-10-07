/**
 * ROUTEGUARD — OUTBOX SERVICE (J-1-2-1)
 * 
 * Mécanisme local de file d'attente (Outbox) permettant de conserver
 * durablement un signalement CONFIRMÉ lorsque le réseau ou Firestore
 * est indisponible.
 * 
 * RÈGLES STRICTES :
 * - Stockage exclusif dans localStorage sous la clé 'routeguard.outbox.v1'
 * - Aucun appel réseau, Firestore ou externe lors de l'insertion locale (enqueue)
 * - Gestion robuste et résiliente des erreurs (quota, JSON corrompu, SSR)
 * - Déduplication stricte basée sur localId
 */

import { AlertType, AlertSeverity } from '../types/routeguard';

export const OUTBOX_STORAGE_KEY = 'routeguard.outbox.v1';

export const MAX_SYNC_ATTEMPTS = 5;

export type OutboxStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface OutboxAlertPayload {
  type: AlertType;
  description: string;
  location: string;
  direction: string;
  route?: string;
  audioTranscript?: string;
  audioDuration?: string;
  audioUrl?: string;
  severity?: AlertSeverity;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  estimatedPk?: number;
  roadAxis?: string;
  createdBy?: string;
  createdByUid?: string;
  confirmedByUids?: string[];
  timestamp?: number;
  [key: string]: any;
}

export interface OutboxAlert {
  localId: string;
  createdAt: string; // ISO 8601
  status: OutboxStatus;
  syncAttempts: number;
  lastError?: string;
  originalAlertData: OutboxAlertPayload;
  syncedAt?: string;
  updatedAt?: string;
}

export interface OutboxStats {
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
}

class OutboxService {
  private static instance: OutboxService;

  private constructor() {}

  public static getInstance(): OutboxService {
    if (!OutboxService.instance) {
      OutboxService.instance = new OutboxService();
    }
    return OutboxService.instance;
  }

  /**
   * Vérifie la disponibilité de l'API localStorage dans le contexte d'exécution.
   */
  private isStorageAvailable(): boolean {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return false;
    }
    try {
      const testKey = '__routeguard_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Valide si un objet brut extrait du stockage correspond à une structure OutboxAlert saine.
   */
  private isValidOutboxItem(item: any): item is OutboxAlert {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.localId !== 'string' || item.localId.trim() === '') return false;
    if (typeof item.createdAt !== 'string') return false;
    if (!['PENDING', 'SYNCING', 'SYNCED', 'FAILED'].includes(item.status)) return false;
    if (typeof item.syncAttempts !== 'number' || isNaN(item.syncAttempts)) return false;
    if (!item.originalAlertData || typeof item.originalAlertData !== 'object') return false;
    return true;
  }

  /**
   * Lecture sécurisée de l'ensemble des éléments de l'Outbox depuis le localStorage.
   * Isole et filtre les entrées corrompues sans jamais faire crasher l'application.
   */
  public getAllOutboxAlerts(): OutboxAlert[] {
    if (!this.isStorageAvailable()) {
      return [];
    }

    try {
      const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[OutboxService] Contenu non-tableau détecté dans localStorage, réinitialisation sécurisée.');
        this.saveAll([]);
        return [];
      }

      // Filtrer les entrées corrompues pour garantir l'intégrité de l'état
      const validItems = parsed.filter((item) => this.isValidOutboxItem(item));
      if (validItems.length !== parsed.length) {
        console.warn(`[OutboxService] ${parsed.length - validItems.length} entrée(s) corrompue(s) filtrée(s).`);
        // On réécrit le store avec uniquement les entrées valides pour nettoyer le stockage
        this.saveAll(validItems);
      }

      return validItems;
    } catch (error) {
      console.error('[OutboxService] Échec de lecture/décodage de l\'Outbox:', error);
      return [];
    }
  }

  /**
   * Écriture sécurisée de la liste d'alertes dans le localStorage.
   */
  private saveAll(items: OutboxAlert[]): boolean {
    if (!this.isStorageAvailable()) {
      return false;
    }

    try {
      const serialized = JSON.stringify(items);
      localStorage.setItem(OUTBOX_STORAGE_KEY, serialized);
      return true;
    } catch (error) {
      console.error('[OutboxService] Échec d\'écriture dans localStorage (QuotaExceededError ?):', error);
      return false;
    }
  }

  /**
   * Génère un identifiant local unique et déterministe pour l'alerte en file d'attente.
   */
  public generateLocalId(): string {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    return `outbox_${timestamp}_${randomSuffix}`;
  }

  /**
   * Ajoute une alerte confirmée dans l'Outbox au statut 'PENDING'.
   * Opération 100% locale, sans réseau ni Firestore.
   * Déduplique strictement sur localId si réémis.
   */
  public enqueueAlert(originalAlertData: OutboxAlertPayload, customLocalId?: string): OutboxAlert {
    const items = this.getAllOutboxAlerts();
    const localId = customLocalId && customLocalId.trim() ? customLocalId.trim() : this.generateLocalId();

    // Vérification de déduplication stricte
    const existingIndex = items.findIndex((i) => i.localId === localId);
    if (existingIndex >= 0) {
      // Déjà existant : met à jour le statut en PENDING si ce n'était pas déjà le cas
      const existing = items[existingIndex];
      const updated: OutboxAlert = {
        ...existing,
        originalAlertData: { ...existing.originalAlertData, ...originalAlertData },
        status: 'PENDING',
        updatedAt: new Date().toISOString(),
      };
      items[existingIndex] = updated;
      this.saveAll(items);
      return updated;
    }

    const newAlert: OutboxAlert = {
      localId,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      syncAttempts: 0,
      originalAlertData: { ...originalAlertData },
    };

    items.push(newAlert);
    this.saveAll(items);
    return newAlert;
  }

  /**
   * Vérifie si un message d'erreur indique une erreur non-réessayable (fatale).
   * Les erreurs irrécupérables (payload invalide, session absente, conflit d'intégrité, quota dépassé)
   * ne doivent pas être automatiquement réessayées.
   */
  public static isFatalError(error?: string): boolean {
    if (!error) return false;
    const msg = error.toLowerCase();
    return (
      msg.includes('incomplètes ou invalides') ||
      msg.includes('données requises absentes') ||
      msg.includes('invalid_payload') ||
      msg.includes('conflit d\'intégrité') ||
      msg.includes('uid incompatible') ||
      msg.includes('auth_mismatch') ||
      msg.includes('aucun utilisateur') ||
      msg.includes('no_session') ||
      msg.includes('permission-denied') ||
      msg.includes('unauthenticated')
    );
  }

  /**
   * Vérifie si une alerte FAILED est éligible à une nouvelle tentative.
   */
  public isRetryableFailedAlert(alert: OutboxAlert): boolean {
    if (alert.status !== 'FAILED') return false;
    if ((alert.syncAttempts || 0) >= MAX_SYNC_ATTEMPTS) return false;
    if (OutboxService.isFatalError(alert.lastError)) return false;
    return true;
  }

  /**
   * Récupère toutes les alertes éligibles à la synchronisation :
   * 1. Alertes en attente ('PENDING')
   * 2. Alertes en échec réessayable ('FAILED' avec erreur réseau/transitoire et syncAttempts < MAX_SYNC_ATTEMPTS)
   */
  public getPendingAlerts(): OutboxAlert[] {
    return this.getAllOutboxAlerts().filter(
      (item) => item.status === 'PENDING' || this.isRetryableFailedAlert(item)
    );
  }

  /**
   * Passe le statut d'une alerte à 'SYNCING' et incrémente son compteur d'essais.
   */
  public markAlertSyncing(localId: string): OutboxAlert | null {
    const items = this.getAllOutboxAlerts();
    const index = items.findIndex((i) => i.localId === localId);
    if (index === -1) return null;

    const updated: OutboxAlert = {
      ...items[index],
      status: 'SYNCING',
      syncAttempts: (items[index].syncAttempts || 0) + 1,
      updatedAt: new Date().toISOString(),
    };

    items[index] = updated;
    this.saveAll(items);
    return updated;
  }

  /**
   * Marque une alerte comme synchronisée avec succès ('SYNCED').
   */
  public markAlertSynced(localId: string): OutboxAlert | null {
    const items = this.getAllOutboxAlerts();
    const index = items.findIndex((i) => i.localId === localId);
    if (index === -1) return null;

    const updated: OutboxAlert = {
      ...items[index],
      status: 'SYNCED',
      syncedAt: new Date().toISOString(),
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    };

    items[index] = updated;
    this.saveAll(items);
    return updated;
  }

  /**
   * Marque une alerte en échec de synchronisation ('FAILED') avec le motif de l'erreur.
   */
  public markAlertFailed(localId: string, error?: string): OutboxAlert | null {
    const items = this.getAllOutboxAlerts();
    const index = items.findIndex((i) => i.localId === localId);
    if (index === -1) return null;

    const updated: OutboxAlert = {
      ...items[index],
      status: 'FAILED',
      lastError: error || 'Erreur de synchronisation inconnue',
      updatedAt: new Date().toISOString(),
    };

    items[index] = updated;
    this.saveAll(items);
    return updated;
  }

  /**
   * Supprime définitivement une alerte de l'Outbox par son localId.
   */
  public removeAlert(localId: string): boolean {
    const items = this.getAllOutboxAlerts();
    const initialLength = items.length;
    const filtered = items.filter((i) => i.localId !== localId);
    if (filtered.length !== initialLength) {
      this.saveAll(filtered);
      return true;
    }
    return false;
  }

  /**
   * Vide complètement l'Outbox locale.
   */
  public clearOutbox(): void {
    if (!this.isStorageAvailable()) return;
    try {
      localStorage.removeItem(OUTBOX_STORAGE_KEY);
    } catch (error) {
      console.error('[OutboxService] Erreur lors du nettoyage de l\'Outbox:', error);
    }
  }

  /**
   * Retourne le nombre d'alertes dans l'Outbox (total ou filtré par statut).
   */
  public getOutboxCount(status?: OutboxStatus): number {
    const items = this.getAllOutboxAlerts();
    if (status) {
      return items.filter((i) => i.status === status).length;
    }
    return items.length;
  }

  /**
   * Statistiques complètes de l'état de l'Outbox.
   */
  public getOutboxStats(): OutboxStats {
    const items = this.getAllOutboxAlerts();
    return {
      total: items.length,
      pending: items.filter((i) => i.status === 'PENDING').length,
      syncing: items.filter((i) => i.status === 'SYNCING').length,
      synced: items.filter((i) => i.status === 'SYNCED').length,
      failed: items.filter((i) => i.status === 'FAILED').length,
    };
  }
}

// Instance singleton
export const outboxService = OutboxService.getInstance();

// Fonctions exportées directement pour commodité
export const enqueueAlert = (originalAlertData: OutboxAlertPayload, customLocalId?: string) =>
  outboxService.enqueueAlert(originalAlertData, customLocalId);

export const getPendingAlerts = () =>
  outboxService.getPendingAlerts();

export const getAllOutboxAlerts = () =>
  outboxService.getAllOutboxAlerts();

export const markAlertSyncing = (localId: string) =>
  outboxService.markAlertSyncing(localId);

export const markAlertSynced = (localId: string) =>
  outboxService.markAlertSynced(localId);

export const markAlertFailed = (localId: string, error?: string) =>
  outboxService.markAlertFailed(localId, error);

export const removeAlert = (localId: string) =>
  outboxService.removeAlert(localId);

export const clearOutbox = () =>
  outboxService.clearOutbox();

export const getOutboxCount = (status?: OutboxStatus) =>
  outboxService.getOutboxCount(status);

export const getOutboxStats = () =>
  outboxService.getOutboxStats();

export default outboxService;
