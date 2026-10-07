import React, { useState, useEffect } from 'react';
import { AlertItem } from '../../types/routeguard';
import { voiceService } from '../../services/voiceService';
import { authService } from '../../services/authService';
import { DEFAULT_MAX_ALERT_AGE_MINUTES } from '../../services/corridorService';
import { ArrowLeft, Check, AlertTriangle, Play, Pause } from 'lucide-react';

interface AlertDetailScreenProps {
  alert: AlertItem;
  onBack: () => void;
  onConfirmAlert: (alertId: string) => void;
  isAudioMuted: boolean;
  /** Horodatage de référence optionnel pour tests déterministes */
  overrideNow?: number | string | Date;
}

export const AlertDetailScreen: React.FC<AlertDetailScreenProps> = ({
  alert,
  onBack,
  onConfirmAlert,
  isAudioMuted,
  overrideNow,
}) => {
  // Détermination de propriété de l'alerte basée strictement sur l'UID Firebase réel
  const isOwnAlert = Boolean(
    alert.createdByUid && alert.createdByUid === authService.getCurrentUser()?.uid
  );

  // --------------------------------------------------------------------------
  // CALCUL DE FRAÎCHEUR LOCALE (ÉTAPE 7C-5-1-G-1)
  // Réutilisation stricte de DEFAULT_MAX_ALERT_AGE_MINUTES = 120 depuis corridorService.
  // Règle : âge = now - alert.createdAt <= DEFAULT_MAX_ALERT_AGE_MINUTES * 60 * 1000
  // --------------------------------------------------------------------------
  const nowMs = typeof overrideNow === 'number'
    ? overrideNow
    : (overrideNow instanceof Date ? overrideNow.getTime() : Date.now());

  const parseCreatedAt = (raw: unknown): number | null => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'number') {
      if (isNaN(raw) || !isFinite(raw) || raw <= 0) return null;
      return raw;
    }
    if (raw instanceof Date) {
      const t = raw.getTime();
      return isNaN(t) || t <= 0 ? null : t;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const parsed = Date.parse(trimmed);
      return isNaN(parsed) || parsed <= 0 ? null : parsed;
    }
    return null;
  };

  const createdTimestamp = parseCreatedAt(alert.createdAt);
  const hasValidTimestamp = createdTimestamp !== null && createdTimestamp <= nowMs;
  const alertAgeMs = hasValidTimestamp && createdTimestamp !== null ? nowMs - createdTimestamp : null;
  const maxAgeMs = DEFAULT_MAX_ALERT_AGE_MINUTES * 60 * 1000;

  // Seuil strict : <= 120 min => fraîche, > 120 min => expirée
  const isFresh = Boolean(hasValidTimestamp && alertAgeMs !== null && alertAgeMs <= maxAgeMs);
  const isExpired = Boolean(hasValidTimestamp && alertAgeMs !== null && alertAgeMs > maxAgeMs);

  // Calcul robuste des confirmations confrères pour le propre signalement
  const totalConfirmations = alert.confirmationCount ?? alert.confirmationsCount ?? 1;
  const peerConfirmations = Math.max(0, totalConfirmations - 1);

  // Independent state 1: Audio playback
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Independent state 2: Local confirmation state for immediate responsiveness
  const [hasConfirmed, setHasConfirmed] = useState<boolean>(Boolean(alert.userConfirmed));

  // Independent state 3: Incorrect report state
  const [hasReportedIncorrect, setHasReportedIncorrect] = useState<boolean>(false);

  // Synchronize local confirmation state whenever the alert changes
  useEffect(() => {
    setHasConfirmed(Boolean(alert.userConfirmed));
  }, [alert.id, alert.userConfirmed]);

  // Ensure speech recognition or background audio listeners are stopped on mount and unmount
  useEffect(() => {
    voiceService.stopAllListening();

    return () => {
      voiceService.stopSpeaking();
      voiceService.stopAllListening();
    };
  }, []);

  // Compute live confirmation state for current driver
  const isConfirmed = Boolean(alert.userConfirmed || hasConfirmed);

  // -------------------------------------------------------------
  // ACTION 1 : ÉCOUTER L'ALERTE (Strictly audio playback ONLY)
  // Ne modifie JAMAIS l'état de confirmation ni n'envoie d'alerte.
  // Toujours disponible même si expirée.
  // -------------------------------------------------------------
  const handleToggleAudio = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Ensure no speech recognition listener interferes
    voiceService.stopAllListening();

    if (isPlaying) {
      voiceService.stopSpeaking();
      setIsPlaying(false);
      return;
    }

    voiceService.playRadioBeep('alert');
    setIsPlaying(true);

    if (isAudioMuted) {
      setTimeout(() => {
        setIsPlaying(false);
      }, 3500);
      return;
    }

    // Play synthesized voice transcript
    voiceService.speakText(
      alert.audioTranscript,
      () => {
        // On end: reset only audio state, stay on screen, no confirmation
        setIsPlaying(false);
      },
      () => {
        // On error: reset audio state only
        setIsPlaying(false);
      }
    );
  };

  // -------------------------------------------------------------
  // ACTION 2 : CONFIRMER L'ALERTE (Strictly confirmation ONLY)
  // 1. Enregistre la confirmation de l'utilisateur courant
  // 2. Incrémente immédiatement le compteur de confirmations de 1
  // 3. Affiche "✓ VOUS AVEZ CONFIRMÉ CETTE ALERTE"
  // 4. Empêche toute confirmation ultérieure ou anachronique
  // -------------------------------------------------------------
  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Guards : Empêcher double confirmation ou confirmation sur alerte non fraîche
    if (isConfirmed || !isFresh) return;

    voiceService.playRadioBeep('success');
    setHasConfirmed(true);
    onConfirmAlert(alert.id);
  };

  // -------------------------------------------------------------
  // ACTION 3 : SIGNALER INFORMATION INCORRECTE (Strictly report ONLY)
  // Déclenchée UNIQUEMENT lors d'un clic explicite sur ce bouton.
  // -------------------------------------------------------------
  const handleReportIncorrect = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (hasReportedIncorrect) return;

    voiceService.playRadioBeep('stop');
    setHasReportedIncorrect(true);
  };

  return (
    <div className="flex flex-col w-full pb-8 pt-2 px-4 gap-5 max-w-[420px] mx-auto select-none relative">
      {/* Top bar with back button */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full bg-[#edf4ff] hover:bg-[#dfe9f7] text-[#002541] flex items-center justify-center active:scale-95 transition-all"
          type="button"
          aria-label="Retour aux alertes"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-extrabold text-[20px] text-[#002541]">
          Détail de l'alerte
        </h1>
      </div>

      {/* Main Alert Headline Area */}
      <div className="flex flex-col items-center text-center mt-3 gap-3">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-[#d92d20] text-white px-5 py-2 rounded-full font-black text-sm uppercase tracking-wider shadow-sm">
          <span>🚨</span>
          <span>{alert.badgeText || alert.title}</span>
        </div>

        {/* Badge contextuel discret : VOTRE SIGNALEMENT */}
        {isOwnAlert && (
          <div className="inline-flex items-center gap-1.5 bg-[#edf4ff] text-[#002541] border border-blue-200/90 px-3.5 py-1 rounded-full font-extrabold text-xs uppercase tracking-wide shadow-xs">
            <span className="text-sm">🛡️</span>
            <span>VOTRE SIGNALEMENT</span>
          </div>
        )}

        {/* Distance & Location */}
        <div className="flex flex-col items-center mt-1">
          <div className="font-black text-[40px] text-[#d92d20] leading-none tracking-tight uppercase">
            {alert.distanceKm ? `${alert.distanceKm} KM` : alert.location || alert.sector || alert.distanceText}
          </div>
          <div className="font-black text-[20px] text-[#d92d20] tracking-wide mt-1">
            {alert.distanceKm ? 'DEVANT VOUS' : 'SUR VOTRE CORRIDOR'}
          </div>
        </div>

        {/* Direction */}
        <div className="flex items-center gap-2 font-black text-[22px] text-[#002541] tracking-wide mt-1">
          <span className="material-symbols-outlined text-[24px]">trending_flat</span>
          <span>{alert.direction.toUpperCase()}</span>
        </div>
      </div>

      {/* Audio Player Card */}
      <div className="w-full bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col gap-3.5">
        <div className="flex items-center justify-between text-xs font-black text-[#002541] uppercase tracking-wide">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🎙️</span>
            <span>ALERTE VOCALE</span>
            {isPlaying && (
              <span className="ml-1 text-[10px] bg-red-100 text-[#d92d20] px-2 py-0.5 rounded-full animate-pulse font-bold">
                LECTURE EN COURS
              </span>
            )}
          </div>
          <span className="bg-[#f1f5f9] px-2.5 py-1 rounded-md text-[#5a6573] font-mono">
            {alert.audioDuration}
          </span>
        </div>

        {/* Big Navy Play Button : ÉCOUTER L'ALERTE */}
        <button
          onClick={handleToggleAudio}
          type="button"
          className={`w-full min-h-[58px] rounded-2xl font-black text-[15px] uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all shadow-md ${
            isPlaying 
              ? 'bg-[#d92d20] text-white ring-4 ring-red-200 active:scale-[0.98]' 
              : 'bg-[#123b5d] hover:bg-[#002541] active:scale-[0.98] text-white'
          }`}
          aria-label={isPlaying ? "Mettre en pause l'écoute audio" : "Écouter l'alerte sonore"}
        >
          {isPlaying ? (
            <>
              <Pause className="w-5 h-5 fill-current" />
              <span>PAUSE L'ALERTE</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current ml-0.5" />
              <span>ÉCOUTER L'ALERTE</span>
            </>
          )}
        </button>

        {/* Transcript text box for accessibility / loud cabin */}
        <div className="bg-[#f8fafc] rounded-xl p-3 border border-slate-100 text-xs text-[#42474e] leading-relaxed italic">
          « {alert.audioTranscript || alert.description} »
        </div>

        {alert.createdBy && (
          <div className="text-[11px] text-[#5a6573] font-semibold text-center border-t border-slate-100 pt-1.5">
            Transmis par <strong className="text-[#002541] font-bold">{alert.createdBy}</strong> • Corridor Yaoundé-Bafoussam
          </div>
        )}
      </div>

      {isOwnAlert ? (
        /* VOLET DE SUIVI D'IMPACT POUR L'AUTEUR DU SIGNALEMENT */
        <div className="w-full bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#002541] flex items-center gap-1.5">
              <span>📡</span>
              <span>SUIVI DE VOTRE SIGNALEMENT</span>
            </span>
            {isFresh ? (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                SIGNALEMENT ACTIF
              </span>
            ) : isExpired ? (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-extrabold uppercase border border-slate-200">
                <span>⚪</span>
                <span>SIGNALEMENT EXPIRÉ &gt; 2 H</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-extrabold uppercase border border-slate-200">
                <span>⚪</span>
                <span>HORODATAGE INDISPONIBLE</span>
              </span>
            )}
          </div>

          {/* Information factuelle pour signalement expiré */}
          {isExpired && (
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed font-medium">
              Cette alerte dépasse la fenêtre de fraîcheur de 2 heures. Elle n’est plus considérée comme prioritaire pour la diffusion sur le trajet.
            </div>
          )}

          {/* Information factuelle pour horodatage inexploitable */}
          {!hasValidTimestamp && (
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed font-medium">
              L'horodatage de cette alerte est indéterminé. Elle n'est plus traitée en diffusion prioritaire.
            </div>
          )}

          {/* Retour des confrères */}
          {peerConfirmations === 0 ? (
            <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-50 border border-amber-200/80">
              <span className="text-xl">⏳</span>
              <div className="flex flex-col min-w-0">
                <span className="font-extrabold text-xs uppercase text-amber-900 tracking-wide">
                  EN ATTENTE DE VALIDATION
                </span>
                <span className="text-[11px] text-amber-800 font-medium mt-0.5">
                  En attente de passage d'un premier confrère
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-emerald-50 border border-emerald-200/80">
              <span className="text-xl">✓</span>
              <div className="flex flex-col min-w-0">
                <span className="font-extrabold text-xs uppercase text-emerald-900 tracking-wide">
                  VALIDÉ PAR LA COMMUNAUTÉ
                </span>
                <span className="text-[11px] text-emerald-800 font-medium mt-0.5">
                  Validé par {peerConfirmations} confrère{peerConfirmations > 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}

          {/* Informations opérationnelles et horodatage */}
          <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
            <div className="flex flex-col p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Secteur couvert</span>
              <span className="font-bold text-[#002541] truncate mt-0.5">
                {typeof (alert as any).estimatedPk === 'number' ? `PK ${(alert as any).estimatedPk} • ` : ''}
                {alert.location || alert.sector || 'Corridor N4'}
              </span>
            </div>
            <div className="flex flex-col p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Transmission</span>
              <span className="font-bold text-[#002541] truncate mt-0.5">
                {alert.timeAgo ? (alert.timeAgo.toLowerCase().startsWith('il y a') ? alert.timeAgo : `Il y a ${alert.timeAgo}`) : 'Récemment'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* VUE STANDARD DESTINÉE AUX CONFRÈRES */
        <>
          {/* Community Confirmation status (Total confirmations enregistrées dans le prototype) */}
          <div className="flex items-center justify-center gap-2 text-sm font-black text-[#2e7d32]">
            <Check className="w-5 h-5 stroke-[3]" />
            <span>Confirmée par {alert.confirmationsCount} chauffeurs</span>
          </div>

          {isFresh ? (
            /* ACTION BUTTONS (Pour alerte dans la fenêtre de fraîcheur) */
            <div className="flex flex-col gap-3 pt-2">
              {/* Large Green Confirmation Button */}
              <button
                onClick={handleConfirm}
                disabled={isConfirmed}
                type="button"
                className={`w-full min-h-[62px] rounded-2xl font-black text-[16px] uppercase tracking-wide flex items-center justify-center gap-2.5 shadow-lg transition-all ${
                  isConfirmed
                    ? 'bg-[#20632a] text-white opacity-95 cursor-default border-2 border-emerald-400'
                    : 'bg-[#2e7d32] hover:bg-emerald-700 active:scale-95 text-white'
                }`}
                aria-label={isConfirmed ? "Vous avez confirmé cette alerte" : "Confirmer l'alerte"}
              >
                <Check className="w-6 h-6 stroke-[3]" />
                <span>
                  {isConfirmed 
                    ? '✓ VOUS AVEZ CONFIRMÉ CETTE ALERTE' 
                    : '✓ CONFIRMER L’ALERTE'}
                </span>
              </button>

              {/* Secondary Report Incorrect */}
              <button
                onClick={handleReportIncorrect}
                disabled={hasReportedIncorrect}
                type="button"
                className="w-full min-h-[50px] bg-white hover:bg-slate-50 border-2 border-slate-200 text-[#5a6573] rounded-2xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs"
                aria-label="Signaler une information incorrecte"
              >
                <AlertTriangle className="w-4 h-4 text-[#f28c28]" />
                <span>
                  {hasReportedIncorrect 
                    ? 'Signalement incorrect transmis' 
                    : 'Signaler une information incorrecte'}
                </span>
              </button>
            </div>
          ) : isExpired ? (
            /* CARTOUCHE NON INTERACTIF POUR ALERTE EXPIRÉE */
            <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200 flex flex-col items-center text-center gap-2 pt-3">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wide text-slate-700">
                <span>⚪</span>
                <span>ALERTE EXPIRÉE &gt; 2 H</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Cette alerte dépasse la fenêtre de fraîcheur de 2 heures. Aucune confirmation supplémentaire n’est requise.
              </p>
            </div>
          ) : (
            /* CARTOUCHE NON INTERACTIF POUR HORODATAGE INEXPLOITABLE */
            <div className="w-full bg-slate-50 rounded-2xl p-4 border border-slate-200 flex flex-col items-center text-center gap-2 pt-3">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wide text-slate-700">
                <span>⚪</span>
                <span>HORODATAGE INDISPONIBLE</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                L'horodatage de cette alerte est indéterminé. Aucune confirmation supplémentaire ne peut être enregistrée.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

