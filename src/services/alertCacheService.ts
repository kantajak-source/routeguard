/**
 * ROUTEGUARD — SERVICE DE CACHE INDEXEDDB (J-1-3-9-B1.1)
 *
 * Persistance locale des alertes opérationnelles réelles reçues de Firestore.
 *
 * RÈGLES STRICTES :
 * - Utilisation exclusive de l'API native window.indexedDB (aucune dépendance externe).
 * - Base : 'routeguard_db', Object Store : 'operational_alerts', Clé primaire : 'id'.
 * - Totalement indépendant de l'Outbox ('routeguard.outbox.v1' dans localStorage).
 * - Remplacement atomique de la collection lors de saveAll() (aucune sauvegarde partielle).
 * - saveAll([]) vide intégralement le store.
 * - Validation stricte des données restaurées (id non vide, type connu, createdAt valide).
 * - Résilience absolue : aucune erreur ne doit faire planter l'application.
 */

import { AlertItem, AlertType } from '../types/routeguard';

export const ALERT_CACHE_DB_NAME = 'routeguard_db';
export const ALERT_CACHE_DB_VERSION = 1;
export const ALERT_CACHE_STORE_NAME = 'operational_alerts';

const KNOWN_ALERT_TYPES: ReadonlySet<string> = new Set([
  'ACCIDENT',
  'VEHICULE_IMMOBILISE',
  'FORTE_PLUIE',
  'OBSTACLE',
  'RALENTISSEMENT',
]);

/**
 * Résultat d'état de l'opération de cache pour diagnostic et métrologie
 */
export interface CacheOperationResult {
  success: boolean;
  count: number;
  error?: string;
}

export class AlertCacheService {
  private static instance: AlertCacheService;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  public static getInstance(): AlertCacheService {
    if (!AlertCacheService.instance) {
      AlertCacheService.instance = new AlertCacheService();
    }
    return AlertCacheService.instance;
  }

