import React, { useState } from 'react';
import { DriverProfile } from '../../types/routeguard';
import { alertService } from '../../services/alertService';
import { Phone, Building, Bus, Route, Bell, Volume2, Wifi, HelpCircle, Info, LogOut, Database, UserCheck, RefreshCw } from 'lucide-react';

interface ProfileScreenProps {
  onLogout?: () => void;
  activeDriver?: string;
  onToggleDriver?: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  activeDriver = 'Chauffeur A (Jean)',
  onToggleDriver,
}) => {
  const isDriverA = activeDriver.includes('Jean') || activeDriver.includes('A');

  const [profile, setProfile] = useState<DriverProfile>({
    name: isDriverA ? 'Jean' : 'Paul',
    phone: isDriverA ? '+237 671 234 567' : '+237 699 876 543',
    role: 'PRO',
    company: isDriverA ? 'Touristique Express' : 'Buca Voyages',
    vehicleType: isDriverA ? 'Bus 70 places (VIP)' : 'Bus 54 places (Confort)',
    corridor: 'Yaoundé → Bafoussam (Axe National N4)',
    notificationsEnabled: true,
    autoAudioEnabled: true,
    dataSaverEnabled: true,
  });

  const [showToast, setShowToast] = useState<string | null>(null);

  const toggleSetting = (key: 'notificationsEnabled' | 'autoAudioEnabled' | 'dataSaverEnabled') => {
    setProfile(prev => {
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
        <h2 className="font-black text-[24px] text-[#002541] tracking-tight">Mon profil</h2>
        <p className="text-xs font-semibold text-[#5a6573]">Paramètres de conduite et informations de bord</p>
      </div>

      {/* Driver Card */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex items-center gap-4">
        <div className="relative w-16 h-16 rounded-full bg-[#123b5d] text-white flex items-center justify-center shrink-0 shadow-md">
          <span className="font-black text-2xl">{isDriverA ? 'J' : 'P'}</span>
          <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-[#fc9430] border-2 border-white"></span>
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-black text-[18px] text-[#002541] truncate">
              {isDriverA ? 'Jean' : 'Paul'}
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-[#edf4ff] text-[#002541] font-black text-[11px] uppercase">
              {profile.role}
            </span>
            <span className="text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
              {isDriverA ? 'Chauf. A' : 'Chauf. B'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[#5a6573] text-xs font-bold">
            <Phone className="w-3.5 h-3.5 text-[#f28c28]" />
            <span>{isDriverA ? '+237 671 234 567' : '+237 699 876 543'}</span>
          </div>
        </div>
      </section>

      {/* MULTI-CHAUFFEUR & SOURCE DE DONNÉES PARTAGÉE */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-blue-200 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#002541] flex items-center gap-1.5">
            <Database className="w-4 h-4 text-[#f28c28]" />
            Source de données partagée
          </span>
          <span className="text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
            Temps réel actif
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-[#edf4ff] flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between text-[#002541] font-bold">
            <span>Collection ciblée :</span>
            <span className="font-mono text-[#123b5d] font-black">/alerts</span>
          </div>
          <div className="flex items-center justify-between text-[#5a6573]">
            <span>Chauffeur actif :</span>
            <strong className="text-[#002541]">{activeDriver}</strong>
          </div>
        </div>

        {onToggleDriver && (
          <button
            onClick={onToggleDriver}
            type="button"
            className="w-full min-h-[46px] bg-[#123b5d] hover:bg-[#002541] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs"
          >
            <UserCheck className="w-4 h-4 text-[#f28c28]" />
            <span>Basculer vers {isDriverA ? 'Chauffeur B (Paul)' : 'Chauffeur A (Jean)'}</span>
          </button>
        )}

        <button
          onClick={handleResetData}
          type="button"
          className="w-full py-2 text-[11px] font-bold text-[#5a6573] hover:text-[#002541] flex items-center justify-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Réinitialiser les alertes d'exemple</span>
        </button>
      </section>

      {/* Affectation Professionnelle */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-3">
        <span className="text-[11px] font-black uppercase tracking-wider text-[#914d00]">
          Affectation professionnelle
        </span>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#edf4ff]">
            <div className="w-9 h-9 rounded-lg bg-[#dfe9f7] flex items-center justify-center shrink-0 text-[#002541]">
              <Building className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-semibold text-[#5a6573]">Compagnie de transport</span>
              <span className="text-sm font-bold text-[#002541] truncate">{profile.company}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#edf4ff]">
            <div className="w-9 h-9 rounded-lg bg-[#dfe9f7] flex items-center justify-center shrink-0 text-[#002541]">
              <Bus className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-semibold text-[#5a6573]">Véhicule assigné</span>
              <span className="text-sm font-bold text-[#002541] truncate">{profile.vehicleType}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Corridor Habituel */}
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#914d00]">
            Corridor habituel
          </span>
          <span className="text-[11px] font-bold text-[#002541] bg-[#edf4ff] px-2 py-0.5 rounded">
            N4 Actif
          </span>
        </div>

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
              <span className="text-[11px] text-[#5a6573] font-semibold">Axe National N4</span>
            </div>
          </div>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
        </div>
      </section>

      {/* Préférences de conduite */}
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
              profile.notificationsEnabled ? 'bg-[#f28c28]' : 'bg-slate-300'
            }`}
            aria-label="Activer les notifications"
          >
            <span className={`block w-5 h-5 bg-white rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
              profile.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}></span>
          </button>
        </div>

        <div className="h-px bg-slate-100 w-full"></div>

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
              profile.autoAudioEnabled ? 'bg-[#f28c28]' : 'bg-slate-300'
            }`}
            aria-label="Activer l'audio automatique"
          >
            <span className={`block w-5 h-5 bg-white rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
              profile.autoAudioEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}></span>
          </button>
        </div>

        <div className="h-px bg-slate-100 w-full"></div>

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
              profile.dataSaverEnabled ? 'bg-[#f28c28]' : 'bg-slate-300'
            }`}
            aria-label="Activer l'économie de données"
          >
            <span className={`block w-5 h-5 bg-white rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
              profile.dataSaverEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}></span>
          </button>
        </div>
      </section>

      {/* Liens utilitaires Aide & À propos */}
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
          <span className="material-symbols-outlined text-slate-400 text-[18px]">chevron_right</span>
        </button>

        <div className="h-px bg-slate-100 w-full"></div>

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
          <span className="material-symbols-outlined text-slate-400 text-[18px]">chevron_right</span>
        </button>
      </section>

      {/* Déconnexion */}
      <div className="pt-1">
        <button
          onClick={() => {
            setShowToast('Session active sur le poste de bord N4');
            setTimeout(() => setShowToast(null), 2500);
          }}
          type="button"
          className="w-full min-h-[52px] rounded-xl bg-red-50 hover:bg-red-100 text-[#d92d20] border border-red-200 font-black text-xs uppercase tracking-wide flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs"
        >
          <LogOut className="w-4 h-4" />
          <span>Déconnexion</span>
        </button>
        <div className="text-center mt-3 text-[10px] font-extrabold uppercase text-[#73777f]">
          ROUTEGUARD v2.4.1 • POSTE AXE YAOUNDÉ-BAFOUSSAM
        </div>
      </div>
    </div>
  );
};
