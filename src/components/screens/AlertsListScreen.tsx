import React, { useState } from 'react';
import { AlertItem } from '../../types/routeguard';
import { voiceService } from '../../services/voiceService';
import { Play, Pause } from 'lucide-react';

interface AlertsListScreenProps {
  alerts: AlertItem[];
  onSelectAlert: (alert: AlertItem) => void;
  isAudioMuted: boolean;
}

export const AlertsListScreen: React.FC<AlertsListScreenProps> = ({
  alerts,
  onSelectAlert,
  isAudioMuted,
}) => {
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'CRITIQUE' | 'PRUDENCE'>('ALL');
  const [playingAlertId, setPlayingAlertId] = useState<string | null>(null);

  // Filter alerts
  const filteredAlerts = alerts.filter((alert) => {
    if (activeFilter === 'CRITIQUE') return alert.severity === 'CRITIQUE';
    if (activeFilter === 'PRUDENCE') return alert.severity === 'PRUDENCE' || alert.severity === 'INFO';
    return true;
  });

  const critiqueCount = alerts.filter(a => a.severity === 'CRITIQUE').length;
  const prudenceCount = alerts.filter(a => a.severity === 'PRUDENCE' || a.severity === 'INFO').length;

  const handleTogglePlayAudio = (e: React.MouseEvent, alert: AlertItem) => {
    e.stopPropagation();

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

    voiceService.speakText(
      alert.audioTranscript,
      () => setPlayingAlertId(null),
      () => setPlayingAlertId(null)
    );
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
              {alerts.length} événements signalés
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-1 bg-white px-2.5 py-1.5 rounded-lg shadow-xs text-xs font-bold text-[#002541]">
          <span className="material-symbols-outlined text-[16px]">volume_up</span>
          <span>Audio radio actif</span>
        </div>
      </div>

      {/* FILTER CHIPS */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveFilter('ALL')}
          className={`h-11 px-4 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all shrink-0 ${
            activeFilter === 'ALL'
              ? 'bg-[#002541] text-white shadow-sm'
              : 'bg-white text-[#5a6573] border border-slate-200'
          }`}
          type="button"
        >
          <span>Toutes ({alerts.length})</span>
        </button>

        <button
          onClick={() => setActiveFilter('CRITIQUE')}
          className={`h-11 px-4 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all shrink-0 ${
            activeFilter === 'CRITIQUE'
              ? 'bg-[#d92d20] text-white shadow-sm'
              : 'bg-white text-[#5a6573] border border-slate-200'
          }`}
          type="button"
        >
          <span className="w-2 h-2 rounded-full bg-[#d92d20]"></span>
          <span>Critique ({critiqueCount})</span>
        </button>

        <button
          onClick={() => setActiveFilter('PRUDENCE')}
          className={`h-11 px-4 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all shrink-0 ${
            activeFilter === 'PRUDENCE'
              ? 'bg-[#f28c28] text-white shadow-sm'
              : 'bg-white text-[#5a6573] border border-slate-200'
          }`}
          type="button"
        >
          <span className="w-2 h-2 rounded-full bg-[#f28c28]"></span>
          <span>Prudence ({prudenceCount})</span>
        </button>
      </div>

      {/* ALERTS CARDS LIST */}
      <div className="flex flex-col space-y-3.5">
        {filteredAlerts.map((alert) => {
          const isPlaying = playingAlertId === alert.id;
          return (
            <article
              key={alert.id}
              onClick={() => onSelectAlert(alert)}
              className={`relative bg-white rounded-2xl shadow-sm border p-4 flex flex-col gap-3 transition-all cursor-pointer active:bg-slate-50 ${getSeverityBorder(alert.severity)}`}
            >
              {/* Header: Title & Time */}
              <div className="flex items-center justify-between">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-black text-xs uppercase tracking-wide ${getBadgeColor(alert.severity)}`}>
                  <span className="text-base">{getAlertIcon(alert.type)}</span>
                  <span>{alert.title}</span>
                </div>
                <span className="text-xs text-[#5a6573] font-medium">{alert.timeAgo}</span>
              </div>

              {/* Distance & Direction */}
              <div className="flex items-baseline justify-between pt-0.5">
                <div>
                  <div className={`text-[24px] font-black tracking-tight leading-tight ${
                    alert.severity === 'CRITIQUE' ? 'text-[#d92d20]' : 'text-[#002541]'
                  }`}>
                    {alert.distanceText}
                  </div>
                  <div className="text-xs text-[#5a6573] font-medium">
                    {alert.sector}
                  </div>
                </div>

                <div className="inline-flex items-center gap-1 bg-[#f1f5f9] px-2.5 py-1 rounded-md text-xs font-bold text-[#002541]">
                  <span>{alert.direction}</span>
                </div>
              </div>

              {/* Community Confirmation */}
              <div className="flex items-center gap-1.5 text-xs text-[#2e7d32] font-bold">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>Confirmée par {alert.confirmationsCount} chauffeurs</span>
              </div>

              {/* TACTILE AUDIO PLAY BUTTON */}
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
                    {isPlaying ? "En cours d'écoute..." : "Écouter l'alerte"}
                  </span>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                  isPlaying ? 'bg-white/20 text-white' : 'bg-white text-[#002541]'
                }`}>
                  {alert.audioDuration}
                </span>
              </button>
            </article>
          );
        })}
      </div>

      {/* Radar corridor footer note */}
      <div className="p-3 bg-[#e4effd] rounded-xl flex items-center justify-between text-xs text-[#002541]">
        <div className="flex items-center space-x-2">
          <span className="material-symbols-outlined text-[20px]">security</span>
          <span className="font-semibold">Veille radar axe Yaoundé–Bafoussam</span>
        </div>
        <span className="font-black text-[11px] uppercase text-[#002541]">100% À JOUR</span>
      </div>
    </div>
  );
};
