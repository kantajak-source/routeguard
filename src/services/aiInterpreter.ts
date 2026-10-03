import { AIInterpretation, AlertType, AlertSeverity } from '../types/routeguard';

/**
 * AI Interpretation Engine for ROUTEGUARD using Gemini 3.8 Flash via secure server-side proxy.
 * Interprets natural language statements from bus drivers along the Yaoundé - Bafoussam N4 axis.
 *
 * CRITICAL SAFETY PRINCIPLE:
 * The output is explicitly an "INTERPRÉTATION" of what was heard, NEVER a verified fact.
 * It strictly requires driver verification & confirmation before dispatch.
 * Gemini NEVER writes to Firestore directly.
 */
export class AIInterpreter {
  /**
   * Calls the secure server endpoint (/api/interpret) powered by Gemini.
   * Throws an error on network, timeout, or parsing failure so no unverified alert can be published.
   */
  public static async interpret(rawTranscript: string): Promise<AIInterpretation> {
    const trimmed = rawTranscript ? rawTranscript.trim() : '';
    if (!trimmed) {
      throw new Error('Transcription vide. Veuillez dicter votre message.');
    }

    const response = await fetch('/api/interpret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript: trimmed,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Erreur HTTP ${response.status} lors de l'appel Gemini`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {}
      throw new Error(errorMessage);
    }

    const data = await response.json();
    if (!data.success || !data.interpretation) {
      throw new Error(data.error || "L'analyse Gemini n'a pas retourné d'interprétation valide.");
    }

    const { type, location, direction, description } = data.interpretation;

    // Validate type strictly against accepted union
    const validTypes: AlertType[] = ['ACCIDENT', 'VEHICULE_IMMOBILISE', 'FORTE_PLUIE', 'OBSTACLE', 'RALENTISSEMENT'];
    const alertType: AlertType = validTypes.includes(type) ? type : 'OBSTACLE';

    // Map dangerType display string
    let dangerType = 'ÉVÉNEMENT ROUTIER';
    let suggestedSeverity: AlertSeverity = 'PRUDENCE';

    switch (alertType) {
      case 'ACCIDENT':
        dangerType = 'ACCIDENT';
        suggestedSeverity = 'CRITIQUE';
        break;
      case 'VEHICULE_IMMOBILISE':
        dangerType = 'VÉHICULE IMMOBILISÉ';
        suggestedSeverity = 'PRUDENCE';
        break;
      case 'FORTE_PLUIE':
        dangerType = 'FORTE PLUIE';
        suggestedSeverity = 'INFO';
        break;
      case 'OBSTACLE':
        dangerType = 'OBSTACLE SUR CHAUSSÉE';
        suggestedSeverity = 'PRUDENCE';
        break;
      case 'RALENTISSEMENT':
        dangerType = 'RALENTISSEMENT';
        suggestedSeverity = 'PRUDENCE';
        break;
    }

    // Format location (DO NOT invent if empty)
    const cleanLocation = typeof location === 'string' ? location.trim() : '';
    const sector = cleanLocation ? cleanLocation.toUpperCase() : '';

    // Format direction (DO NOT invent if empty)
    const cleanDir = typeof direction === 'string' ? direction.trim().toUpperCase() : '';
    let dirFormatted = '';
    if (cleanDir.includes('BAFOUSSAM')) {
      dirFormatted = 'DIRECTION BAFOUSSAM';
    } else if (cleanDir.includes('YAOUND')) {
      dirFormatted = 'DIRECTION YAOUNDÉ';
    }

    // Human-readable summary for vocal playback & confirmation card
    const parts: string[] = [dangerType.toLowerCase()];
    if (sector) {
      parts.push(sector.toLowerCase());
    }
    if (dirFormatted) {
      parts.push(dirFormatted.toLowerCase());
    }

    const summaryText = `« ${parts.join(', ')}. »`;

    return {
      rawTranscript: trimmed,
      dangerType,
      sector: sector || '',
      direction: dirFormatted || '',
      summaryText,
      suggestedSeverity,
      alertType,
    };
  }
}
