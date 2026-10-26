import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { AlertItem, CorridorDirection } from '../../types/routeguard';
import { ROUTEGUARD_CORRIDOR_MARKERS, corridorService, CorridorMarker } from '../../services/corridorService';
import { locationService, LocationCoordinates } from '../../services/locationService';
import { AlertDetailContext } from './AlertDetailScreen';
import {
  Navigation,
  Crosshair,
  Layers,
  Filter,
  AlertTriangle,
  RotateCcw,
  ChevronRight,
  MapPin,
  Volume2,
} from 'lucide-react';

interface RouteMapScreenProps {
  alerts: AlertItem[];
  onViewAlertDetail: (alert: AlertItem, context?: AlertDetailContext) => void;
  onNavigateToReport: () => void;
  activeDirection?: CorridorDirection;
  overrideCoordinates?: LocationCoordinates | null;
}

// Polyline drawing component for the Cameroon N4 Corridor (Yaoundé ⇄ Bafoussam)
const CorridorPolylineOverlay: React.FC<{
  path: { lat: number; lng: number }[];
}> = ({ path }) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib || path.length === 0) return;

    // Dark casing line for high visibility on any map background
    const casing = new mapsLib.Polyline({
      path,
      geodesic: true,
      strokeColor: '#002541',
      strokeOpacity: 0.9,
      strokeWeight: 7,
      zIndex: 2,
      map,
    });

    // Vibrant main route line
    const routeLine = new mapsLib.Polyline({
      path,
      geodesic: true,
      strokeColor: '#0284c7',
      strokeOpacity: 0.95,
      strokeWeight: 4,
      zIndex: 3,
      map,
    });

    return () => {
      casing.setMap(null);
      routeLine.setMap(null);
    };
  }, [map, mapsLib, path]);

  return null;
};

// Map Camera & Bounds Controller
const MapBoundsController: React.FC<{
  triggerBounds: { lat: number; lng: number }[] | null;
  resetKey: number;
}> = ({ triggerBounds, resetKey }) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !mapsLib || !triggerBounds || triggerBounds.length === 0) return;

    const bounds = new mapsLib.LatLngBounds();
    triggerBounds.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, { top: 70, right: 30, bottom: 180, left: 30 });
  }, [map, mapsLib, triggerBounds, resetKey]);

  return null;
};

/**
 * Returns icon and pin colors according to Alert type & severity
 */
const getAlertMarkerVisuals = (type: string, severity: string) => {
  let emoji = '⚠️';
  let bgColor = 'bg-amber-500';
  let ringColor = 'ring-amber-200';
  let borderColor = 'border-amber-600';

  switch (type) {
    case 'ACCIDENT':
      emoji = '🚨';
      bgColor = 'bg-red-600';
      ringColor = 'ring-red-300';
      borderColor = 'border-red-700';
      break;
    case 'VEHICULE_IMMOBILISE':
      emoji = '🚧';
      bgColor = 'bg-amber-600';
      ringColor = 'ring-amber-300';
      borderColor = 'border-amber-700';
      break;
    case 'FORTE_PLUIE':
      emoji = '🌧️';
      bgColor = 'bg-blue-600';
      ringColor = 'ring-blue-300';
      borderColor = 'border-blue-700';
      break;
    case 'RALENTISSEMENT':
      emoji = '🚦';
      bgColor = 'bg-yellow-500';
      ringColor = 'ring-yellow-200';
      borderColor = 'border-yellow-600';
      break;
    default:
      emoji = '⚠️';
      bgColor = 'bg-orange-500';
      ringColor = 'ring-orange-200';
      borderColor = 'border-orange-600';
  }

  if (severity === 'CRITIQUE') {
    ringColor = 'ring-red-400 animate-pulse';
  }

  return { emoji, bgColor, ringColor, borderColor };
};

type MappedAlert = AlertItem & { mapPosition: { lat: number; lng: number } };

