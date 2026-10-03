import React from 'react';
import { ActiveScreen, AlertItem } from '../types/routeguard';
import { Volume2, VolumeX, Smartphone, Monitor } from 'lucide-react';

interface HeaderProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  alerts: AlertItem[];
  isAudioMuted: boolean;
  onToggleMute: () => void;
  isDeviceFrame: boolean;
  onToggleFrame: () => void;
  isInCriticalFlow: boolean;
  activeDriver?: string;
  onToggleDriver?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeScreen,
  onNavigate,
  alerts,
  isAudioMuted,
  onToggleMute,
  isDeviceFrame,
  onToggleFrame,
  isInCriticalFlow,
  activeDriver = 'Chauffeur A (Jean)',
  onToggleDriver,
}) => {
  const unreadAlertsCount = alerts.length;
  const isDriverA = activeDriver.includes('Jean') || activeDriver.includes('A');

  const getScreenTitle = () => {
    switch (activeScreen) {
      case 'accueil':
        return 'Accueil';
      case 'alertes':
        return 'Alertes de route';
      case 'signaler':
        return 'Signalement vocal';
      case 'alerte_detail':
        return 'Détail de l’alerte';
      case 'profil':
        return 'Profil';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-[#f7f9ff]/95 backdrop-blur-md border-b border-[#e4effd] px-4 py-3 select-none">
      <div className="flex items-center justify-between">
        {/* Brand identity */}
        <div 
          className="flex items-center gap-2.5 cursor-pointer"
          onClick={() => !isInCriticalFlow && onNavigate('accueil')}
        >
          <div className="w-9 h-9 rounded-xl bg-[#002541] flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-sm tracking-wider">RG</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-[15px] tracking-tight text-[#002541]">ROUTEGUARD</span>
              <span className="text-[10px] font-black uppercase tracking-wider bg-[#d0e4ff] text-[#002541] px-1.5 py-0.2 rounded">N4</span>
            </div>
            <span className="text-[11px] font-semibold text-[#42474e] truncate max-w-[150px]">
              {getScreenTitle()}
            </span>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1.5">
          {/* Quick Driver identity switcher for testing Chauffeur A vs Chauffeur B */}
          {!isInCriticalFlow && onToggleDriver && (
            <button
              onClick={onToggleDriver}
              title={`Chauffeur actif : ${activeDriver}. Cliquez pour basculer vers ${isDriverA ? 'Chauffeur B' : 'Chauffeur A'}`}
              className="h-8 px-2 rounded-lg bg-[#e4effd] hover:bg-[#dfe9f7] active:scale-95 text-[#002541] flex items-center gap-1 text-[11px] font-black transition-all border border-blue-200"
              type="button"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{isDriverA ? 'Chauf. A' : 'Chauf. B'}</span>
            </button>
          )}

          {/* Toggle Device frame / Fullscreen */}
          <button
            onClick={onToggleFrame}
            title={isDeviceFrame ? "Afficher en plein écran" : "Afficher en cadre mobile (390×844)"}
            className="w-9 h-9 rounded-xl bg-[#edf4ff] hover:bg-[#dfe9f7] active:scale-95 text-[#002541] flex items-center justify-center transition-all"
            aria-label="Changer de vue"
          >
            {isDeviceFrame ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
          </button>

          {/* Toggle sound mute */}
          <button
            onClick={onToggleMute}
            title={isAudioMuted ? "Activer le son vocal" : "Désactiver le son vocal"}
            className="w-9 h-9 rounded-xl bg-[#edf4ff] hover:bg-[#dfe9f7] active:scale-95 text-[#002541] flex items-center justify-center transition-all"
            aria-label="Contrôle audio"
          >
            {isAudioMuted ? <VolumeX className="w-4 h-4 text-red-600" /> : <Volume2 className="w-4 h-4 text-[#002541]" />}
          </button>

          {/* Notifications / Alert count */}
          {!isInCriticalFlow && (
            <button
              onClick={() => onNavigate('alertes')}
              className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                activeScreen === 'alertes' 
                  ? 'bg-[#002541] text-white shadow-sm' 
                  : 'bg-[#edf4ff] text-[#002541] hover:bg-[#dfe9f7]'
              }`}
              aria-label="Alertes"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              {unreadAlertsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#d92d20] text-white text-[10px] font-extrabold flex items-center justify-center shadow-xs">
                  {unreadAlertsCount}
                </span>
              )}
            </button>
          )}

          {/* Driver profile button */}
          {!isInCriticalFlow && (
            <button
              onClick={() => onNavigate('profil')}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                activeScreen === 'profil' 
                  ? 'bg-[#002541] text-white ring-2 ring-[#002541]/30' 
                  : 'bg-[#002541] text-white hover:opacity-90'
              }`}
              aria-label="Mon profil chauffeur"
            >
              <span className="font-bold text-xs">{isDriverA ? 'J' : 'P'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
