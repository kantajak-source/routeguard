import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

// Initialize Gemini SDK with telemetry header and server-side secret API key
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

app.use(express.json());

// Main model
const MODEL_NAME = 'gemini-3.8-flash';

// API: Interpretation route using Gemini 3.8 Flash
app.post('/api/interpret', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transcript } = req.body;

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'Transcription requise et non vide.',
      });
      return;
    }

    const systemPrompt = `Tu es l'agent IA d'analyse vocale ROUTEGUARD pour chauffeurs professionnels sur l'axe Yaoundé - Bafoussam (N4, Cameroun).
Analyse la transcription vocale du chauffeur et extrais UNIQUEMENT les paramètres de l'événement routier sous forme d'un objet JSON strict.

Règles impératives :
1. "type" : DOIT être exactement l'une des 5 valeurs suivantes :
   - "ACCIDENT" (collision, véhicule renversé, choc)
   - "VEHICULE_IMMOBILISE" (panne, camion ou car arrêté/bloqué sans collision)
   - "FORTE_PLUIE" (averse, orage, inondation, route glissante, brouillard)
   - "OBSTACLE" (arbre couché, rocher sur la voie, camion couché bloquant la voie, éboulement, nid-de-poule)
   - "RALENTISSEMENT" (embouteillage, bouchon, ralentissement général, travaux)
   Si la phrase est vague (ex: "un problème sur la route"), classe dans la catégorie la plus sobre et adaptée parmi les 5 (ex: "OBSTACLE" ou "RALENTISSEMENT").

2. "location" : Indique UNIQUEMENT le lieu ou la ville explicitement mentionné(e) par le chauffeur (ex: "Bafia", "après Bafia", "Obala", "Makénéné", "Tonga", "Bandjoun").
   RÈGLE ABSOLUE ANTI-INVENTION : Ne JAMAIS inventer ou déduire un lieu si le chauffeur ne l'a pas explicitement énoncé. Si aucun lieu n'est fourni ou s'il dit qu'il ne sait pas où il est, renvoie EXACTEMENT une chaîne vide "".

3. "direction" : DOIT être exactement :
   - "BAFOUSSAM" (si le chauffeur dit aller vers Bafoussam ou descendre vers Bafoussam)
   - "YAOUNDÉ" (si le chauffeur dit aller vers Yaoundé ou remonter vers Yaoundé)
   - "" (chaîne vide si la direction n'est pas explicitement mentionnée). Ne jamais deviner.

4. "description" : Une description courte, factuelle et sobre.
   RÈGLE DE SOBRIÉTÉ : Ne JAMAIS inventer de gravité (ne jamais écrire "ACCIDENT GRAVE" ou "MORTEL" sauf si le chauffeur a expressément utilisé ce mot).

Format de réponse : retourne STRICTEMENT un JSON valide :
{
  "type": "ACCIDENT" | "VEHICULE_IMMOBILISE" | "FORTE_PLUIE" | "OBSTACLE" | "RALENTISSEMENT",
  "description": "description courte",
  "location": "lieu explicitement mentionné ou chaîne vide",
  "direction": "YAOUNDÉ" | "BAFOUSSAM" | ""
}`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nTranscription du chauffeur : "${transcript.trim()}"` }],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text ? response.text.trim() : '';
    if (!responseText) {
      throw new Error('Réponse vide reçue de Gemini.');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Réponse JSON invalide reçue de Gemini');
      }
    }

    // Validation stricte des données retournées
    const validTypes = ['ACCIDENT', 'VEHICULE_IMMOBILISE', 'FORTE_PLUIE', 'OBSTACLE', 'RALENTISSEMENT'];
    const type = validTypes.includes(parsed.type) ? parsed.type : 'OBSTACLE';
    const location = typeof parsed.location === 'string' ? parsed.location.trim() : '';
    let direction = typeof parsed.direction === 'string' ? parsed.direction.trim().toUpperCase() : '';
    if (direction.includes('BAFOUSSAM')) direction = 'BAFOUSSAM';
    else if (direction.includes('YAOUND')) direction = 'YAOUNDÉ';
    else direction = '';

    const description = typeof parsed.description === 'string' && parsed.description.trim() !== ''
      ? parsed.description.trim()
      : 'Signalement routier N4';

    res.json({
      success: true,
      modelUsed: MODEL_NAME,
      raw: parsed,
      interpretation: {
        type,
        location,
        direction,
        description,
      },
    });
  } catch (error: any) {
    console.error('[API /api/interpret] Erreur Gemini :', error);
    let userMsg = "Erreur lors de l'analyse IA avec Gemini.";
    if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED')) {
      userMsg = "Quota d'appels IA temporairement saturé. Veuillez patienter quelques secondes avant de réessayer.";
    }
    res.status(500).json({
      success: false,
      error: userMsg,
    });
  }
});

// Mount Vite or serve static files
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ROUTEGUARD Server] Prêt sur le port ${PORT} (mode: ${isProd ? 'production' : 'développement'})`);
  });
}

startServer().catch((err) => {
  console.error('[ROUTEGUARD Server] Erreur fatale au démarrage :', err);
  process.exit(1);
});