export const RouteMapScreen: React.FC<RouteMapScreenProps> = ({
  alerts,
  onViewAlertDetail,
  onNavigateToReport,
  activeDirection = 'YAOUNDE_TO_BAFOUSSAM',
  overrideCoordinates,
}) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const [selectedAlert, setSelectedAlert] = useState<MappedAlert | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<CorridorMarker | null>(null);
  const [userLocation, setUserLocation] = useState<LocationCoordinates | null>(
    overrideCoordinates || null
  );
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [mapType, setMapType] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [showLandmarks, setShowLandmarks] = useState<boolean>(true);
  const [boundsTriggerKey, setBoundsTriggerKey] = useState<number>(1);

  // Initial fetch of user location
  useEffect(() => {
    let isMounted = true;
    if (overrideCoordinates) {
      setUserLocation(overrideCoordinates);
      return;
    }

    setIsLocating(true);
    locationService
      .getCurrentLocation(7000)
      .then((coords) => {
        if (isMounted && coords) {
          setUserLocation(coords);
        }
      })
      .finally(() => {
        if (isMounted) setIsLocating(false);
      });

    return () => {
      isMounted = false;
    };
  }, [overrideCoordinates]);

  // Request fresh location
  const handleLocateMe = useCallback(async () => {
    setIsLocating(true);
    const coords = await locationService.getCurrentLocation(7000);
    setIsLocating(false);
    if (coords) {
      setUserLocation(coords);
      // Fit to user location
      setBoundsTriggerKey((k) => k + 1);
    }
  }, []);

  // Center on corridor
  const handleFitCorridor = useCallback(() => {
    setBoundsTriggerKey((k) => k + 1);
  }, []);

  // Corridor line coordinates
  const corridorPath = useMemo(() => {
    return ROUTEGUARD_CORRIDOR_MARKERS.map((m) => ({
      lat: m.latitude,
      lng: m.longitude,
    }));
  }, []);

  // Compute positions for alerts (fallback to sector coordinates if missing)
  const mappedAlerts = useMemo(() => {
    return alerts
      .map((alert) => {
        let lat = alert.latitude;
        let lng = alert.longitude;

        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
          // Fallback to sector matching
          const marker = corridorService.findMarkerByName(
            alert.sector || alert.location || alert.title || ''
          );
          if (marker) {
            lat = marker.latitude;
            lng = marker.longitude;
          }
        }

        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
          return null;
        }

        return {
          ...alert,
          mapPosition: { lat, lng },
        };
      })
      .filter((a): a is AlertItem & { mapPosition: { lat: number; lng: number } } => a !== null);
  }, [alerts]);

  // Filtered alerts
  const filteredAlerts = useMemo(() => {
    if (activeFilter === 'ALL') return mappedAlerts;
    if (activeFilter === 'CRITICAL') return mappedAlerts.filter((a) => a.severity === 'CRITIQUE');
    return mappedAlerts.filter((a) => a.type === activeFilter);
  }, [mappedAlerts, activeFilter]);

  // Overall bounds encompassing corridor + driver position
  const targetBounds = useMemo(() => {
    const points = [...corridorPath];
    if (userLocation) {
      points.push({ lat: userLocation.latitude, lng: userLocation.longitude });
    }
    return points;
  }, [corridorPath, userLocation]);

  return (
    <div className="flex-1 flex flex-col relative w-full h-full min-h-[500px] overflow-hidden bg-slate-900">
      {/* Top Floating Controls Bar */}
      <div className="absolute top-3 left-3 right-3 z-30 flex flex-col gap-2 pointer-events-none">
        <div className="flex items-center justify-between gap-2">
          {/* Corridor Badge */}
          <div className="pointer-events-auto bg-[#002541]/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full shadow-lg border border-sky-500/30 flex items-center gap-2 text-xs font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Corridor N4 Yaoundé ⇄ Bafoussam</span>
          </div>

          {/* Map Style & Reset Controls */}
          <div className="pointer-events-auto flex items-center gap-1.5 bg-white/90 backdrop-blur-md p-1 rounded-full shadow-lg border border-slate-200">
            <button
              onClick={() => setMapType(mapType === 'roadmap' ? 'hybrid' : 'roadmap')}
              className={`p-1.5 rounded-full text-xs font-semibold transition-colors flex items-center justify-center ${
                mapType === 'hybrid'
                  ? 'bg-[#002541] text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              title="Basculer vue satellite / plan"
              type="button"
            >
              <Layers className="w-4 h-4" />
            </button>
            <button
              onClick={handleFitCorridor}
              className="p-1.5 rounded-full text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors"
              title="Recentrer sur le corridor N4"
              type="button"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleLocateMe}
              disabled={isLocating}
              className={`p-1.5 rounded-full text-xs font-semibold transition-colors ${
                isLocating
                  ? 'bg-amber-100 text-amber-600 animate-spin'
                  : userLocation
                  ? 'bg-sky-500 text-white hover:bg-sky-600'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              title="Localiser ma position GPS"
              type="button"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-3 py-1 rounded-full font-bold whitespace-nowrap shadow-sm transition-all ${
              activeFilter === 'ALL'
                ? 'bg-[#002541] text-white ring-2 ring-sky-400'
                : 'bg-white/90 backdrop-blur-md text-slate-700 hover:bg-white'
            }`}
          >
            Toutes ({mappedAlerts.length})
          </button>
          <button
            onClick={() => setActiveFilter('CRITICAL')}
            className={`px-3 py-1 rounded-full font-bold whitespace-nowrap shadow-sm transition-all flex items-center gap-1 ${
              activeFilter === 'CRITICAL'
                ? 'bg-red-600 text-white ring-2 ring-red-300'
                : 'bg-white/90 backdrop-blur-md text-red-700 hover:bg-white'
            }`}
          >
            <span>🔴</span>
            <span>Urgentes</span>
          </button>
          <button
            onClick={() => setActiveFilter('ACCIDENT')}
            className={`px-3 py-1 rounded-full font-semibold whitespace-nowrap shadow-sm transition-all flex items-center gap-1 ${
              activeFilter === 'ACCIDENT'
                ? 'bg-red-600 text-white'
                : 'bg-white/90 backdrop-blur-md text-slate-700 hover:bg-white'
            }`}
          >
            <span>🚨</span>
            <span>Accidents</span>
          </button>
          <button
            onClick={() => setActiveFilter('VEHICULE_IMMOBILISE')}
            className={`px-3 py-1 rounded-full font-semibold whitespace-nowrap shadow-sm transition-all flex items-center gap-1 ${
              activeFilter === 'VEHICULE_IMMOBILISE'
                ? 'bg-amber-600 text-white'
                : 'bg-white/90 backdrop-blur-md text-slate-700 hover:bg-white'
            }`}
          >
            <span>🚧</span>
            <span>Pannes</span>
          </button>
          <button
            onClick={() => setActiveFilter('FORTE_PLUIE')}
            className={`px-3 py-1 rounded-full font-semibold whitespace-nowrap shadow-sm transition-all flex items-center gap-1 ${
              activeFilter === 'FORTE_PLUIE'
                ? 'bg-blue-600 text-white'
                : 'bg-white/90 backdrop-blur-md text-slate-700 hover:bg-white'
            }`}
          >
            <span>🌧️</span>
            <span>Météo</span>
          </button>
        </div>
      </div>

      {/* Main Google Maps View */}
      <div className="w-full h-full min-h-[500px] flex-1 relative">
        <APIProvider apiKey={apiKey} language="fr" region="CM">
          <Map
            mapId="DEMO_MAP_ID"
            defaultCenter={{ lat: 4.65, lng: 11.15 }}
            defaultZoom={8}
            mapTypeId={mapType}
            gestureHandling="greedy"
            disableDefaultUI={false}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            {/* Auto camera controller */}
            <MapBoundsController
              triggerBounds={targetBounds}
              resetKey={boundsTriggerKey}
            />

            {/* N4 Polyline */}
            <CorridorPolylineOverlay path={corridorPath} />

            {/* Corridor Landmark Markers */}
            {showLandmarks &&
              ROUTEGUARD_CORRIDOR_MARKERS.map((marker) => (
                <AdvancedMarker
                  key={`landmark-${marker.name}`}
                  position={{ lat: marker.latitude, lng: marker.longitude }}
                  title={`${marker.name} (PK ${marker.pk})`}
                  onClick={() => {
                    setSelectedMarker(marker);
                    setSelectedAlert(null);
                  }}
                >
                  <div className="bg-[#002541]/90 hover:bg-[#002541] text-white border-2 border-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow-md cursor-pointer transition-transform hover:scale-110 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                    <span>{marker.name}</span>
                    <span className="text-[9px] text-sky-300 opacity-90">PK{marker.pk}</span>
                  </div>
                </AdvancedMarker>
              ))}

            {/* Driver Current Location Marker */}
            {userLocation && (
              <AdvancedMarker
                position={{
                  lat: userLocation.latitude,
                  lng: userLocation.longitude,
                }}
                title="Votre position GPS"
              >
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-8 h-8 rounded-full bg-sky-400/30 animate-ping" />
                  <div className="w-7 h-7 rounded-full bg-[#002541] border-2 border-white shadow-xl flex items-center justify-center text-white text-xs font-bold">
                    <Navigation className="w-4 h-4 text-sky-400 fill-sky-400" />
                  </div>
                </div>
              </AdvancedMarker>
            )}

            {/* Alert Markers */}
            {filteredAlerts.map((alert) => {
              const visuals = getAlertMarkerVisuals(alert.type, alert.severity);
              return (
                <AdvancedMarker
                  key={alert.id}
                  position={alert.mapPosition}
                  title={`${alert.title} - ${alert.sector}`}
                  onClick={() => {
                    setSelectedAlert(alert);
                    setSelectedMarker(null);
                  }}
                >
                  <div className="relative group cursor-pointer transition-transform hover:scale-125">
                    <div
                      className={`w-9 h-9 rounded-full ${visuals.bgColor} ${visuals.ringColor} ring-4 border-2 border-white shadow-xl flex items-center justify-center text-base`}
                    >
                      <span>{visuals.emoji}</span>
                    </div>
                    {/* Badge text on hover */}
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                      {alert.sector || alert.badgeText}
                    </div>
                  </div>
                </AdvancedMarker>
              );
            })}

            {/* InfoWindow for Selected Alert */}
            {selectedAlert && (
              <InfoWindow
                position={selectedAlert.mapPosition}
                onCloseClick={() => setSelectedAlert(null)}
                headerContent={
                  <div className="font-bold text-xs text-[#002541] flex items-center gap-1.5 pr-2">
                    <span>{getAlertMarkerVisuals(selectedAlert.type, selectedAlert.severity).emoji}</span>
                    <span>{selectedAlert.title}</span>
                  </div>
                }
              >
                <div className="max-w-[220px] text-slate-800 text-xs flex flex-col gap-1.5 p-0.5">
                  <div className="font-semibold text-slate-900">
                    {selectedAlert.sector || selectedAlert.location || 'Secteur N4'}
                  </div>
                  {selectedAlert.description && (
                    <p className="text-[11px] text-slate-600 line-clamp-2">
                      {selectedAlert.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                    <span>{selectedAlert.timeAgo || 'Récent'}</span>
                    <span className="font-bold text-emerald-600">
                      ✓ {selectedAlert.confirmationsCount || selectedAlert.confirmationCount || 1} confirmation(s)
                    </span>
                  </div>
                  <button
                    onClick={() => onViewAlertDetail(selectedAlert)}
                    className="mt-1 w-full bg-[#002541] hover:bg-[#003863] text-white py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-sm transition-colors"
                  >
                    <span>Détails & Vocal</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </InfoWindow>
            )}

            {/* InfoWindow for Landmark */}
            {selectedMarker && (
              <InfoWindow
                position={{ lat: selectedMarker.latitude, lng: selectedMarker.longitude }}
                onCloseClick={() => setSelectedMarker(null)}
                headerContent={
                  <div className="font-bold text-xs text-[#002541]">
                    📍 Repère {selectedMarker.name}
                  </div>
                }
              >
                <div className="text-xs text-slate-700">
                  <p>Point Kilométrique : <strong className="text-sky-700">PK {selectedMarker.pk}</strong></p>
                  <p className="text-[10px] text-slate-500 mt-1">Axe National N4 Yaoundé ⇄ Bafoussam</p>
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>

      {/* Bottom Floating Quick Action Sheet */}
      <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-none">
        <div className="pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200/80 p-3 max-w-[420px] mx-auto">
          {selectedAlert ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-2xl">
                  {getAlertMarkerVisuals(selectedAlert.type, selectedAlert.severity).emoji}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">
                    {selectedAlert.title} — {selectedAlert.sector}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {selectedAlert.distanceText || selectedAlert.description || 'Sur le corridor N4'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => onViewAlertDetail(selectedAlert)}
                className="shrink-0 bg-[#002541] hover:bg-[#00365d] text-white text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1 shadow-md transition-all active:scale-95"
              >
                <span>Voir</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
                  <MapPin className="w-5 h-5 text-sky-700" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    {filteredAlerts.length} alerte(s) active(s) sur la carte
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {userLocation ? 'GPS actif • Tracé N4 synchronisé' : 'Recherche GPS ou vue globale'}
                  </div>
                </div>
              </div>
              <button
                onClick={onNavigateToReport}
                className="bg-[#fc9430] hover:bg-[#e06a00] text-white text-xs font-extrabold px-3 py-2 rounded-xl flex items-center gap-1 shadow-md transition-all active:scale-95"
              >
                <span>Signaler</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