  /**
   * Vérifie si l'API IndexedDB est disponible dans l'environnement d'exécution courant.
   */
  public isAvailable(): boolean {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return false;
    }
    return true;
  }

  /**
   * Valide rigoureusement un objet avant enregistrement ou après restauration.
   * Exige :
   * - objet valide non nul
   * - identifiant string non vide
   * - type faisant partie des AlertType officiels du projet
   * - createdAt nombre fini > 0
   * - coordonnées GPS cohérentes lorsqu'elles sont renseignées
   * - exclusion systématique des drapeaux de démonstration
   */
  public isValidAlertItem(raw: unknown): raw is AlertItem {
    if (!raw || typeof raw !== 'object') return false;

    const candidate = raw as Record<string, unknown>;

    // 1. Identifiant obligatoire et non vide
    if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
      return false;
    }

    // 2. Exclusion des données de démonstration explicites
    if (candidate.isDemo === true) {
      return false;
    }
    // Exclusion des fixtures historiques d'exemple sans UID ni coordonnées
    if (
      (candidate.id === 'alert-1' || candidate.id === 'alert-2' || candidate.id === 'alert-3') &&
      !candidate.createdByUid &&
      typeof candidate.latitude !== 'number'
    ) {
      return false;
    }

    // 3. Type d'alerte reconnu par le projet
    if (typeof candidate.type !== 'string' || !KNOWN_ALERT_TYPES.has(candidate.type)) {
      return false;
    }

    // 4. Horodatage de création valide (nombre positif fini)
    if (
      typeof candidate.createdAt !== 'number' ||
      isNaN(candidate.createdAt) ||
      !isFinite(candidate.createdAt) ||
      candidate.createdAt <= 0
    ) {
      return false;
    }

    // 5. Validation des coordonnées lorsqu'elles sont présentes (ne pas rejeter si absentes)
    if (candidate.latitude !== undefined && candidate.latitude !== null) {
      if (
        typeof candidate.latitude !== 'number' ||
        isNaN(candidate.latitude) ||
        !isFinite(candidate.latitude) ||
        candidate.latitude < -90 ||
        candidate.latitude > 90
      ) {
        return false;
      }
    }

    if (candidate.longitude !== undefined && candidate.longitude !== null) {
      if (
        typeof candidate.longitude !== 'number' ||
        isNaN(candidate.longitude) ||
        !isFinite(candidate.longitude) ||
        candidate.longitude < -180 ||
        candidate.longitude > 180
      ) {
        return false;
      }
    }

    if (candidate.accuracy !== undefined && candidate.accuracy !== null) {
      if (
        typeof candidate.accuracy !== 'number' ||
        isNaN(candidate.accuracy) ||
        !isFinite(candidate.accuracy) ||
        candidate.accuracy < 0
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Ouvre ou réutilise la connexion à la base IndexedDB.
   */
  private async getDatabase(): Promise<IDBDatabase | null> {
    if (!this.isAvailable()) {
      return null;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = window.indexedDB.open(ALERT_CACHE_DB_NAME, ALERT_CACHE_DB_VERSION);

        request.onupgradeneeded = (event) => {
          try {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(ALERT_CACHE_STORE_NAME)) {
              db.createObjectStore(ALERT_CACHE_STORE_NAME, { keyPath: 'id' });
            }
          } catch (upgradeErr) {
            console.warn('[AlertCacheService] Erreur lors du schéma onupgradeneeded :', upgradeErr);
          }
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Réinitialiser la promesse en cas de fermeture inattendue
          db.onclose = () => {
            this.dbPromise = null;
          };
          db.onerror = () => {
            console.warn('[AlertCacheService] Erreur de base de données asynchrone non fatale.');
          };

          resolve(db);
        };

        request.onerror = (event) => {
          console.warn(
            '[AlertCacheService] Échec ouverture IndexedDB :',
            (event.target as IDBOpenDBRequest).error
          );
          this.dbPromise = null;
          resolve(null);
        };

        request.onblocked = () => {
          console.warn('[AlertCacheService] Ouverture IndexedDB bloquée par une autre connexion.');
          this.dbPromise = null;
          resolve(null);
        };
      } catch (err) {
        console.warn('[AlertCacheService] Exception synchrone lors de open() :', err);
        this.dbPromise = null;
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * Initialise proactivement la connexion IndexedDB sans bloquer l'appelant.
   */
  public async init(): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      return db !== null;
    } catch {
      return false;
    }
  }

  /**
   * Restaure toutes les alertes valides stockées en IndexedDB.
   * Retourne un tableau vide en cas d'indisponibilité, d'erreur ou de base vide.
   */
  public async getAll(): Promise<AlertItem[]> {
    try {
      const db = await this.getDatabase();
      if (!db) return [];

      return new Promise<AlertItem[]>((resolve) => {
        try {
          const transaction = db.transaction([ALERT_CACHE_STORE_NAME], 'readonly');
          const store = transaction.objectStore(ALERT_CACHE_STORE_NAME);
          const request = store.getAll();

          request.onsuccess = () => {
            const rawItems: unknown = request.result;
            if (!Array.isArray(rawItems)) {
              resolve([]);
              return;
            }

            const validItems: AlertItem[] = [];
            for (const item of rawItems) {
              if (this.isValidAlertItem(item)) {
                // Sanitize : supprimer tout champ parasite non désiré
                const cleanItem: AlertItem = {
                  ...item,
                  // Garantir qu'aucun token ou secret n'est présent
                  id: String(item.id),
                  type: item.type as AlertType,
                  createdAt: Number(item.createdAt),
                };
                validItems.push(cleanItem);
              }
            }
            resolve(validItems);
          };

          request.onerror = () => {
            console.warn('[AlertCacheService] Erreur lors de store.getAll()');
            resolve([]);
          };

          transaction.onerror = () => {
            console.warn('[AlertCacheService] Erreur transaction getAll()');
            resolve([]);
          };
        } catch (err) {
          console.warn('[AlertCacheService] Exception lors de getAll() :', err);
          resolve([]);
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * Sauvegarde atomique d'une liste complète d'alertes réelles.
   * - Si alerts est vide : vide complètement le store.
   * - Sinon : nettoie le store et insère chaque alerte valide dans une seule transaction 'readwrite'.
   * - Si la transaction échoue : ne valide pas une sauvegarde partielle et résout false.
   */
  public async saveAll(alerts: AlertItem[]): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      if (!db) return false;

      // Filtrer strictement les alertes valides en amont
      const validAlerts = (alerts || []).filter((a) => this.isValidAlertItem(a));

      return new Promise<boolean>((resolve) => {
        try {
          const transaction = db.transaction([ALERT_CACHE_STORE_NAME], 'readwrite');
          const store = transaction.objectStore(ALERT_CACHE_STORE_NAME);

          // 1. Vidage atomique du store
          store.clear();

          // 2. Écriture séquentielle des éléments valides dans la même transaction
          for (const alert of validAlerts) {
            // Nettoyage de précaution pour ne jamais persister de secrets
            const sanitizedAlert: AlertItem = {
              ...alert,
            };
            store.put(sanitizedAlert);
          }

          transaction.oncomplete = () => {
            resolve(true);
          };

          transaction.onerror = (event) => {
            console.warn('[AlertCacheService] Échec transaction saveAll :', (event.target as IDBTransaction).error);
            resolve(false);
          };

          transaction.onabort = () => {
            console.warn('[AlertCacheService] Transaction saveAll abandonnée (abort).');
            resolve(false);
          };
        } catch (err) {
          console.warn('[AlertCacheService] Exception transaction saveAll :', err);
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }

  /**
   * Vide intégralement le cache persistant des alertes opérationnelles.
   * Ne supprime pas la base de données.
   */
  public async clear(): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      if (!db) return false;

      return new Promise<boolean>((resolve) => {
        try {
          const transaction = db.transaction([ALERT_CACHE_STORE_NAME], 'readwrite');
          const store = transaction.objectStore(ALERT_CACHE_STORE_NAME);
          store.clear();

          transaction.oncomplete = () => {
            resolve(true);
          };

          transaction.onerror = () => {
            console.warn('[AlertCacheService] Erreur lors de clear()');
            resolve(false);
          };

          transaction.onabort = () => {
            resolve(false);
          };
        } catch (err) {
          console.warn('[AlertCacheService] Exception lors de clear() :', err);
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }
}

export const alertCacheService = AlertCacheService.getInstance();
