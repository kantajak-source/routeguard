import React, { useState, useMemo } from 'react';
import { User } from 'firebase/auth';
import { ActiveScreen, AlertItem } from '../../types/routeguard';
import { alertService } from '../../services/alertService';
import { authService } from '../../services/authService';
import { outboxService } from '../../services/outboxService';
import { outboxSyncService } from '../../services/outboxSyncService';
import {
  Building,
  Bus,
  Route,
  Bell,
  Volume2,
  Wifi,
  HelpCircle,
  Info,
  LogOut,
  Database,
  UserCheck,
  RefreshCw,
  User as UserIcon,
  Mail,
  ArrowRight,
  ChevronRight,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react';

interface ProfileScreenProps {
  onLogout?: () => void;
  activeDriver?: string;
  onToggleDriver?: () => void;
  onNavigate?: (screen: ActiveScreen) => void;
  currentUser?: User | null;
  alerts?: AlertItem[];
  onSelectAlert?: (alert: AlertItem) => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  onLogout,
  activeDriver = 'Chauffeur A (Jean)',
  onToggleDriver,
  onNavigate,
  currentUser,
  alerts = [],
  onSelectAlert,
}) => {
  // Détermination de l'identité Firebase réelle (prop ou service)
  const effectiveUser = currentUser ?? authService.getCurrentUser();
  const currentUid = effectiveUser?.uid || null;
  const isPermanent = Boolean(effectiveUser && !effectiveUser.isAnonymous);
  const isAnonymous = Boolean(effectiveUser?.isAnonymous) || !effectiveUser;
  const displayName = effectiveUser?.displayName || authService.getUserDisplayName();
  const email = effectiveUser?.email || authService.getUserEmail();

  // Nom affiché avec fallback propre et sécurisé
  const displayTitle = isPermanent
    ? displayName || (email ? email.split('@')[0] : 'Chauffeur RouteGuard')
    : 'Chauffeur invité';

  // Calculs locaux des contributions personnelles basés strictement sur l'UID Firebase
  const myReports = useMemo(() => {
    if (!currentUid || !alerts) return [];
    return alerts.filter(a => a.createdByUid === currentUid);
  }, [alerts, currentUid]);

  const myConfirmations = useMemo(() => {
    if (!currentUid || !alerts) return [];
    return alerts.filter(
      a => a.createdByUid !== currentUid && Boolean(a.confirmedByUids && a.confirmedByUids.includes(currentUid))
    );
  }, [alerts, currentUid]);

  const recentMyReports = useMemo(() => {
    return myReports.slice(0, 5);
  }, [myReports]);

  const recentMyConfirmations = useMemo(() => {
    return myConfirmations.slice(0, 5);
  }, [myConfirmations]);

  // État local de la double vue : 'myReports' (Mes signalements) ou 'myConfirmations' (Mes confirmations)
  const [activeContributionTab, setActiveContributionTab] = useState<'myReports' | 'myConfirmations'>('myReports');

  // Préférences de conduite locales
  const [preferences, setPreferences] = useState({
    notificationsEnabled: true,
    autoAudioEnabled: true,
    dataSaverEnabled: true,
  });

  const [showToast, setShowToast] = useState<string | null>(null);

  // GESTION OUTBOX LOCALE (J-1-2-4-A)
  const [outboxAlerts, setOutboxAlerts] = useState(() => outboxService.getAllOutboxAlerts());
  const [isSyncingOutbox, setIsSyncingOutbox] = useState(false);
  const [outboxFeedback, setOutboxFeedback] = useState<{
    type: 'success' | 'network_error' | 'auth_mismatch' | 'error';
    message: string;
  } | null>(null);

  const outboxCount = outboxAlerts.length;

  const refreshOutboxState = () => {
    const current = outboxService.getAllOutboxAlerts();
    setOutboxAlerts(current);
  };

  const handleManualSyncOutbox = async () => {
    if (isSyncingOutbox) return;
    setIsSyncingOutbox(true);
    setOutboxFeedback(null);

    try {
      const report = await outboxSyncService.syncPendingAlerts();
      refreshOutboxState();

      if (report.syncedCount > 0 || report.alreadySyncedCount > 0) {
        const totalSynchronized = report.syncedCount + report.alreadySyncedCount;
        setOutboxFeedback({
          type: 'success',
          message: `✓ Synchronisation terminée (${totalSynchronized} signalement${totalSynchronized > 1 ? 's' : ''})`,
        });
      } else if (report.skippedAuthMismatchCount > 0) {
        setOutboxFeedback({
          type: 'auth_mismatch',
          message: '⚠️ Certains signalements ne peuvent pas encore être synchronisés.',
        });
      } else if (report.failedCount > 0) {
        setOutboxFeedback({
          type: 'network_error',
          message: '⚠️ Synchronisation impossible pour le moment',
        });
      } else {
        // Aucune alerte n'a pu être synchronisée (ex: Outbox vide)
        setOutboxFeedback(null);
      }
    } catch {
      refreshOutboxState();
      setOutboxFeedback({
        type: 'network_error',
        message: '⚠️ Synchronisation impossible pour le moment',
      });
    } finally {
      setIsSyncingOutbox(false);
    }
  };

  const toggleSetting = (key: 'notificationsEnabled' | 'autoAudioEnabled' | 'dataSaverEnabled') => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      const label = key === 'notificationsEnabled' ? 'Notifications' : key === 'autoAudioEnabled' ? 'Audio automatique' : 'Économie de données';
      setShowToast(`${label} : ${updated[key] ? 'Activé' : 'Désactivé'}`);
      setTimeout(() => setShowToast(null), 2500);
      return updated;
    });
  };

  const handleResetData = () => {
    alertService.resetToDefault();
    setShowToast('Alertes de démonstration réinitialisées');
    setTimeout(() => setShowToast(null), 2500);
  };

  // Déconnexion réelle branchée sur la chaîne Firebase Auth
  const handleLogoutClick = () => {
    if (onLogout) {
      onLogout();
    }
  };

  // Redirection vers AuthScreen pour créer ou lier un compte
  const handleOpenAuth = () => {
    if (onNavigate) {
      onNavigate('auth');
    }
  };

  return (
    <div className="flex flex-col w-full pb-8 pt-2 px-4 gap-4 max-w-[420px] mx-auto select-none">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#002541] text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg border border-blue-400 animate-fade-in">
          {showToast}
        </div>
      )}

      {/* Screen Title */}
      <div className="pt-1 flex flex-col gap-0.5">
        <h2 className="font-black text-[24px] text-[#002541] tracking-tight">Profil Chauffeur</h2>
        <p className="text-xs font-semibold text-[#5a6573]">Compte de bord et paramètres du corridor N4</p>
      </div>

      {/* CARTE D'IDENTITÉ FIREBASE RÉELLE */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-3.5">
        <div className="flex items-center gap-3.5">
          {/* Avatar dynamique selon statut */}
          <div className={`relative w-14 h-14 rounded-full flex items-center justify-center shrink-0 shadow-md ${
            isPermanent ? 'bg-[#002541] text-white' : 'bg-[#fff4ea] border-2 border-[#fc9430] text-[#914d00]'
          }`}>
            {isPermanent ? (
              <span className="font-black text-xl">
                {displayTitle.charAt(0).toUpperCase()}
              </span>
            ) : (
              <UserIcon className="w-7 h-7 text-[#fc9430]" />
            )}
            <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${
              isPermanent ? 'bg-emerald-500' : 'bg-[#fc9430]'
            }`} />
          </div>

          {/* Informations Chauffeur */}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isPermanent ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[11px] uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  COMPTE CHAUFFEUR
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-[#914d00] font-black text-[11px] uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#fc9430]" />
                  SESSION INVITÉE
                </span>
              )}
            </div>

            <h3 className="font-black text-[18px] text-[#002541] truncate mt-1">
              {displayTitle}
            </h3>

            {isPermanent && email && (
              <div className="flex items-center gap-1.5 text-xs text-[#5a6573] font-medium truncate mt-0.5">
                <Mail className="w-3.5 h-3.5 text-[#fc9430] shrink-0" />
                <span className="truncate">{email}</span>
              </div>
            )}

            {isAnonymous && (
              <p className="text-[11px] text-[#5a6573] font-medium mt-0.5">
                Vous utilisez ROUTEGUARD sans compte permanent.
              </p>
            )}
          </div>
        </div>

        {/* Action principale pour utilisateur invité : CRÉER MON COMPTE */}
        {isAnonymous && (
          <div className="pt-1">
            <button
              onClick={handleOpenAuth}
              type="button"
              className="w-full min-h-[48px] rounded-xl bg-[#fc9430] hover:bg-[#e06a00] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-98 transition-all shadow-md"
            >
              <span>CRÉER MON COMPTE PERMANENT</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[10px] text-center text-[#73777f] font-medium mt-1.5">
              Enregistrez vos coordonnées pour conserver votre identité et vos contributions de bord
            </p>
          </div>
        )}

        {/* Action Déconnexion pour utilisateur permanent */}
        {isPermanent && (
          <div className="pt-1">
            <button
              onClick={handleLogoutClick}
              type="button"
              className="w-full min-h-[44px] rounded-xl bg-red-50 hover:bg-red-100 text-[#d92d20] border border-red-200 font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 active:scale-98 transition-all shadow-xs"
            >
              <LogOut className="w-4 h-4" />
              <span>DÉCONNEXION</span>
            </button>
          </div>
        )}
      </section>

      {/* SECTION SIGNALEMENTS EN ATTENTE (OUTBOX LOCALE - J-1-2-4-A) */}
      {outboxCount > 0 && (
        <section className="bg-amber-50/70 rounded-2xl p-4 shadow-sm border border-amber-200/90 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#914d00] flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-[#fc9430]" />
              Signalements en attente
            </span>
            <span className="text-[10px] font-extrabold bg-[#ffdcc3] text-[#914d00] px-2 py-0.5 rounded-full">
              {outboxCount} {outboxCount > 1 ? 'locaux' : 'local'}
            </span>
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <p className="font-bold text-[#002541]">
              {outboxCount} signalement{outboxCount > 1 ? 's' : ''} conservé{outboxCount > 1 ? 's' : ''} localement
            </p>
            <p className="text-[11px] text-[#5a6573] leading-relaxed">
              En attente de connexion réseau ou d'émission vers le corridor. Vous pouvez déclencher manuellement la synchronisation.
            </p>
          </div>

          {/* Feedback messages */}
          {outboxFeedback && (
            <div className={`p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
              outboxFeedback.type === 'success'
                ? 'bg-emerald-100/80 text-emerald-800 border border-emerald-300'
                : outboxFeedback.type === 'auth_mismatch'
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-red-50 text-[#d92d20] border border-red-200'
            }`}>
              {outboxFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{outboxFeedback.message}</span>
            </div>
          )}

          {/* Bouton de synchronisation manuelle */}
          <button
            type="button"
            onClick={handleManualSyncOutbox}
            disabled={isSyncingOutbox}
            className={`w-full min-h-[44px] rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm ${
              isSyncingOutbox
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-[#002541] hover:bg-[#003865] active:scale-98 text-white'
            }`}
          >
            {isSyncingOutbox ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#fc9430]" />
                <span>Synchronisation en cours…</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 text-[#fc9430]" />
                <span>Synchroniser</span>
              </>
            )}
          </button>
        </section>
      )}

      {/* SECTION MES CONTRIBUTIONS N4 */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#914d00]">
            Mes contributions N4
          </span>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            {isPermanent ? 'Compte vérifié' : 'Session en cours'}
          </span>
        </div>

        {/* 2 Compteurs factuels et interactifs */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setActiveContributionTab('myReports')}
            className={`flex flex-col p-3 rounded-xl text-left transition-all ${
              activeContributionTab === 'myReports'
                ? 'bg-[#edf4ff] border-2 border-blue-400/80 shadow-xs'
                : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-[#5a6573]">
              Signalements
            </span>
            <span className="text-2xl font-black text-[#002541] mt-0.5">
              {myReports.length}
            </span>
            <span className="text-[10px] text-[#5a6573] font-medium mt-0.5">
              Dangers partagés
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveContributionTab('myConfirmations')}
            className={`flex flex-col p-3 rounded-xl text-left transition-all ${
              activeContributionTab === 'myConfirmations'
                ? 'bg-emerald-50/70 border-2 border-emerald-400/80 shadow-xs'
                : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-[#5a6573]">
              Confirmations
            </span>
            <span className="text-2xl font-black text-[#002541] mt-0.5">
              {myConfirmations.length}
            </span>
            <span className="text-[10px] text-[#5a6573] font-medium mt-0.5">
              Alertes confirmées
            </span>
          </button>
        </div>

        {/* Sélecteur tactile d'onglets */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => setActiveContributionTab('myReports')}
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-black transition-all ${
              activeContributionTab === 'myReports'
                ? 'bg-white text-[#002541] shadow-xs border border-slate-200/90'
                : 'text-slate-600 hover:text-[#002541]'
            }`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <span>🚨</span>
              <span className="truncate">Mes signalements</span>
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeContributionTab === 'myReports'
                ? 'bg-[#edf4ff] text-[#002541] border border-blue-200'
                : 'bg-slate-200 text-slate-700'
            }`}>
              {myReports.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveContributionTab('myConfirmations')}
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-black transition-all ${
              activeContributionTab === 'myConfirmations'
                ? 'bg-white text-emerald-800 shadow-xs border border-emerald-200/90'
                : 'text-slate-600 hover:text-[#002541]'
            }`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <span>✓</span>
              <span className="truncate">Mes confirmations</span>
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeContributionTab === 'myConfirmations'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-slate-200 text-slate-700'
            }`}>
              {myConfirmations.length}
            </span>
          </button>
        </div>

        {/* CONTENU DE LA VUE ACTIVE */}
        {activeContributionTab === 'myReports' ? (
          <div className="flex flex-col gap-2 pt-0.5">
            <span className="text-[11px] font-bold text-[#002541]">
              Mes derniers signalements
            </span>

            {recentMyReports.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center flex flex-col items-center gap-1">
                <span className="text-sm">📢</span>
                <span className="text-xs font-bold text-[#002541]">Aucun signalement pour le moment</span>
                <span className="text-[10px] text-slate-500">
                  Vos signalements validés apparaîtront ici.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentMyReports.map((alert) => {
                  const confCount = alert.confirmationCount || alert.confirmationsCount || 1;
                  const isCommunityConfirmed = confCount > 1;

                  return (
                    <div
                      key={alert.id}
                      onClick={() => onSelectAlert?.(alert)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectAlert?.(alert);
                        }
                      }}
                      className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/80 border border-slate-200/80 flex items-center justify-between gap-2 cursor-pointer transition-all duration-150 active:scale-[0.99] select-none text-left"
                      aria-label={`Voir le détail du signalement ${alert.title || alert.type}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                          {alert.type === 'ACCIDENT' && <span className="text-sm">🚨</span>}
                          {alert.type === 'VEHICULE_IMMOBILISE' && <span className="text-sm">🚧</span>}
                          {alert.type === 'FORTE_PLUIE' && <span className="text-sm">🌧️</span>}
                          {alert.type === 'OBSTACLE' && <span className="text-sm">⚠️</span>}
                          {alert.type === 'RALENTISSEMENT' && <span className="text-sm">🛑</span>}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[#002541] truncate">
                              {alert.title || alert.type.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                            <span className="truncate">{alert.location || alert.sector || 'Corridor N4'}</span>
                            <span>•</span>
                            <span className="shrink-0">{alert.timeAgo}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isCommunityConfirmed ? (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-extrabold">
                            <span>✓</span>
                            <span>Validé par la communauté · {confCount} conf.</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-extrabold">
                            <span>⏳</span>
                            <span>En attente de validation</span>
                          </div>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 pt-0.5">
            <span className="text-[11px] font-bold text-[#002541]">
              Mes alertes confirmées
            </span>

            {recentMyConfirmations.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center flex flex-col items-center gap-1">
                <span className="text-sm">✓</span>
                <span className="text-xs font-bold text-[#002541]">Aucune confirmation pour le moment</span>
                <span className="text-[10px] text-slate-500">
                  Vous n'avez encore confirmé aucune alerte de confrère.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentMyConfirmations.map((alert) => {
                  const confCount = alert.confirmationCount || alert.confirmationsCount || 1;

                  return (
                    <div
                      key={alert.id}
                      onClick={() => onSelectAlert?.(alert)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectAlert?.(alert);
                        }
                      }}
                      className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200/80 border border-slate-200/80 flex items-center justify-between gap-2 cursor-pointer transition-all duration-150 active:scale-[0.99] select-none text-left"
                      aria-label={`Voir le détail de l'alerte confirmée ${alert.title || alert.type}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                          {alert.type === 'ACCIDENT' && <span className="text-sm">🚨</span>}
                          {alert.type === 'VEHICULE_IMMOBILISE' && <span className="text-sm">🚧</span>}
                          {alert.type === 'FORTE_PLUIE' && <span className="text-sm">🌧️</span>}
                          {alert.type === 'OBSTACLE' && <span className="text-sm">⚠️</span>}
                          {alert.type === 'RALENTISSEMENT' && <span className="text-sm">🛑</span>}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[#002541] truncate">
                              {alert.title || alert.type.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                            <span className="truncate">{alert.location || alert.sector || 'Corridor N4'}</span>
                            <span>•</span>
                            <span className="shrink-0">{alert.timeAgo}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-extrabold">
                          <span>✓</span>
                          <span>{confCount} conf.</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* CONTEXTE DE CONDUITE */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-3">
        <span className="text-[11px] font-black uppercase tracking-wider text-[#914d00]">
          Contexte de conduite
        </span>

        {/* Corridor habituel N4 */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#edf4ff]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#ffdcc3] text-[#914d00] flex items-center justify-center shrink-0">
              <Route className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-[#002541] flex items-center gap-1.5">
                <span>Yaoundé</span>
                <span className="text-[#f28c28]">→</span>
                <span>Bafoussam</span>
              </span>
              <span className="text-[11px] text-[#5a6573] font-semibold">Corridor Axe National N4</span>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase">
            Actif
          </span>
        </div>

        {/* Véhicule & Poste de bord (contexte local indicatif) */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <Building className="w-4 h-4 text-[#fc9430] shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Compagnie</span>
              <span className="font-bold text-[#002541] truncate">Inter-urbain N4</span>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <Bus className="w-4 h-4 text-[#fc9430] shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Véhicule</span>
              <span className="font-bold text-[#002541] truncate">Car grand confort</span>
            </div>
          </div>
        </div>
      </section>

      {/* PRÉFÉRENCES DE CONDUITE */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-1">
        <span className="text-[11px] font-black uppercase tracking-wider text-[#914d00] mb-2">
          Préférences de conduite
        </span>

        {/* Notifications */}
        <div className="flex items-center justify-between py-2.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#edf4ff] flex items-center justify-center text-[#002541] shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-[#002541]">Notifications</span>
              <span className="text-[11px] text-[#5a6573]">Alertes de danger immédiat</span>
            </div>
          </div>
          <button
            onClick={() => toggleSetting('notificationsEnabled')}
            type="button"
            className={`w-12 h-7 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 ${
              preferences.notificationsEnabled ? 'bg-[#f28c28]' : 'bg-slate-300'
            }`}
            aria-label="Activer les notifications"
          >
            <span className={`block w-5 h-5 bg-white rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
              preferences.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>

        <div className="h-px bg-slate-100 w-full" />

        {/* Audio automatique */}
        <div className="flex items-center justify-between py-2.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#edf4ff] flex items-center justify-center text-[#002541] shrink-0">
              <Volume2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-[#002541]">Audio automatique</span>
              <span className="text-[11px] text-[#5a6573]">Synthèse vocale sans manipulation</span>
            </div>
          </div>
          <button
            onClick={() => toggleSetting('autoAudioEnabled')}
            type="button"
            className={`w-12 h-7 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 ${
              preferences.autoAudioEnabled ? 'bg-[#f28c28]' : 'bg-slate-300'
            }`}
            aria-label="Activer l'audio automatique"
          >
            <span className={`block w-5 h-5 bg-white rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
              preferences.autoAudioEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>

        <div className="h-px bg-slate-100 w-full" />

        {/* Économie de données */}
        <div className="flex items-center justify-between py-2.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#edf4ff] flex items-center justify-center text-[#002541] shrink-0">
              <Wifi className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-[#002541]">Économie de données</span>
              <span className="text-[11px] text-[#5a6573]">Réseau optimisé zones blanches N4</span>
            </div>
          </div>
          <button
            onClick={() => toggleSetting('dataSaverEnabled')}
            type="button"
            className={`w-12 h-7 rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 ${
              preferences.dataSaverEnabled ? 'bg-[#f28c28]' : 'bg-slate-300'
            }`}
            aria-label="Activer l'économie de données"
          >
            <span className={`block w-5 h-5 bg-white rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
              preferences.dataSaverEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </section>

      {/* AIDE & À PROPOS */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200/80 flex flex-col overflow-hidden">
        <button
          onClick={() => {
            setShowToast('Guide chauffeur : Utilisez le bouton micro pour parler.');
            setTimeout(() => setShowToast(null), 3000);
          }}
          className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors text-left"
          type="button"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#edf4ff] flex items-center justify-center text-[#002541] shrink-0">
              <HelpCircle className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-[#002541]">Aide & Mode d'emploi</span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        <div className="h-px bg-slate-100 w-full" />

        <button
          onClick={() => {
            setShowToast('ROUTEGUARD v2.4.1 - Corridor Yaoundé-Bafoussam');
            setTimeout(() => setShowToast(null), 3000);
          }}
          className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors text-left"
          type="button"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#edf4ff] flex items-center justify-center text-[#002541] shrink-0">
              <Info className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-[#002541]">À propos du projet</span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      </section>

      {/* OUTILS DE TEST DU CORRIDOR (SECTION SECONDAIRE) */}
      <section className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            Outils de test du corridor
          </span>
          <span className="text-[9px] font-extrabold uppercase bg-slate-200 text-slate-600 px-1.5 py-0.2 rounded">
            Poste simulation
          </span>
        </div>

        <div className="p-2 rounded-lg bg-white border border-slate-100 flex items-center justify-between text-[11px]">
          <span className="text-slate-500 font-medium">Chauffeur actif de test :</span>
          <strong className="text-[#002541] font-bold">{activeDriver}</strong>
        </div>

        {onToggleDriver && (
          <button
            onClick={onToggleDriver}
            type="button"
            className="w-full min-h-[38px] bg-white hover:bg-slate-100 text-[#002541] border border-slate-200 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1.5 active:scale-98 transition-all"
          >
            <UserCheck className="w-3.5 h-3.5 text-[#fc9430]" />
            <span>Basculer le chauffeur de test</span>
          </button>
        )}

        <button
          onClick={handleResetData}
          type="button"
          className="w-full py-1 text-[10px] font-bold text-slate-500 hover:text-[#002541] flex items-center justify-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Réinitialiser les alertes d'exemple</span>
        </button>
      </section>

      {/* Pied de page */}
      <div className="text-center pt-1 text-[10px] font-extrabold uppercase text-[#73777f]">
        ROUTEGUARD v2.4.1 • POSTE AXE YAOUNDÉ-BAFOUSSAM
      </div>
    </div>
  );
};
