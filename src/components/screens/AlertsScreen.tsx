import React, { useState, useEffect } from 'react';
import { AlertItem, CorridorDirection } from '../../types/routeguard';
import { getRelevantAlertsForDriver } from '../../services/alertService';
import { locationService, LocationCoordinates } from '../../services/locationService';
import { RelevantAlertItem } from '../../services/corridorService';
import { voiceService } from '../../services/voiceService';
import { Play, Pause } from 'lucide-react';

export interface AlertsScreenProps {
  onSelectAlert?: (alert: AlertItem) => void;
  isAudioMuted?: boolean;
  /** Pour injection optionnelle en tests ou débogage */
  overrideCoordinates?: LocationCoordinates | null;
  overrideDirection?: CorridorDirection;
  overrideNow?: number | string | Date;
}

/**
 * Fonction autonome appelant la capture ponctuelle du service de géolocalisation
 */
const getCurrentLocation = (timeoutMs?: number): Promise<LocationCoordinates | null> => {
  return locationService.getCurrentLocation(timeoutMs);
};

/**
 * Récupère le sens de circulation mémorisé pour le chauffeur
 */
const getStoredDirection = (): CorridorDirection => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = localStorage.getItem('routeguard.direction');
      if (saved === 'YAOUNDE_TO_BAFOUSSAM' || saved === 'BAFOUSSAM_TO_YAOUNDE') {
        return saved as CorridorDirection;
      }
    } catch {}
  }
  return 'YAOUNDE_TO_BAFOUSSAM';
};

type ScreenStatus =
  | 'LOCATING'
  | 'LOADING_ALERTS'
  | 'GPS_UNAVAILABLE'
  | 'OFF_CORRIDOR'
  | 'EMPTY'
  | 'ERROR'
  | 'READY';

