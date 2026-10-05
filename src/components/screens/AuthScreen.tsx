import React, { useState } from 'react';
import { authService, RouteGuardAuthError } from '../../services/authService';
import {
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  KeyRound,
  RotateCcw
} from 'lucide-react';

export type AuthMode = 'LOGIN' | 'REGISTER' | 'CONVERT_ANONYMOUS' | 'RESET_PASSWORD';

export interface AuthScreenProps {
  onAuthenticated?: () => void;
  onContinueAsGuest?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  onContinueAsGuest,
}) => {
  // Déterminer le mode initial : si l'utilisateur est en session anonyme, proposer la conversion
  const isCurrentlyAnonymous = authService.isAnonymous();
  const [mode, setMode] = useState<AuthMode>(() => {
    if (isCurrentlyAnonymous) {
      return 'CONVERT_ANONYMOUS';
    }
    return 'LOGIN';
  });

  // États du formulaire
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // États d'exécution et de retour utilisateur
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Bascule de mode avec réinitialisation des messages
  const handleSwitchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowPassword(false);
  };

  // Traitement de la soumission du formulaire principal
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();

    // 1. MODE RÉINITIALISATION DU MOT DE PASSE
    if (mode === 'RESET_PASSWORD') {
      if (!cleanEmail) {
        setErrorMessage('Veuillez renseigner votre adresse e-mail.');
        return;
      }
      setIsLoading(true);
      try {
        await authService.resetPassword(cleanEmail);
        setSuccessMessage('Un lien de réinitialisation a été envoyé à votre adresse e-mail.');
      } catch (err: any) {
        const msg = err instanceof RouteGuardAuthError ? err.userFriendlyMessage : (err?.message || 'Erreur lors de l\'envoi du lien.');
        setErrorMessage(msg);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 2. VÉRIFICATIONS COMMUNES CONNEXION / CRÉATION / CONVERSION
    if (!cleanEmail) {
      setErrorMessage('Veuillez renseigner votre adresse e-mail.');
      return;
    }
    if (!password) {
      setErrorMessage('Veuillez saisir votre mot de passe.');
      return;
    }

    // 3. VÉRIFICATIONS SPÉCIFIQUES CRÉATION OU CONVERSION
    if (mode === 'REGISTER' || mode === 'CONVERT_ANONYMOUS') {
      if (password.length < 6) {
        setErrorMessage('Le mot de passe doit contenir au moins 6 caractères.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Les deux mots de passe ne correspondent pas.');
        return;
      }
    }

    setIsLoading(true);

    try {
      // 4. ACTION SELON LE MODE
      if (mode === 'LOGIN') {
        await authService.loginWithEmail(cleanEmail, password);
        setSuccessMessage('Connexion réussie ! Chargement de votre poste de bord...');
        setTimeout(() => {
          onAuthenticated?.();
        }, 800);
      } else if (mode === 'CONVERT_ANONYMOUS') {
        // Utilise obligatoirement linkAnonymousToEmail pour conserver l'UID strict
        await authService.linkAnonymousToEmail(cleanEmail, password, displayName);
        setSuccessMessage('Compte permanent créé avec succès ! Vos alertes et confirmations ont été conservées.');
        setTimeout(() => {
          onAuthenticated?.();
        }, 1200);
      } else if (mode === 'REGISTER') {
        // Création classique ex-nihilo
        await authService.registerPermanentAccount(cleanEmail, password, displayName);
        setSuccessMessage('Compte chauffeur créé avec succès ! Bienvenue à bord.');
        setTimeout(() => {
          onAuthenticated?.();
        }, 1000);
      }
    } catch (err: any) {
      const msg = err instanceof RouteGuardAuthError ? err.userFriendlyMessage : (err?.message || 'Une erreur est survenue.');
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full pb-8 pt-2 px-4 gap-4 max-w-[420px] mx-auto select-none">
      {/* En-tête de marque ROUTEGUARD */}
      <div className="flex flex-col items-center text-center pt-2 pb-1">
        <div className="w-14 h-14 rounded-2xl bg-[#002541] flex items-center justify-center text-white shadow-md mb-2.5">
          <ShieldCheck className="w-8 h-8 text-[#fc9430]" />
        </div>
        <span className="text-[11px] font-black uppercase tracking-widest text-[#fc9430]">
          ROUTEGUARD SÉCURITÉ
        </span>
        <h1 className="text-2xl font-black text-[#002541] tracking-tight mt-0.5">
          {mode === 'LOGIN' && 'Connexion Chauffeur'}
          {mode === 'CONVERT_ANONYMOUS' && 'Créer mon compte'}
          {mode === 'REGISTER' && 'Inscription Chauffeur'}
          {mode === 'RESET_PASSWORD' && 'Mot de passe oublié'}
        </h1>
        <p className="text-xs text-[#5a6573] font-medium max-w-xs mt-1">
          {mode === 'LOGIN' && 'Accédez à votre compte de bord sur le corridor Yaoundé-Bafoussam.'}
          {mode === 'CONVERT_ANONYMOUS' && 'Votre compte invité sera transformé en compte permanent sans perte de vos signalements.'}
          {mode === 'REGISTER' && 'Rejoignez la communauté de chauffeurs professionnels de la N4.'}
          {mode === 'RESET_PASSWORD' && 'Recevez un lien par e-mail pour redéfinir votre mot de passe.'}
        </p>
      </div>

      {/* Bannière informative si conversion d'un compte invité */}
      {mode === 'CONVERT_ANONYMOUS' && (
        <div className="bg-[#edf4ff] border border-blue-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-[#002541]">
          <ShieldCheck className="w-4 h-4 text-[#fc9430] shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="font-bold">Conservation de votre identité de bord</span>
            <span className="text-[11px] text-[#5a6573]">
              Vos signalements et confirmations déjà effectués sur la N4 seront automatiquement liés à votre nouveau mot de passe.
            </span>
          </div>
        </div>
      )}

      {/* Notification d'erreur */}
      {errorMessage && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-[#d92d20] rounded-xl p-3.5 flex items-start gap-2.5 text-xs animate-shake"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-semibold leading-relaxed flex-1">{errorMessage}</span>
        </div>
      )}

      {/* Notification de succès */}
      {successMessage && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 text-[#2e7d32] rounded-xl p-3.5 flex items-start gap-2.5 text-xs animate-fade-in"
        >
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-semibold leading-relaxed flex-1">{successMessage}</span>
        </div>
      )}

      {/* Formulaire Principal */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col gap-4">
        {/* Champ Nom / Indicatif Chauffeur (création / conversion uniquement) */}
        {(mode === 'REGISTER' || mode === 'CONVERT_ANONYMOUS') && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-[#002541] flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-[#fc9430]" />
              <span>Nom ou indicatif chauffeur</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ex: Jean (Touristique) ou Capitaine N4"
              disabled={isLoading}
              className="w-full min-h-[48px] px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-[#002541] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#002541] focus:bg-white transition-all"
            />
          </div>
        )}

        {/* Champ E-mail */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#002541] flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-[#fc9430]" />
            <span>Adresse e-mail professionnelle</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="chauffeur@compagnie.cm"
            disabled={isLoading}
            autoComplete="email"
            required
            className="w-full min-h-[48px] px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-[#002541] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#002541] focus:bg-white transition-all"
          />
        </div>

        {/* Champ Mot de passe (hors réinitialisation) */}
        {mode !== 'RESET_PASSWORD' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#002541] flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#fc9430]" />
                <span>Mot de passe</span>
              </label>
              {mode === 'LOGIN' && (
                <button
                  type="button"
                  onClick={() => handleSwitchMode('RESET_PASSWORD')}
                  className="text-[11px] font-bold text-[#fc9430] hover:underline"
                >
                  Mot de passe oublié ?
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'}
                required
                className="w-full min-h-[48px] pl-3.5 pr-11 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-[#002541] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#002541] focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 p-1.5 text-slate-400 hover:text-[#002541] transition-colors"
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Champ Confirmation du mot de passe (création / conversion) */}
        {(mode === 'REGISTER' || mode === 'CONVERT_ANONYMOUS') && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-[#002541] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#fc9430]" />
              <span>Confirmer le mot de passe</span>
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
              autoComplete="new-password"
              required
              className="w-full min-h-[48px] px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-[#002541] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#002541] focus:bg-white transition-all"
            />
          </div>
        )}

        {/* Bouton d'action principal */}
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full min-h-[52px] rounded-xl font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.99] mt-2 ${
            isLoading
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-[#fc9430] hover:bg-[#e06a00] text-white'
          }`}
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>
                {mode === 'LOGIN' && 'Connexion...'}
                {mode === 'CONVERT_ANONYMOUS' && 'Création du compte permanent...'}
                {mode === 'REGISTER' && 'Création du compte...'}
                {mode === 'RESET_PASSWORD' && 'Envoi en cours...'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span>
                {mode === 'LOGIN' && 'SE CONNECTER'}
                {mode === 'CONVERT_ANONYMOUS' && 'CRÉER MON COMPTE PERMANENT'}
                {mode === 'REGISTER' && 'CRÉER MON COMPTE'}
                {mode === 'RESET_PASSWORD' && 'ENVOYER LE LIEN'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </div>
          )}
        </button>
      </form>

      {/* Navigation entre les modes */}
      <div className="flex flex-col items-center gap-3 pt-1">
        {mode === 'LOGIN' && (
          <div className="flex items-center gap-1.5 text-xs text-[#5a6573]">
            <span>Nouveau sur le corridor ?</span>
            <button
              type="button"
              onClick={() => handleSwitchMode(isCurrentlyAnonymous ? 'CONVERT_ANONYMOUS' : 'REGISTER')}
              className="font-black text-[#002541] hover:underline"
            >
              Créer mon compte
            </button>
          </div>
        )}

        {(mode === 'REGISTER' || mode === 'CONVERT_ANONYMOUS') && (
          <div className="flex items-center gap-1.5 text-xs text-[#5a6573]">
            <span>Déjà un compte chauffeur ?</span>
            <button
              type="button"
              onClick={() => handleSwitchMode('LOGIN')}
              className="font-black text-[#002541] hover:underline"
            >
              Se connecter
            </button>
          </div>
        )}

        {mode === 'RESET_PASSWORD' && (
          <button
            type="button"
            onClick={() => handleSwitchMode('LOGIN')}
            className="flex items-center gap-1 text-xs font-bold text-[#002541] hover:underline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retour à la connexion</span>
          </button>
        )}

        {/* Bouton Continuer en mode invité */}
        {onContinueAsGuest && (
          <div className="pt-2 w-full">
            <button
              type="button"
              onClick={onContinueAsGuest}
              disabled={isLoading}
              className="w-full min-h-[46px] rounded-xl bg-slate-100 hover:bg-slate-200 text-[#002541] font-bold text-xs uppercase tracking-wider flex items-center justify-center transition-colors"
            >
              Continuer en mode invité
            </button>
            <p className="text-[10px] text-center text-[#73777f] font-medium mt-1">
              Surveillance du corridor N4 active sans enregistrement
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
