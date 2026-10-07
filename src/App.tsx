import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { ActiveScreen, AlertItem } from './types/routeguard';
import { INITIAL_ALERTS } from './data/initialAlerts';
import { alertService } from './services/alertService';
import { authService } from './services/authService';
import { outboxSyncService } from './services/outboxSyncService';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { HomeScreen } from './components/screens/HomeScreen';
import { ReportFlowScreen } from './components/screens/ReportFlowScreen';
import { AlertsScreen } from './components/screens/AlertsScreen';
import { AlertDetailScreen } from './components/screens/AlertDetailScreen';
import { ProfileScreen } from './components/screens/ProfileScreen';
import { AuthScreen } from './components/screens/AuthScreen';

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('accueil');
  const [alerts, setAlerts] = useState<AlertItem[]>(INITIAL_ALERTS);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detailReturnScreen, setDetailReturnScreen] = useState<ActiveScreen>('alertes');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isDeviceFrame, setIsDeviceFrame] = useState<boolean>(true);
  const [isInCriticalFlow, setIsInCriticalFlow] = useState<boolean>(false);
  const [activeDriver, setActiveDriver] = useState<string>(alertService.getActiveDriver());
  const [currentUser, setCurrentUser] = useState<User | null>(authService.getCurrentUser());

  // Subscribe to real-time alerts from shared data service (Firestore-ready / Multi-tab channel)
  useEffect(() => {
    const unsubscribe = alertService.subscribeAlerts((liveAlerts) => {
      setAlerts(liveAlerts);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen to authentication state
  useEffect(() => {
    const unsubscribeAuth = authService.onAuthChange((user) => {
      setCurrentUser(user);
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Synchronisation automatique Outbox (J-1-2-4-B) : au démarrage et au retour du réseau
  useEffect(() => {
    // 1. Déclenchement au démarrage de l'application
    if (typeof navigator === 'undefined' || navigator.onLine) {
      outboxSyncService.syncPendingAlerts().catch((err) => {
        console.warn('[OutboxSync] Synchronisation au démarrage :', err);
      });
    }

    // 2. Déclenchement au retour du réseau via l'événement 'online'
    const handleOnline = () => {
      console.log('[OutboxSync] Événement "online" détecté : synchronisation automatique...');
      outboxSyncService.syncPendingAlerts().catch((err) => {
        console.warn('[OutboxSync] Synchronisation au retour réseau :', err);
      });
    };

    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Synchronisation dès que la session Firebase utilisateur devient prête / active
  useEffect(() => {
    if (currentUser && (typeof navigator === 'undefined' || navigator.onLine)) {
      outboxSyncService.syncPendingAlerts().catch((err) => {
        console.warn('[OutboxSync] Synchronisation sur mise à jour de session :', err);
      });
    }
  }, [currentUser]);

  // Derived selected alert guarantees 100% synchronization with the master alerts state
  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) || null;

  // Navigate to screen
  const handleNavigate = (screen: ActiveScreen) => {
    setActiveScreen(screen);
    if (screen !== 'signaler') {
      setIsInCriticalFlow(false);
    }
  };

  // Switch between Chauffeur A and Chauffeur B for multi-user testing
  const handleToggleDriver = () => {
    const nextDriver = activeDriver.includes('Jean') || activeDriver.includes('A')
      ? 'Chauffeur B (Paul)'
      : 'Chauffeur A (Jean)';
    alertService.setActiveDriver(nextDriver);
    setActiveDriver(nextDriver);
  };

  // When driver clicks on "Signaler un événement"
  const handleStartReport = () => {
    setActiveScreen('signaler');
    setIsInCriticalFlow(true);
  };

  // When an alert is confirmed by human and published
  const handleAlertPublished = (newAlert: AlertItem) => {
    setSelectedAlertId(newAlert.id);
  };

  // When returning home after sending alert
  const handleReturnHome = () => {
    setIsInCriticalFlow(false);
    setActiveScreen('accueil');
  };

  // View specific alert detail with contextual return screen
  const handleViewAlertDetail = (alert: AlertItem, returnScreen: ActiveScreen = 'alertes') => {
    setDetailReturnScreen(returnScreen);
    setSelectedAlertId(alert.id);
    setActiveScreen('alerte_detail');
  };

  // View specific alert detail from driver contributions profile
  const handleViewAlertDetailFromProfile = (alert: AlertItem) => {
    setDetailReturnScreen('profil');
    setSelectedAlertId(alert.id);
    setActiveScreen('alerte_detail');
  };

  // Confirm an existing alert (+1 chauffeur confirmation, prevented if already confirmed)
  const handleConfirmAlert = async (alertId: string) => {
    await alertService.confirmAlert(alertId, activeDriver);
  };

  // Handle user logout from profile or settings
  const handleLogout = async () => {
    await authService.logout();
    setActiveScreen('auth');
  };

  return (
    <div className="min-h-screen bg-[#0b1320] flex items-center justify-center p-0 sm:p-4 select-none">
      {/* Container: either smartphone frame (390x844) or responsive container */}
      <div
        className={`w-full bg-[#f7f9ff] text-[#121c26] flex flex-col overflow-hidden transition-all duration-300 relative ${
          isDeviceFrame
            ? 'max-w-[390px] h-[844px] rounded-[44px] shadow-[0_25px_70px_rgba(0,0,0,0.6)] border-[9px] border-[#1e293b]'
            : 'max-w-[480px] min-h-screen sm:rounded-3xl shadow-xl'
        }`}
      >
        {/* Android / iPhone speaker notch simulation in device frame */}
        {isDeviceFrame && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-4 bg-[#1e293b] rounded-full z-50 flex items-center justify-center">
            <div className="w-10 h-1 bg-[#334155] rounded-full"></div>
            <div className="w-2 h-2 ml-2.5 rounded-full bg-[#0f172a]"></div>
          </div>
        )}

        {/* Global RouteGuard Header */}
        <Header
          activeScreen={activeScreen}
          onNavigate={handleNavigate}
          alerts={alerts}
          isAudioMuted={isAudioMuted}
          onToggleMute={() => setIsAudioMuted(!isAudioMuted)}
          isDeviceFrame={isDeviceFrame}
          onToggleFrame={() => setIsDeviceFrame(!isDeviceFrame)}
          isInCriticalFlow={isInCriticalFlow}
          activeDriver={activeDriver}
          onToggleDriver={handleToggleDriver}
        />

        {/* Scrollable Main viewport */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col">
          {activeScreen === 'accueil' && (
            <HomeScreen
              alerts={alerts}
              onStartReport={handleStartReport}
              onViewAlertDetail={(alert) => handleViewAlertDetail(alert, 'accueil')}
              onViewAllAlerts={() => handleNavigate('alertes')}
              isAudioMuted={isAudioMuted}
              activeDriver={activeDriver}
            />
          )}

          {activeScreen === 'signaler' && (
            <ReportFlowScreen
              onCancel={() => {
                setIsInCriticalFlow(false);
                setActiveScreen('accueil');
              }}
              onAlertPublished={handleAlertPublished}
              onReturnHome={handleReturnHome}
              isAudioMuted={isAudioMuted}
            />
          )}

          {activeScreen === 'alertes' && (
            <AlertsScreen
              onSelectAlert={(alert) => handleViewAlertDetail(alert, 'alertes')}
              isAudioMuted={isAudioMuted}
            />
          )}

          {activeScreen === 'alerte_detail' && selectedAlert && (
            <AlertDetailScreen
              alert={selectedAlert}
              onBack={() => handleNavigate(detailReturnScreen)}
              onConfirmAlert={handleConfirmAlert}
              isAudioMuted={isAudioMuted}
            />
          )}

          {activeScreen === 'profil' && (
            <ProfileScreen 
              activeDriver={activeDriver}
              onToggleDriver={handleToggleDriver}
              onLogout={handleLogout}
              onNavigate={handleNavigate}
              currentUser={currentUser}
              alerts={alerts}
              onSelectAlert={handleViewAlertDetailFromProfile}
            />
          )}

          {activeScreen === 'auth' && (
            <AuthScreen
              onAuthenticated={() => {
                setActiveScreen('profil');
              }}
              onContinueAsGuest={() => {
                setActiveScreen('accueil');
              }}
            />
          )}
        </main>

        {/* Bottom Navigation */}
        <BottomNav
          activeScreen={activeScreen}
          onNavigate={handleNavigate}
          unreadCount={alerts.length}
          isInCriticalFlow={isInCriticalFlow}
        />
      </div>
    </div>
  );
}
