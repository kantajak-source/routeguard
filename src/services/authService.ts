import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  User,
  Auth
} from 'firebase/auth';
import { app } from './firebase';

/**
 * Erreur d'authentification enrichie pour l'interface chauffeur ROUTEGUARD
 */
export class RouteGuardAuthError extends Error {
  public code: string;
  public userFriendlyMessage: string;

  constructor(code: string, message: string, userFriendlyMessage: string) {
    super(message);
    this.name = 'RouteGuardAuthError';
    this.code = code;
    this.userFriendlyMessage = userFriendlyMessage;
  }
}

/**
 * Traduction des codes d'erreurs Firebase Authentication en messages compréhensibles
 */
export function mapFirebaseErrorToUserMessage(error: any): RouteGuardAuthError {
  const code = error?.code || 'auth/unknown';
  const originalMessage = error?.message || 'Erreur d\'authentification inconnue';
  let friendlyMessage = 'Une erreur d\'authentification est survenue. Veuillez réessayer.';

  switch (code) {
    case 'auth/email-already-in-use':
      friendlyMessage = 'Cette adresse e-mail est déjà associée à un compte chauffeur.';
      break;
    case 'auth/credential-already-in-use':
      friendlyMessage = 'Ces identifiants sont déjà liés à un autre compte chauffeur.';
      break;
    case 'auth/invalid-email':
      friendlyMessage = 'Format d\'adresse e-mail invalide.';
      break;
    case 'auth/weak-password':
      friendlyMessage = 'Le mot de passe est trop court ou trop faible (minimum 6 caractères).';
      break;
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      friendlyMessage = 'Adresse e-mail ou mot de passe incorrect.';
      break;
    case 'auth/user-not-found':
      friendlyMessage = 'Aucun compte chauffeur trouvé avec cette adresse e-mail.';
      break;
    case 'auth/too-many-requests':
      friendlyMessage = 'Trop de tentatives infructueuses. Veuillez patienter un instant.';
      break;
    case 'auth/requires-recent-login':
      friendlyMessage = 'Cette opération nécessite une reconnexion récente pour des raisons de sécurité.';
      break;
    case 'auth/network-request-failed':
      friendlyMessage = 'Connexion réseau impossible. Vérifiez votre accès Internet.';
      break;
    default:
      if (typeof error?.message === 'string' && error.message) {
        friendlyMessage = error.message;
      }
      break;
  }

  return new RouteGuardAuthError(code, originalMessage, friendlyMessage);
}