export const AlertsScreen: React.FC<AlertsScreenProps> = ({
  onSelectAlert,
  isAudioMuted = false,
  overrideCoordinates,
  overrideDirection,
  overrideNow,
}) => {
  const [status, setStatus] = useState<ScreenStatus>('LOCATING');
  const [direction, setDirection] = useState<CorridorDirection>(getStoredDirection);
  const [relevantAlertItems, setRelevantAlertItems] = useState<RelevantAlertItem<AlertItem>[]>([]);
  const [playingAlertId, setPlayingAlertId] = useState<string | null>(null);

  // Capture ponctuelle unique lors du montage (aucun suivi continu, aucun polling, aucun tracking)
  useEffect(() => {
    let isMounted = true;

    const loadAlerts = async () => {
      // ÉTAT 1 : Localisation en cours
      setStatus('LOCATING');

      try {
        // 1. Obtenir la position GPS ponctuelle (un seul appel lors du montage)
        const coords = overrideCoordinates !== undefined
          ? overrideCoordinates
          : await getCurrentLocation();

        if (!isMounted) return;

        // ÉTAT 2 : Si GPS refusé ou indisponible -> état explicite sans inventer de coordonnées
        if (
          !coords ||
          typeof coords.latitude !== 'number' ||
          typeof coords.longitude !== 'number' ||
          isNaN(coords.latitude) ||
          isNaN(coords.longitude)
        ) {
          setStatus('GPS_UNAVAILABLE');
          return;
        }

        // 2. Déterminer la direction mémorisée
        const currentDirection = overrideDirection || getStoredDirection();
        setDirection(currentDirection);

        // ÉTAT 4 : Recherche des alertes sur le trajet
        setStatus('LOADING_ALERTS');

        // 3. Charger et filtrer les alertes pertinentes via getRelevantAlertsForDriver()
        const result = await getRelevantAlertsForDriver(
          coords.latitude,
          coords.longitude,
          currentDirection,
          overrideNow || Date.now()
        );

        if (!isMounted) return;

        // ÉTAT 3 : Chauffeur hors corridor
        if (!result.isDriverOnCorridor) {
          setStatus('OFF_CORRIDOR');
          return;
        }

        // ÉTAT 5 : Aucune alerte pertinente
        if (!result.relevantAlerts || result.relevantAlerts.length === 0) {
          setRelevantAlertItems([]);
          setStatus('EMPTY');
          return;
        }

        // ÉTAT 6 / PRÊT : Alertes pertinentes disponibles (relevantAlerts uniquement)
        setRelevantAlertItems(result.relevantAlerts);
        setStatus('READY');
      } catch (err: any) {
        if (!isMounted) return;
        console.error('[AlertsScreen] Erreur de récupération des alertes :', err);
        // ÉTAT 6 : Erreur réseau / Firestore
        setStatus('ERROR');
      }
    };

    loadAlerts();

    return () => {
      isMounted = false;
    };
  }, [overrideCoordinates, overrideDirection, overrideNow]);

  const handleTogglePlayAudio = (e: React.MouseEvent, alert: AlertItem) => {
    e.stopPropagation();

    if (!alert.audioTranscript && !alert.audioUrl) {
      return; // Ne pas prétendre jouer un audio inexistant
    }

    if (playingAlertId === alert.id) {
      voiceService.stopSpeaking();
      setPlayingAlertId(null);
      return;
    }

    voiceService.playRadioBeep('alert');
    setPlayingAlertId(alert.id);

    if (isAudioMuted) {
      setTimeout(() => setPlayingAlertId(null), 3500);
      return;
    }

    if (alert.audioTranscript) {
      voiceService.speakText(
        alert.audioTranscript,
        () => setPlayingAlertId(null),
        () => setPlayingAlertId(null)
      );
    } else {
      setTimeout(() => setPlayingAlertId(null), 3000);
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'ACCIDENT':
        return '🚨';
      case 'VEHICULE_IMMOBILISE':
        return '🚧';
      case 'FORTE_PLUIE':
        return '🌧️';
      case 'OBSTACLE':
        return '⚠️';
      default:
        return '🚦';
    }
  };

  const getSeverityBorder = (severity: string) => {
    if (severity === 'CRITIQUE') return 'border-l-4 border-l-[#d92d20] border-red-100';
    if (severity === 'PRUDENCE') return 'border-l-4 border-l-[#f28c28] border-orange-100';
    return 'border-l-4 border-l-[#123b5d] border-blue-100';
  };

  const getBadgeColor = (severity: string) => {
    if (severity === 'CRITIQUE') return 'text-[#d92d20] bg-red-50';
    if (severity === 'PRUDENCE') return 'text-[#914d00] bg-amber-50';
    return 'text-[#123b5d] bg-blue-50';
  };

  const formatDistance = (distKm: number): string => {
    if (distKm <= 0.5) {
      return "Sur le lieu de l'alerte";
    }
    return `${Math.round(distKm)} km devant vous`;
  };

  // 1. ÉTAT CHARGEMENT GPS
  if (status === 'LOCATING') {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center min-h-[360px] max-w-[420px] mx-auto select-none">
        <div className="text-3xl mb-3 animate-bounce">📍</div>
        <div className="w-10 h-10 border-4 border-[#002541] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-bold text-[#002541]">
          📍 Localisation en cours...
        </p>
      </div>
    );
  }

  // 2. ÉTAT CHARGEMENT DES ALERTES
  if (status === 'LOADING_ALERTS') {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center min-h-[360px] max-w-[420px] mx-auto select-none">
        <div className="w-10 h-10 border-4 border-[#002541] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-bold text-[#002541]">
          Recherche des alertes sur votre trajet...
        </p>
      </div>
    );
  }

  // 3. ÉTAT GPS INDISPONIBLE
  if (status === 'GPS_UNAVAILABLE') {
    return (
      <div className="flex flex-col w-full pb-8 pt-4 px-4 gap-4 max-w-[420px] mx-auto select-none">
        <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-4xl mb-3">📍</div>
          <h2 className="text-base font-black text-[#002541] mb-1">
            📍 Position GPS indisponible
          </h2>
          <p className="text-xs text-[#5a6573] max-w-xs">
            Activez la géolocalisation pour identifier les alertes pertinentes sur votre trajet.
          </p>
        </div>
      </div>
    );
  }

  // 4. ÉTAT HORS CORRIDOR
  if (status === 'OFF_CORRIDOR') {
    const corridorName = direction === 'BAFOUSSAM_TO_YAOUNDE'
      ? 'Bafoussam → Yaoundé'
      : 'Yaoundé → Bafoussam';
    return (
      <div className="flex flex-col w-full pb-8 pt-4 px-4 gap-4 max-w-[420px] mx-auto select-none">
        <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-2xl border border-amber-200 shadow-xs">
          <div className="text-4xl mb-3">📍</div>
          <h2 className="text-base font-black text-[#914d00] mb-1">
            📍 Vous êtes hors du corridor
          </h2>
          <p className="text-xs font-semibold text-[#002541] mt-1 mb-1">
            Axe surveillé : {corridorName}
          </p>
          <p className="text-xs text-[#5a6573] max-w-xs">
            La veille active ne surveille que les axes du corridor N4.
          </p>
        </div>
      </div>
    );
  }

  // 5. ÉTAT ERREUR RÉSEAU / FIRESTORE
  if (status === 'ERROR') {
    return (
      <div className="flex flex-col w-full pb-8 pt-4 px-4 gap-4 max-w-[420px] mx-auto select-none">
        <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-2xl border border-red-200 shadow-xs">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-base font-black text-[#d92d20] mb-1">
            ⚠️ Impossible de récupérer les alertes
          </h2>
          <p className="text-xs text-[#5a6573] max-w-xs">
            Vérifiez votre connexion Internet.
          </p>
        </div>
      </div>
    );
  }

  // 6. ÉTAT AUCUNE ALERTE PERTINENTE
  if (status === 'EMPTY' || relevantAlertItems.length === 0) {
    return (
      <div className="flex flex-col w-full pb-8 pt-4 px-4 gap-4 max-w-[420px] mx-auto select-none">
        {/* En-tête HUD simple */}
        <div className="w-full bg-[#dfe9f7] rounded-xl p-3 shadow-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="material-symbols-outlined text-[18px] text-[#002541]">radar</span>
            <span className="text-[12px] font-black uppercase tracking-wider text-[#002541]">
              Axe N4 • {direction === 'BAFOUSSAM_TO_YAOUNDE' ? 'Bafoussam → Yaoundé' : 'Yaoundé → Bafoussam'}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-2xl border border-emerald-200 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-[#2e7d32] flex items-center justify-center text-2xl font-black mb-3">
            ✓
          </div>
          <h2 className="text-base font-black text-[#2e7d32] mb-1">
            ✓ Aucune alerte pertinente
          </h2>
          <p className="text-xs text-[#5a6573] max-w-xs">
            Votre trajet semble dégagé pour le moment.
          </p>
        </div>
      </div>
    );
  }

  // 7. LISTE DES ALERTES PERTINENTES (UNIQUEMENT relevantAlerts)
  return (
    <div className="flex flex-col w-full pb-8 pt-2 px-4 gap-4 max-w-[420px] mx-auto select-none">
      {/* Corridor HUD Header */}
      <div className="w-full bg-[#dfe9f7] rounded-xl p-3 shadow-xs flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#f28c28] animate-ping"></div>
          <div className="flex flex-col">
            <span className="text-[12px] font-black uppercase tracking-wider text-[#002541]">
              AXE N4 ACTIF
            </span>
            <span className="text-xs text-[#5a6573] font-medium">
              {relevantAlertItems.length} alerte{relevantAlertItems.length > 1 ? 's' : ''} sur votre trajet
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-1 bg-white px-2.5 py-1.5 rounded-lg shadow-xs text-xs font-bold text-[#002541]">
          <span className="material-symbols-outlined text-[16px]">volume_up</span>
          <span>Radio active</span>
        </div>
      </div>

      {/* Cartes des alertes pertinentes uniquement */}
      <div className="flex flex-col space-y-3.5">
        {relevantAlertItems.map((item) => {
          const alert = item.alert;
          const isPlaying = playingAlertId === alert.id;
          const hasAudio = Boolean(alert.audioTranscript || alert.audioUrl);

          return (
            <article
              key={alert.id}
              onClick={() => onSelectAlert?.(alert)}
              className={`relative bg-white rounded-2xl shadow-sm border p-4 flex flex-col gap-3 transition-all cursor-pointer active:bg-slate-50 ${getSeverityBorder(alert.severity)}`}
            >
              {/* Type d'alerte et horodatage */}
              <div className="flex items-center justify-between">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-black text-xs uppercase tracking-wide ${getBadgeColor(alert.severity)}`}>
                  <span className="text-base">{getAlertIcon(alert.type)}</span>
                  <span>{alert.title}</span>
                </div>
                <span className="text-xs text-[#5a6573] font-medium">{alert.timeAgo}</span>
              </div>

              {/* Distance estimée calculée par le moteur et Direction */}
              <div className="flex items-baseline justify-between pt-0.5">
                <div>
                  <div className={`text-[22px] font-black tracking-tight leading-tight ${
                    alert.severity === 'CRITIQUE' ? 'text-[#d92d20]' : 'text-[#002541]'
                  }`}>
                    {formatDistance(item.estimatedDistanceKm)}
                  </div>
                  <div className="text-xs text-[#5a6573] font-medium">
                    {alert.sector || alert.location || 'Secteur N4'}
                  </div>
                </div>

                <div className="inline-flex items-center gap-1 bg-[#f1f5f9] px-2.5 py-1 rounded-md text-xs font-bold text-[#002541]">
                  <span>{alert.direction}</span>
                </div>
              </div>

              {/* Confirmation communautaire */}
              <div className="flex items-center gap-1.5 text-xs text-[#2e7d32] font-bold">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>Confirmée par {alert.confirmationsCount} chauffeurs</span>
              </div>

              {/* Bouton d'écoute audio tactile */}
              {hasAudio && (
                <button
                  type="button"
                  onClick={(e) => handleTogglePlayAudio(e, alert)}
                  className={`w-full min-h-[50px] rounded-xl px-4 py-2 flex items-center justify-between transition-all ${
                    isPlaying
                      ? 'bg-[#002541] text-white ring-2 ring-[#fc9430]'
                      : 'bg-[#edf4ff] hover:bg-[#dfe9f7] text-[#002541] active:scale-[0.99]'
                  }`}
                  aria-label={`Écouter l'alerte ${alert.title}`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isPlaying ? 'bg-white text-[#002541]' : 'bg-[#002541] text-white'
                    }`}>
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </div>
                    <span className="font-extrabold text-xs uppercase tracking-wide">
                      {isPlaying ? "En cours d'écoute..." : "▶ Écouter"}
                    </span>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    isPlaying ? 'bg-white/20 text-white' : 'bg-white text-[#002541]'
                  }`}>
                    {alert.audioDuration || '0:12'}
                  </span>
                </button>
              )}
            </article>
          );
        })}
      </div>

      {/* Radar corridor footer note */}
      <div className="p-3 bg-[#e4effd] rounded-xl flex items-center justify-between text-xs text-[#002541]">
        <div className="flex items-center space-x-2">
          <span className="material-symbols-outlined text-[20px]">security</span>
          <span className="font-semibold">Veille active axe {direction === 'BAFOUSSAM_TO_YAOUNDE' ? 'Bafoussam–Yaoundé' : 'Yaoundé–Bafoussam'}</span>
        </div>
        <span className="font-black text-[11px] uppercase text-[#002541]">100% PERTINENT</span>
      </div>
    </div>
  );
};
