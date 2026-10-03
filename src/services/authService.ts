import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';
import { app } from './firebase';

/**
 * Service d'authentification pour ROUTEGUARD.
 * Prépare l'authentification Firebase (mode Anonyme pour prototypage).
 */
export class AuthService {
  private static instance: AuthService;
  private auth: Auth;
  private currentUser: User | null = null;
  private initPromise: Promise<User | null> | null = null;

  private constructor() {
    this.auth = getAuth(app);
    console.log('[Auth] Firebase Authentication initialisée');

    // Écoute de l'état de la session
    onAuthStateChanged(this.auth, (user) => {
      this.currentUser = user;
      if (user) {
        console.log('[Auth] Utilisateur authentifié');
        console.log('[Auth] UID:', user.uid);
      } else {
        console.log('[Auth] Aucun utilisateur actif.');
      }
    });

    // Initialiser automatiquement la session anonyme si aucun utilisateur n'est connecté
    this.initPromise = this.ensureAnonymousSession();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Assure qu'une session anonyme active existe.
   * Si une session existe déjà, elle est conservée.
   */
  public async ensureAnonymousSession(): Promise<User | null> {
    if (this.auth.currentUser) {
      this.currentUser = this.auth.currentUser;
      return this.currentUser;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const userCredential = await signInAnonymously(this.auth);
        this.currentUser = userCredential.user;
        return this.currentUser;
      } catch (error: any) {
        console.warn('[Auth] Impossible de démarrer une session anonyme :', error?.code || error?.message || error);
        return null;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Retourne l'utilisateur Firebase actuellement authentifié.
   */
  public getCurrentUser(): User | null {
    return this.auth.currentUser || this.currentUser;
  }

  /**
   * Retourne l'UID Firebase de l'utilisateur actuel, ou null.
   */
  public getCurrentUserId(): string | null {
    return this.auth.currentUser?.uid || this.currentUser?.uid || null;
  }

  /**
   * Écouteur de changement d'état d'authentification.
   */
  public onAuthChange(callback: (user: User | null) => void): () => void {
    return onAuthStateChanged(this.auth, (user) => {
      this.currentUser = user;
      callback(user);
    });
  }

  /**
   * Retourne l'instance brute de Firebase Auth
   */
  public getAuthInstance(): Auth {
    return this.auth;
  }
}

export const authService = AuthService.getInstance();
