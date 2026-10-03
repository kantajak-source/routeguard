import React, { useState, useEffect } from 'react';
import { AlertItem } from '../../types/routeguard';
import { voiceService } from '../../services/voiceService';
import { ArrowLeft, Check, AlertTriangle, Play, Pause } from 'lucide-react';

interface AlertDetailScreenProps {
  alert: AlertItem;
  onBack: () => void;
  onConfirmAlert: (alertId: string) => void;
  isAudioMuted: boolean;
}

export const AlertDetailScreen: React.FC<AlertDetailScreenProps> = ({
  alert,
  onBack,
  onConfirmAlert,
  isAudioMuted,
}) => {
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
  // 4. Empêche toute confirmation ultérieure
  // -------------------------------------------------------------
  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Guard: Prevent second confirmation from the same driver
    if (isConfirmed) return;

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

      {/* Community Confirmation status (Total confirmations enregistrées dans le prototype) */}
      <div className="flex items-center justify-center gap-2 text-sm font-black text-[#2e7d32]">
        <Check className="w-5 h-5 stroke-[3]" />
        <span>Confirmée par {alert.confirmationsCount} chauffeurs</span>
      </div>

      {/* ACTION BUTTONS (Independent) */}
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
    </div>
  );
};