/**
 * Service d'authentification pour ROUTEGUARD.
 * Gère les sessions anonymes initiales et la transition vers des comptes permanents e-mail/mot de passe.
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
        console.log('[Auth] Utilisateur actif :', user.uid, user.isAnonymous ? '(Anonyme)' : `(Permanent: ${user.email || 'Sans email'})`);
      } else {
        console.log('[Auth] Aucun utilisateur actif (Déconnecté).');
      }
    });

    // Initialiser automatiquement la session anonyme au démarrage si aucun utilisateur n'est présent
    this.initPromise = this.ensureAnonymousSession();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Assure qu'une session active existe (anonyme par défaut pour le démarrage immédiat).
   * Si une session (anonyme ou permanente) existe déjà, elle est conservée.
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
   * OBJECTIF 1 : CONVERSION ANONYME -> COMPTE PERMANENT
   * Lie le compte anonyme existant à des identifiants e-mail + mot de passe.
   * CONSERVE STRICTEMENT LE MÊME UID FIREBASE.
   */
  public async linkAnonymousToEmail(
    email: string,
    password: string,
    displayName?: string
  ): Promise<User> {
    const trimmedEmail = email.trim();
    let user = this.getCurrentUser();

    // S'assurer qu'un utilisateur existe à lier
    if (!user) {
      user = await this.ensureAnonymousSession();
    }

    if (!user) {
      throw new RouteGuardAuthError(
        'auth/no-current-user',
        'Aucun utilisateur courant à convertir',
        'Impossible de trouver la session active du chauffeur.'
      );
    }

    try {
      const credential = EmailAuthProvider.credential(trimmedEmail, password);
      const userCredential = await linkWithCredential(user, credential);
      const linkedUser = userCredential.user;

      if (displayName && displayName.trim()) {
        await updateProfile(linkedUser, { displayName: displayName.trim() });
      }

      this.currentUser = linkedUser;
      console.log('[Auth] Compte anonyme converti avec succès. UID conservé :', linkedUser.uid);
      return linkedUser;
    } catch (error: any) {
      console.error('[Auth] Échec linkAnonymousToEmail :', error?.code || error?.message);
      throw mapFirebaseErrorToUserMessage(error);
    }
  }

  /**
   * OBJECTIF 2 : CRÉATION D'UN COMPTE PERMANENT EX-NIHILO
   * Crée un compte chauffeur permanent lorsqu'il n'y a pas de session anonyme à convertir.
   */
  public async registerPermanentAccount(
    email: string,
    password: string,
    displayName?: string
  ): Promise<User> {
    const trimmedEmail = email.trim();

    try {
      const userCredential = await createUserWithEmailAndPassword(this.auth, trimmedEmail, password);
      const newUser = userCredential.user;

      if (displayName && displayName.trim()) {
        await updateProfile(newUser, { displayName: displayName.trim() });
      }

      this.currentUser = newUser;
      console.log('[Auth] Nouveau compte permanent créé :', newUser.uid, newUser.email);
      return newUser;
    } catch (error: any) {
      console.error('[Auth] Échec registerPermanentAccount :', error?.code || error?.message);
      throw mapFirebaseErrorToUserMessage(error);
    }
  }

  /**
   * OBJECTIF 3 : CONNEXION E-MAIL / MOT DE PASSE
   */
  public async loginWithEmail(email: string, password: string): Promise<User> {
    const trimmedEmail = email.trim();

    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, trimmedEmail, password);
      this.currentUser = userCredential.user;
      console.log('[Auth] Connexion réussie pour :', userCredential.user.email, 'UID :', userCredential.user.uid);
      return userCredential.user;
    } catch (error: any) {
      console.error('[Auth] Échec loginWithEmail :', error?.code || error?.message);
      throw mapFirebaseErrorToUserMessage(error);
    }
  }

  /**
   * OBJECTIF 4 : DÉCONNEXION
   * Déconnecte l'utilisateur sans relancer automatiquement de session anonyme.
   */
  public async logout(): Promise<void> {
    try {
      await signOut(this.auth);
      this.currentUser = null;
      console.log('[Auth] Déconnexion effectuée.');
    } catch (error: any) {
      console.error('[Auth] Échec logout :', error?.code || error?.message);
      throw mapFirebaseErrorToUserMessage(error);
    }
  }

  /**
   * OBJECTIF 5 : RÉINITIALISATION DU MOT DE PASSE
   */
  public async resetPassword(email: string): Promise<void> {
    const trimmedEmail = email.trim();

    try {
      await sendPasswordResetEmail(this.auth, trimmedEmail);
      console.log('[Auth] E-mail de réinitialisation envoyé à :', trimmedEmail);
    } catch (error: any) {
      console.error('[Auth] Échec resetPassword :', error?.code || error?.message);
      throw mapFirebaseErrorToUserMessage(error);
    }
  }

  /**
   * OBJECTIF 6 : ÉTAT DU COMPTE
   */
  public isAnonymous(): boolean {
    const user = this.getCurrentUser();
    return Boolean(user?.isAnonymous);
  }

  public isPermanent(): boolean {
    const user = this.getCurrentUser();
    return Boolean(user && !user.isAnonymous);
  }

  public getUserEmail(): string | null {
    return this.getCurrentUser()?.email || null;
  }

  public getUserDisplayName(): string | null {
    return this.getCurrentUser()?.displayName || null;
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
