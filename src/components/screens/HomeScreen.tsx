import React, { useState, useEffect } from 'react';
import { AlertItem, CorridorDirection } from '../../types/routeguard';
import { voiceService } from '../../services/voiceService';
import { locationService } from '../../services/locationService';
import { corridorService, CorridorPositionResult } from '../../services/corridorService';
import { Volume2, VolumeX } from 'lucide-react';

interface HomeScreenProps {
  alerts: AlertItem[];
  onStartReport: () => void;
  onViewAlertDetail: (alert: AlertItem) => void;
  onViewAllAlerts: () => void;
  isAudioMuted: boolean;
  activeDriver?: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  alerts,
  onStartReport,
  onViewAlertDetail,
  onViewAllAlerts,
  isAudioMuted,
  activeDriver = 'Chauffeur A (Jean)',
}) => {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const primaryAlert = alerts[0] || null;
  const secondaryAlertsCount = Math.max(0, alerts.length - 1);
  const secondaryAlert = alerts[1] || null;
  const driverDisplayName = activeDriver.includes('Jean') || activeDriver.includes('A') ? 'Jean' : 'Paul';

  // État local du sens de circulation du chauffeur (mémorisé dans localStorage)
  const [direction, setDirection] = useState<CorridorDirection>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('routeguard.direction');
      if (saved === 'YAOUNDE_TO_BAFOUSSAM' || saved === 'BAFOUSSAM_TO_YAOUNDE') {
        return saved;
      }
    }
    return 'YAOUNDE_TO_BAFOUSSAM';
  });

  const handleSelectDirection = (newDirection: CorridorDirection) => {
    setDirection(newDirection);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('routeguard.direction', newDirection);
      } catch (err) {
        console.warn('[HomeScreen] Erreur sauvegarde localStorage direction :', err);
      }
    }
  };

  // État local de la position ponctuelle sur le corridor (en mémoire vive uniquement)
  const [corridorPosition, setCorridorPosition] = useState<CorridorPositionResult | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(true);
  const [locationFailed, setLocationFailed] = useState<boolean>(false);

  // Lecture GPS ponctuelle UNIQUE au chargement de l'écran (zéro suivi continu, zéro watchPosition)
  useEffect(() => {
    let isMounted = true;

    const fetchSingleLocation = async () => {
      try {
        setIsLocating(true);
        // Lecture ponctuelle non-bloquante avec timeout de 5s
        const coords = await locationService.getCurrentLocation(5000);
        if (!isMounted) return;

        if (coords) {
          const result = corridorService.getCorridorPosition(coords.latitude, coords.longitude);
          setCorridorPosition(result);
          setLocationFailed(false);
        } else {
          setCorridorPosition(null);
          setLocationFailed(true);
        }
      } catch (err) {
        if (!isMounted) return;
        console.warn('[HomeScreen] Erreur capture GPS ponctuelle :', err);
        setCorridorPosition(null);
        setLocationFailed(true);
      } finally {
        if (isMounted) {
          setIsLocating(false);
        }
      }
    };

    fetchSingleLocation();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleListenAlert = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!primaryAlert) return;

    if (isPlayingAudio) {
      voiceService.stopSpeaking();
      setIsPlayingAudio(false);
      return;
    }

    voiceService.playRadioBeep('alert');
    setIsPlayingAudio(true);

    if (isAudioMuted) {
      // Just simulate duration
      setTimeout(() => setIsPlayingAudio(false), 4000);
      return;
    }

    voiceService.speakText(
      primaryAlert.audioTranscript,
      () => setIsPlayingAudio(false),
      () => setIsPlayingAudio(false)
    );
  };

  return (
    <div className="flex flex-col w-full pb-8 pt-2 px-4 gap-4 max-w-[420px] mx-auto select-none">
      {/* 1. Driver status header */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-[19px] text-[#002541]">Bonjour {driverDisplayName}</span>
            <span className="material-symbols-outlined text-[#fc9430] text-[18px]">verified</span>
          </div>
          <div className="flex items-center gap-1 text-[12px] text-[#42474e] font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#fc9430] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#fc9430]"></span>
            </span>
            <span>Mode conduite actif • {locationFailed ? 'GPS indisponible' : isLocating ? 'Recherche GPS...' : 'GPS connecté'}</span>
          </div>
        </div>

        <div className="w-10 h-10 rounded-xl bg-[#e4effd] flex items-center justify-center shrink-0 text-[#002541]">
          <span className="material-symbols-outlined text-[22px]">directions_bus</span>
        </div>
      </div>

      {/* 2. Corridor context card */}
      <div className="w-full bg-[#123b5d] text-white rounded-2xl px-4 py-3 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider text-[#a6caf3]">
            <span className="material-symbols-outlined text-[13px]">alt_route</span> Corridor N4
          </span>
          <div className="flex items-center gap-1.5 text-white/80 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>En direct</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-black text-[18px] tracking-tight text-white">
            <span>{direction === 'YAOUNDE_TO_BAFOUSSAM' ? 'Yaoundé' : 'Bafoussam'}</span>
            <span className="text-[#a6caf3]">→</span>
            <span>{direction === 'YAOUNDE_TO_BAFOUSSAM' ? 'Bafoussam' : 'Yaoundé'}</span>
          </div>
          <div className="flex items-center gap-1 bg-black/30 px-2 py-0.5 rounded font-mono text-[12px] font-bold text-white">
            <span className="material-symbols-outlined text-[14px]">speed</span>
            <span>82 km/h</span>
          </div>
        </div>

        {/* Sélecteur de sens du trajet (local au téléphone) */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-[#a6caf3]">
            <span>Sens de votre trajet</span>
            <span className="text-[10px] text-white/60 font-semibold lowercase">sélectionnez votre direction</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSelectDirection('YAOUNDE_TO_BAFOUSSAM')}
              className={`py-3 px-2 rounded-xl font-black text-[12px] flex items-center justify-center gap-1 transition-all active:scale-95 border cursor-pointer ${
                direction === 'YAOUNDE_TO_BAFOUSSAM'
                  ? 'bg-amber-400 text-[#002541] border-amber-300 shadow-sm ring-2 ring-white/50'
                  : 'bg-black/25 text-white/70 border-white/10 hover:text-white hover:bg-black/35'
              }`}
            >
              <span>→ YAOUNDÉ</span>
              <span className="text-[10px] font-semibold opacity-75">vers</span>
              <span>BAFOUSSAM</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectDirection('BAFOUSSAM_TO_YAOUNDE')}
              className={`py-3 px-2 rounded-xl font-black text-[12px] flex items-center justify-center gap-1 transition-all active:scale-95 border cursor-pointer ${
                direction === 'BAFOUSSAM_TO_YAOUNDE'
                  ? 'bg-amber-400 text-[#002541] border-amber-300 shadow-sm ring-2 ring-white/50'
                  : 'bg-black/25 text-white/70 border-white/10 hover:text-white hover:bg-black/35'
              }`}
            >
              <span>← BAFOUSSAM</span>
              <span className="text-[10px] font-semibold opacity-75">vers</span>
              <span>YAOUNDÉ</span>
            </button>
          </div>
        </div>

        <div className="flex items-center text-[12px] text-white/85">
          <span className="material-symbols-outlined text-[15px] mr-1 text-[#a6caf3]">near_me</span>
          <span>Prochain arrêt : <strong className="text-white font-semibold">Bafia</strong> dans <strong className="text-amber-300 font-bold">34 km</strong></span>
        </div>

        {/* Position ponctuelle estimée sur le corridor N4 (locale en mémoire, non bloquante) */}
        <div className="flex items-center justify-between text-[11px] pt-2 border-t border-white/10 text-white/90">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="text-[13px]">📍</span>
            {isLocating ? (
              <span className="text-white/70 italic">Localisation en cours...</span>
            ) : corridorPosition && corridorPosition.isValid ? (
              corridorPosition.isOnCorridor ? (
                <span>
                  Position : <strong className="text-white font-bold">{corridorPosition.nearestMarkerName || 'Axe N4'}</strong>{' '}
                  <span className="text-[#a6caf3] font-semibold">(PK ≈ {corridorPosition.estimatedPk})</span>
                </span>
              ) : (
                <span className="text-amber-200">
                  Position : <strong className="font-bold">Hors corridor N4</strong>
                </span>
              )
            ) : (
              <span className="text-white/60">Position GPS indisponible</span>
            )}
          </div>
          {corridorPosition?.isOnCorridor && corridorPosition.estimatedPk !== null && (
            <span className="bg-white/15 px-2 py-0.5 rounded text-[10px] font-mono text-emerald-300 font-bold">
              PK {corridorPosition.estimatedPk}
            </span>
          )}
        </div>
      </div>

      {/* 3. PRIMARY IMMINENT DANGER CARD */}
      {primaryAlert ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[12px] text-[#002541] uppercase tracking-wider font-black flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[17px] text-[#d92d20]">warning</span>
              DANGER SUR VOTRE TRAJET
            </span>
            <span className="bg-[#d92d20] text-white text-[11px] font-black tracking-wide uppercase px-2 py-0.5 rounded flex items-center gap-1 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
              URGENT
            </span>
          </div>

          <div 
            onClick={() => onViewAlertDetail(primaryAlert)}
            className="w-full bg-white rounded-2xl shadow-md border-2 border-[#d92d20] p-4 flex flex-col gap-3.5 cursor-pointer active:bg-slate-50 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 bg-[#d92d20] text-white font-black text-[14px] px-3 py-1 rounded-lg tracking-wider uppercase shadow-xs">
                <span className="material-symbols-outlined text-[18px]">car_crash</span>
                {primaryAlert.badgeText}
              </div>
              <span className="text-[12px] text-[#42474e] font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-[#d92d20]">near_me</span>
                En approche
              </span>
            </div>

            {/* Distance & Sector */}
            <div className="flex flex-col">
              <div className="text-[36px] font-black text-[#d92d20] leading-none tracking-tight">
                {primaryAlert.distanceText || '8 km devant vous'}
              </div>
              <div className="flex items-center gap-1 text-[#42474e] text-[13px] font-semibold mt-1.5">
                <span className="material-symbols-outlined text-[16px] text-[#002541]">alt_route</span>
                <span>Direction : <strong className="text-[#002541] font-bold">{primaryAlert.sector} {primaryAlert.direction}</strong></span>
              </div>
            </div>

            {/* Big Prominent Audio Button: ÉCOUTER L'ALERTE */}
            <button
              type="button"
              onClick={handleListenAlert}
              className={`w-full min-h-[58px] rounded-xl px-4 py-2.5 flex items-center justify-between transition-all shadow-sm ${
                isPlayingAudio 
                  ? 'bg-[#d92d20] text-white ring-4 ring-red-200' 
                  : 'bg-red-50 hover:bg-red-100 active:scale-[0.98] border-2 border-red-200 text-[#121c26]'
              }`}
              aria-label="Écouter l'alerte"
            >
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-transform ${
                  isPlayingAudio ? 'bg-white text-[#d92d20] animate-pulse' : 'bg-[#d92d20] text-white'
                }`}>
                  <span className="material-symbols-outlined text-[26px]">
                    {isPlayingAudio ? 'pause' : 'play_arrow'}
                  </span>
                </div>
                <div className="flex flex-col text-left">
                  <span className={`text-[15px] font-black uppercase tracking-wide flex items-center gap-1 ${
                    isPlayingAudio ? 'text-white' : 'text-[#121c26]'
                  }`}>
                    {isPlayingAudio ? "LECTURE DE L'ALERTE..." : "ÉCOUTER L'ALERTE"}
                  </span>
                  <span className={`text-[11px] font-bold flex items-center gap-1 ${
                    isPlayingAudio ? 'text-red-100' : 'text-[#d92d20]'
                  }`}>
                    <span className="material-symbols-outlined text-[14px]">graphic_eq</span>
                    Message vocal radio
                  </span>
                </div>
              </div>

              <span className={`text-[12px] font-black px-2.5 py-0.5 rounded-full border ${
                isPlayingAudio 
                  ? 'bg-white text-[#d92d20] border-transparent' 
                  : 'bg-white text-[#d92d20] border-red-200'
              }`}>
                {primaryAlert.audioDuration || '0:24'}
              </span>
            </button>

            {/* Confirmation social proof */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[12px]">
              <div className="flex items-center gap-1 text-[#2e7d32] font-extrabold">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>Confirmée par {primaryAlert.confirmationsCount} chauffeurs</span>
              </div>
              <span className="text-[#73777f] font-medium">{primaryAlert.timeAgo}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full bg-white rounded-2xl p-6 text-center shadow-sm border border-emerald-200">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-[#2e7d32] flex items-center justify-center mx-auto mb-2">
            <span className="material-symbols-outlined text-[28px]">check_circle</span>
          </div>
          <h3 className="font-extrabold text-[17px] text-[#002541]">Voie dégagée pour l’instant</h3>
          <p className="text-xs text-[#5a6573] mt-1">Aucun danger critique signalé sur les 30 prochains kilomètres.</p>
        </div>
      )}

      {/* 4. Secondary alerts link banner */}
      {secondaryAlert && (
        <div 
          onClick={onViewAllAlerts}
          className="w-full bg-white rounded-xl px-3.5 py-2.5 border border-[#dfe9f7] shadow-xs flex items-center justify-between cursor-pointer active:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#914d00] text-[20px]">traffic</span>
            <span className="text-[13px] text-[#121c26] font-medium">
              <strong className="text-[#914d00] font-bold">{secondaryAlertsCount} autre{secondaryAlertsCount > 1 ? 's' : ''} alerte{secondaryAlertsCount > 1 ? 's' : ''} :</strong> {secondaryAlert.title}
            </span>
          </div>
          <span className="text-[#914d00] text-[12px] font-extrabold flex items-center">
            Voir <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </span>
        </div>
      )}

      {/* 5. MAIN ACTION BUTTON: 🎙️ SIGNALER UN ÉVÉNEMENT */}
      <div className="pt-1">
        <button
          type="button"
          onClick={onStartReport}
          className="w-full min-h-[64px] bg-[#f28c28] hover:bg-[#e06a00] active:scale-[0.98] text-white rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg transition-all border border-orange-400"
          aria-label="Signaler un événement"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0 shadow-inner">
              <span className="material-symbols-outlined text-[26px] text-white">mic</span>
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[16px] text-white font-black uppercase tracking-wide">
                SIGNALER UN ÉVÉNEMENT
              </span>
              <span className="text-[12px] text-white/90 font-medium">
                Appui pour dicter vocalement par l'IA
              </span>
            </div>
          </div>
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px] text-white">chevron_right</span>
          </div>
        </button>
      </div>

      {/* Audio guide badge */}
      <div className="p-3 bg-[#e4effd] rounded-xl flex items-center justify-between text-xs text-[#002541]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">campaign</span>
          <span className="font-semibold">Alerte vocale radio active sur l’axe N4</span>
        </div>
        <span className="font-bold uppercase tracking-wider text-[10px] bg-white px-2 py-0.5 rounded">100% SÉCURISÉ</span>
      </div>
    </div>
  );
};
