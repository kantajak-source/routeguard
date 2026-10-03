import { AlertItem } from '../types/routeguard';

export const INITIAL_ALERTS: AlertItem[] = [
  {
    id: 'alert-1',
    type: 'ACCIDENT',
    severity: 'CRITIQUE',
    title: 'ACCIDENT GRAVE',
    badgeText: 'ACCIDENT GRAVE',
    description: 'Accident grave à 8 km, collision camion et minibus',
    location: 'Axe Bafia Sud',
    route: 'Yaoundé-Bafoussam',
    status: 'CONFIRMED',
    createdBy: 'Chauffeur VIP 12 (Touristique Express)',
    distanceKm: 8,
    distanceText: '8 km devant vous',
    sector: 'Axe Bafia Sud',
    direction: '→ Bafoussam',
    subDetail: 'Voie droite obstruée, collision camion et minibus',
    audioDuration: '0:24',
    audioTranscript: 'Attention à tous les confrères sur la N4, accident grave à 8 kilomètres devant vous au niveau de Bafia Sud. Réduisez immédiatement la vitesse.',
    confirmationsCount: 4,
    confirmationCount: 4,
    confirmedBy: ['Chauffeur 101', 'Chauffeur 104', 'Chauffeur 208', 'Chauffeur 312'],
    timeAgo: 'Il y a 3 min',
    createdAt: Date.now() - 3 * 60 * 1000,
  },
  {
    id: 'alert-2',
    type: 'VEHICULE_IMMOBILISE',
    severity: 'PRUDENCE',
    title: 'VÉHICULE IMMOBILISÉ',
    badgeText: 'VÉHICULE IMMOBILISÉ',
    description: 'Gros camion plateau immobilisé sur la bande d’arrêt d’urgence',
    location: 'Après Ombessa',
    route: 'Yaoundé-Bafoussam',
    status: 'CONFIRMED',
    createdBy: 'Chauffeur Bus 45 (Buca Voyages)',
    distanceKm: 18,
    distanceText: '18 km devant vous',
    sector: 'Après Ombessa',
    direction: '→ Bafoussam',
    subDetail: 'Gros porteur en panne dans le virage',
    audioDuration: '0:08',
    audioTranscript: 'Signalement véhicule en panne : un gros camion plateau immobilisé sur la bande d’arrêt d’urgence après Ombessa, visibilité réduite.',
    confirmationsCount: 2,
    confirmationCount: 2,
    confirmedBy: ['Chauffeur 210', 'Chauffeur 315'],
    timeAgo: 'Il y a 20 min',
    createdAt: Date.now() - 20 * 60 * 1000,
  },
  {
    id: 'alert-3',
    type: 'FORTE_PLUIE',
    severity: 'INFO',
    title: 'FORTE PLUIE',
    badgeText: 'FORTE PLUIE',
    description: 'Orage violent et fortes pluies dans le secteur de Bafia',
    location: 'Secteur de Bafia',
    route: 'Yaoundé-Bafoussam',
    status: 'CONFIRMED',
    createdBy: 'Chauffeur Minibus 08 (Général Express)',
    distanceText: 'Secteur de Bafia',
    sector: 'Secteur de Bafia',
    direction: '→ Bafoussam',
    subDetail: 'Chaussée très glissante et nids-de-poule masqués',
    audioDuration: '0:15',
    audioTranscript: 'Orage violent et fortes pluies dans le secteur de Bafia, l’eau traverse la chaussée, prudence sur le freinage.',
    confirmationsCount: 6,
    confirmationCount: 6,
    confirmedBy: ['Chauffeur 11', 'Chauffeur 24', 'Chauffeur 56', 'Chauffeur 88', 'Chauffeur 91', 'Chauffeur 102'],
    timeAgo: 'Il y a 1 h',
    createdAt: Date.now() - 60 * 60 * 1000,
  }
];

export const SAMPLE_VOICE_REPORTS = [
  {
    label: 'Véhicule immobilisé Bafia',
    text: 'Véhicule immobilisé près de Bafia direction Bafoussam',
    description: 'Cas de référence du cahier des charges'
  },
  {
    label: 'Accident grave camion Makénéné',
    text: 'Gros accident camion renversé à 12 kilomètres devant nous vers Makénéné',
    description: 'Collision avec blocage partiel'
  },
  {
    label: 'Fortes pluies torrentielles',
    text: 'Grosses pluies torrentielles et chaussée glissante secteur Ombessa vers Bafoussam',
    description: 'Alerte météo chaussée'
  },
  {
    label: 'Obstacle / Arbre tombé',
    text: 'Gros arbre tombé en travers de la route avant Tonga direction Bafoussam',
    description: 'Obstacle imprévu sur l’axe N4'
  }
];
