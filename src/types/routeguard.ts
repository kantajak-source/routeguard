export type AlertType = 
  | 'ACCIDENT' 
  | 'VEHICULE_IMMOBILISE' 
  | 'FORTE_PLUIE' 
  | 'OBSTACLE' 
  | 'RALENTISSEMENT';

export type AlertSeverity = 'CRITIQUE' | 'PRUDENCE' | 'INFO';

export type AlertStatus = 'CONFIRMED' | 'DRAFT' | 'CANCELLED';

/**
 * Standard Shared Alert Schema (Firestore collection "alerts")
 */
export interface AlertRecord {
  id: string;
  type: AlertType;
  description: string;
  location: string;
  direction: string;
  route: string;
  createdAt: number;
  status: AlertStatus;
  confirmationCount: number;
  audioUrl?: string;
  audioTranscript?: string;
  createdBy: string;
  confirmedBy?: string[]; // List of driver IDs/names who already confirmed
  createdByUid?: string; // Firebase Auth UID du créateur
  confirmedByUids?: string[]; // Liste des UIDs Firebase des confirmatifs
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

/**
 * Frontend UI Alert Item (includes UI display helpers while matching AlertRecord)
 */
export interface AlertItem {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  badgeText: string;
  description?: string;
  location?: string;
  route?: string;
  status?: AlertStatus;
  createdBy?: string;
  createdByUid?: string;
  distanceKm?: number;
  distanceText: string;
  sector: string;
  direction: string;
  subDetail?: string;
  audioDuration: string;
  audioTranscript: string;
  audioUrl?: string;
  confirmationsCount: number;
  confirmationCount?: number;
  confirmedBy?: string[];
  confirmedByUids?: string[];
  timeAgo: string;
  createdAt: number;
  isUserCreated?: boolean;
  userConfirmed?: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

export type ReportStep = 
  | 'READY'         // Ecran 2: Parlez pour signaler
  | 'RECORDING'     // Enregistrement...
  | 'AI_ANALYSIS'   // Ecran 3: Interprétation IA
  | 'CONFIRMATION'  // Ecran 4: Confirmation OUI / NON
  | 'SENT';         // Ecran 5: Alerte envoyée

export interface AIInterpretation {
  rawTranscript: string;
  dangerType: string;
  sector: string;
  direction: string;
  summaryText: string;
  suggestedSeverity: AlertSeverity;
  alertType: AlertType;
}

export type ActiveScreen = 'accueil' | 'alertes' | 'signaler' | 'alerte_detail' | 'profil';

export interface DriverProfile {
  name: string;
  phone: string;
  role: string;
  company: string;
  vehicleType: string;
  corridor: string;
  notificationsEnabled: boolean;
  autoAudioEnabled: boolean;
  dataSaverEnabled: boolean;
}

export type { CorridorDirection } from '../services/corridorService';
