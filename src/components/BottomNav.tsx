import React from 'react';
import { ActiveScreen } from '../types/routeguard';

interface BottomNavProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  unreadCount: number;
  isInCriticalFlow: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeScreen,
  onNavigate,
  unreadCount,
  isInCriticalFlow,
}) => {
  // During critical vocal recording, AI analysis or confirmation, keep navigation disabled / locked
  if (isInCriticalFlow) {
    return (
      <nav className="sticky bottom-0 mt-auto left-0 right-0 z-40 bg-[#f7f9ff]/95 backdrop-blur-md border-t border-[#e4effd] py-2.5 px-4 text-center">
        <div className="max-w-[420px] mx-auto flex items-center justify-center gap-2 text-xs font-bold text-[#914d00]">
          <span className="w-2 h-2 rounded-full bg-[#fc9430] animate-pulse"></span>
          <span>Procédure de signalement vocal en cours...</span>
        </div>
      </nav>
    );
  }

  return (
    <nav className="sticky bottom-0 mt-auto left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-slate-200/80 shadow-[0_-2px_12px_rgba(0,37,65,0.06)] pb-[env(safe-area-inset-bottom,0px)]">
      <div className="max-w-[420px] mx-auto flex items-center justify-around h-16 px-2">
        {/* ACCUEIL */}
        <button
          onClick={() => onNavigate('accueil')}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] transition-colors ${
            activeScreen === 'accueil'
              ? 'text-[#002541] font-bold'
              : 'text-[#5a6573] hover:text-[#002541]'
          }`}
          type="button"
        >
          <span className="material-symbols-outlined text-[24px]">home</span>
          <span className="text-[11px] font-semibold mt-0.5">Accueil</span>
        </button>

        {/* ALERTES */}
        <button
          onClick={() => onNavigate('alertes')}
          className={`relative flex flex-col items-center justify-center min-w-[56px] min-h-[48px] transition-colors ${
            activeScreen === 'alertes' || activeScreen === 'alerte_detail'
              ? 'text-[#002541] font-bold'
              : 'text-[#5a6573] hover:text-[#002541]'
          }`}
          type="button"
        >
          <div className="relative">
            <span className="material-symbols-outlined text-[24px]">warning</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-[#d92d20] text-white text-[10px] font-extrabold px-1.5 py-0.2 rounded-full min-w-[16px] text-center">
                {unreadCount}
              </span>
            )}
          </div>
          <span className="text-[11px] font-semibold mt-0.5">Alertes</span>
        </button>

        {/* SIGNALER - Large tactile orange trigger */}
        <button
          onClick={() => onNavigate('signaler')}
          className="flex flex-col items-center justify-center min-w-[64px] min-h-[56px] -mt-5 group"
          type="button"
          aria-label="Signaler un événement"
        >
          <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 ${
            activeScreen === 'signaler'
              ? 'bg-[#d92d20] text-white ring-4 ring-red-200'
              : 'bg-[#fc9430] text-white hover:bg-[#e06a00]'
          }`}>
            <span className="material-symbols-outlined text-[28px] font-bold">mic</span>
          </div>
          <span className="text-[11px] font-extrabold text-[#914d00] mt-1 uppercase tracking-wider">
            Signaler
          </span>
        </button>

        {/* PROFIL */}
        <button
          onClick={() => onNavigate('profil')}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] transition-colors ${
            activeScreen === 'profil'
              ? 'text-[#002541] font-bold'
              : 'text-[#5a6573] hover:text-[#002541]'
          }`}
          type="button"
        >
          <span className="material-symbols-outlined text-[24px]">account_circle</span>
          <span className="text-[11px] font-semibold mt-0.5">Profil</span>
        </button>
      </div>
    </nav>
  );
};
