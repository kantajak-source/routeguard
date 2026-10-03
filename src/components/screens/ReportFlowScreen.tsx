import React, { useState, useEffect, useRef } from 'react';
import { ReportStep, AIInterpretation, AlertItem } from '../../types/routeguard';
import { voiceService } from '../../services/voiceService';
import { AIInterpreter } from '../../services/aiInterpreter';
import { alertService } from '../../services/alertService';
import { locationService, LocationCoordinates } from '../../services/locationService';
import { SAMPLE_VOICE_REPORTS } from '../../data/initialAlerts';
import { Check, X, Mic, Volume2, ArrowLeft, RotateCcw, AlertTriangle } from 'lucide-react';

interface ReportFlowScreenProps {
  onCancel: () => void;
  onAlertPublished: (newAlert: AlertItem) => void;
  onReturnHome: () => void;
  isAudioMuted: boolean;
}

export const ReportFlowScreen: React.FC<ReportFlowScreenProps> = ({
  onCancel,
  onAlertPublished,
  onReturnHome,
  isAudioMuted,
}) => {
  // Main state machine for the reporting flow
  const [step, setStep] = useState<ReportStep>('READY');
  const [spokenText, setSpokenText] = useState<string>('');
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isListeningForVoiceChoice, setIsListeningForVoiceChoice] = useState<boolean>(false);
  const [publishedAlert, setPublishedAlert] = useState<AlertItem | null>(null);

  // References to stop active audio or speech instances
  const activeListenerRef = useRef<{ stop: () => void } | null>(null);
  const activeSpeakerRef = useRef<{ stop: () => void } | null>(null);
  const timerRef = useRef<any>(null);
  // Référence ponctuelle pour le GPS de ce signalement unique (aucun tracking continu)
  const pendingCoordsRef = useRef<LocationCoordinates | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      pendingCoordsRef.current = null;
      activeListenerRef.current?.stop();
      activeSpeakerRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      voiceService.stopSpeaking();
    };
  }, []);

  // ----------------------------------------------------
  // STEP 1 -> STEP 2: START RECORDING (PARLER)
  // ----------------------------------------------------
  const handleStartRecording = (presetPhrase?: string) => {
    voiceService.playRadioBeep('start');
    setStep('RECORDING');
    setRecordingSeconds(0);
    setSpokenText(presetPhrase || '');

    // Démarrer la capture GPS ponctuelle en parallèle (non-bloquante, sans watchPosition)
    pendingCoordsRef.current = null;
    locationService.getCurrentLocation(6000).then((coords) => {
      if (coords) {
        pendingCoordsRef.current = coords;
      }
    }).catch(() => {
      pendingCoordsRef.current = null;
    });

    // Start duration timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    // If preset provided, simulate short live transcription then auto-transition
    if (presetPhrase) {
      setTimeout(() => {
        setSpokenText(presetPhrase);
      }, 700);

      // Auto stop after 3 seconds for preset
      setTimeout(() => {
        handleStopRecording(presetPhrase);
      }, 2600);
      return;
    }

    // Try starting real browser speech recognition
    try {
      activeListenerRef.current = voiceService.startSpeechRecognition(
        (transcript: string, isFinal: boolean) => {
          setSpokenText(transcript);
          if (isFinal && transcript.length > 5) {
            // Auto finish if driver pauses
          }
        },
        (err) => {
          console.warn('Speech recognition fallback used:', err);
          // Default fallback sentence if driver spoke nothing
          if (!spokenText) {
            setSpokenText('Véhicule immobilisé près de Bafia direction Bafoussam');
          }
        },
        () => {
          // On end
        }
      );
    } catch {
      // Fallback preset
      setSpokenText('Véhicule immobilisé près de Bafia direction Bafoussam');
    }
  };

  // ----------------------------------------------------
  // STEP 2 -> STEP 3: STOP RECORDING -> AI ANALYSIS
  // ----------------------------------------------------
  const handleStopRecording = async (textOverride?: string) => {
    voiceService.playRadioBeep('stop');
    if (timerRef.current) clearInterval(timerRef.current);
    activeListenerRef.current?.stop();

    const finalText = textOverride || spokenText || 'Véhicule immobilisé près de Bafia direction Bafoussam';
    setSpokenText(finalText);
    setAnalysisError(null);
    setInterpretation(null);

    // Transition to STEP 3: AI ANALYSIS
    setStep('AI_ANALYSIS');

    try {
      // Run AI Interpretation via Gemini
      const aiResult = await AIInterpreter.interpret(finalText);
      setInterpretation(aiResult);

      // Speak audio feedback if unmuted
      if (!isAudioMuted) {
        setTimeout(() => {
          voiceService.speakText(
            `J'ai compris : ${aiResult.dangerType.toLowerCase()}${aiResult.sector ? ', ' + aiResult.sector.toLowerCase() : ''}${aiResult.direction ? ', ' + aiResult.direction.toLowerCase() : ''}.`
          );
        }, 300);
      }

      // Automatically transition to STEP 4: CONFIRMATION after brief preview (2.4s)
      setTimeout(() => {
        setStep((currentStep) => {
          if (currentStep === 'AI_ANALYSIS') {
            startConfirmationStep(aiResult);
            return 'CONFIRMATION';
          }
          return currentStep;
        });
      }, 2400);
    } catch (err: any) {
      console.error('[ROUTEGUARD] Erreur interprétation Gemini :', err);
      pendingCoordsRef.current = null;
      setAnalysisError(err.message || 'Impossible d’interpréter le signalement avec Gemini.');
      if (!isAudioMuted) {
        voiceService.speakText("Erreur lors de l'analyse vocale. Veuillez réessayer.");
      }
    }
  };

  // ----------------------------------------------------
  // STEP 4: START CONFIRMATION (OUI / NON)
  // ----------------------------------------------------
  const startConfirmationStep = (aiData?: AIInterpretation) => {
    const data = aiData || interpretation;
    if (!data) return;

    // Speak confirmation prompt:
    const confirmationPrompt = `${data.summaryText}. Voulez-vous envoyer cette alerte ? Dites oui ou non.`;

    if (!isAudioMuted) {
      activeSpeakerRef.current = voiceService.speakText(
        confirmationPrompt,
        () => {
          // Once spoken, activate voice listening for "OUI" or "NON"
          listenForYesNoDecision();
        }
      );
    } else {
      // Audio muted, activate vocal listener immediately
      listenForYesNoDecision();
    }
  };

  const listenForYesNoDecision = () => {
    setIsListeningForVoiceChoice(true);
    activeListenerRef.current = voiceService.listenForYesNo(
      (decision: 'OUI' | 'NON') => {
        setIsListeningForVoiceChoice(false);
        if (decision === 'OUI') {
          handleConfirmAndSend();
        } else {
          handleRejectAndRestart();
        }
      },
      () => {
        setIsListeningForVoiceChoice(false);
      }
    );
  };

  // ----------------------------------------------------
  // STEP 4 -> STEP 5: DRIVER SAID "OUI" -> SEND ALERT
  // Enregistrement effectif dans la source de données partagée
  // ----------------------------------------------------
  const handleConfirmAndSend = async () => {
    activeListenerRef.current?.stop();
    activeSpeakerRef.current?.stop();
    voiceService.stopSpeaking();
    voiceService.playRadioBeep('success');

    if (!interpretation) return;

    // Persist via AlertService (shared collection "alerts")
    const cleanDescription = interpretation.summaryText.replace(/[«»]/g, '').trim();
    const cleanDirection = interpretation.direction.replace('DIRECTION ', '').trim();

    // Récupérer et consommer la position GPS ponctuelle capturée (si disponible)
    const capturedCoords = pendingCoordsRef.current;
    pendingCoordsRef.current = null;

    const createdAlert = await alertService.createAndPublishAlert({
      type: interpretation.alertType,
      description: cleanDescription,
      location: interpretation.sector,
      direction: cleanDirection,
      route: 'Yaoundé-Bafoussam',
      audioDuration: '0:12',
      audioTranscript: `Alerte confirmée par ${alertService.getActiveDriver()} : ${interpretation.summaryText}`,
      severity: interpretation.suggestedSeverity,
      latitude: capturedCoords?.latitude,
      longitude: capturedCoords?.longitude,
      accuracy: capturedCoords?.accuracy,
    });

    setPublishedAlert(createdAlert);
    onAlertPublished(createdAlert);
    setStep('SENT');

    if (!isAudioMuted) {
      voiceService.speakText("Alerte envoyée aux chauffeurs de l'axe N4.");
    }
  };

  // ----------------------------------------------------
  // STEP 4 -> STEP 1: DRIVER SAID "NON" -> RESTART
  // RÈGLE : Ne rien enregistrer dans la source de données
  // ----------------------------------------------------
  const handleRejectAndRestart = () => {
    activeListenerRef.current?.stop();
    activeSpeakerRef.current?.stop();
    voiceService.stopSpeaking();
    voiceService.playRadioBeep('stop');

    // Annuler et effacer la coordonnée GPS en attente
    pendingCoordsRef.current = null;

    // Return to speaking state as required: CONFIRMATION -> NON -> PARLER À NOUVEAU
    setSpokenText('');
    setInterpretation(null);
    setAnalysisError(null);
    setStep('READY');
  };

  // Format seconds to mm:ss
  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex flex-col w-full min-h-[520px] pb-6 pt-2 px-4 max-w-[420px] mx-auto select-none">
      {/* Top back/cancel control (only when in ready or sent state) */}
      {(step === 'READY' || step === 'SENT') && (
        <div className="flex items-center justify-between pb-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-xs font-bold text-[#002541] bg-[#edf4ff] hover:bg-[#dfe9f7] px-3 py-1.5 rounded-lg active:scale-95 transition-all"
            type="button"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retour</span>
          </button>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#914d00] bg-[#ffdcc3] px-2 py-0.5 rounded">
            Axe N4 Yaoundé → Bafoussam
          </span>
        </div>
      )}

      {/* ============================================================ */}
      {/* ÉCRAN 2 : SIGNALER UN ÉVÉNEMENT (PARLER / READY)             */}
      {/* ============================================================ */}
      {step === 'READY' && (
        <div className="flex flex-col items-center justify-between flex-1 py-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <span className="font-extrabold text-[12px] tracking-widest text-[#002541] uppercase bg-[#e4effd] px-3 py-1 rounded-full">
              PROCÉDURE VOCALE
            </span>
            <h1 className="font-black text-[26px] text-[#002541] tracking-tight uppercase leading-tight mt-1">
              SIGNALER UN ÉVÉNEMENT
            </h1>
            <p className="text-[17px] font-bold text-[#f28c28] uppercase tracking-wide">
              PARLEZ POUR SIGNALER
            </p>
            <p className="text-xs text-[#5a6573] max-w-[280px]">
              Ne touchez à aucun menu. Appuyez sur le micro et décrivez ce que vous voyez sur la route.
            </p>
          </div>

          {/* GROS BOUTON MICROPHONE : 🎙️ PARLER */}
          <div className="my-8 flex flex-col items-center">
            <button
              onClick={() => handleStartRecording()}
              type="button"
              className="relative w-40 h-40 rounded-full bg-[#f28c28] hover:bg-[#e06a00] text-white flex flex-col items-center justify-center shadow-[0_12px_36px_rgba(242,140,40,0.45)] active:scale-95 transition-all group border-4 border-orange-200"
              aria-label="Parler pour signaler"
            >
              {/* Outer pulsing ring */}
              <span className="absolute inset-0 rounded-full border-4 border-[#f28c28] animate-ping opacity-25"></span>
              
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-1">
                <Mic className="w-9 h-9 text-white group-hover:scale-110 transition-transform" />
              </div>
              <span className="font-black text-[20px] uppercase tracking-wider">
                PARLER
              </span>
            </button>
            <span className="text-xs font-bold text-[#42474e] mt-4 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#fc9430]"></span>
              Micro prêt pour l'écoute
            </span>
          </div>

          {/* SIMULATEUR / PRESETS RAPIDES CHAUFFEUR N4 */}
          <div className="w-full bg-[#edf4ff] rounded-2xl p-3.5 border border-[#d9e3f1] text-left">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-extrabold text-[#002541] uppercase tracking-wider flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-[#f28c28]">quick_phrases</span>
                Exemples de phrases chauffeurs N4 :
              </span>
              <span className="text-[10px] text-[#5a6573] font-semibold">Test rapide 1-clic</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {SAMPLE_VOICE_REPORTS.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => handleStartRecording(sample.text)}
                  className="w-full text-left p-2 rounded-xl bg-white hover:bg-white/80 border border-blue-100 text-xs text-[#002541] font-semibold active:scale-[0.98] transition-all flex items-center justify-between group"
                  type="button"
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-bold text-[#002541] truncate">« {sample.text} »</span>
                    <span className="text-[10px] text-[#5a6573]">{sample.description}</span>
                  </div>
                  <span className="material-symbols-outlined text-[#f28c28] text-[18px] group-hover:translate-x-0.5 transition-transform">
                    play_circle
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ÉCRAN 2 (SUITE) : 🔴 ENREGISTREMENT...                        */}
      {/* ============================================================ */}
      {step === 'RECORDING' && (
        <div className="flex flex-col items-center justify-between flex-1 py-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="inline-flex items-center gap-2 bg-red-100 border border-red-300 text-[#d92d20] px-4 py-1.5 rounded-full font-black text-sm uppercase tracking-wide">
              <span className="w-3 h-3 rounded-full bg-[#d92d20] animate-ping"></span>
              🔴 ENREGISTREMENT...
            </div>
            <div className="font-mono text-3xl font-black text-[#002541] mt-1">
              {formatTime(recordingSeconds)}
            </div>
            <p className="text-sm font-semibold text-[#42474e]">
              Parlez clairement. L’IA écoute votre message.
            </p>
          </div>

          {/* VIBRATING SOUND WAVE VISUALIZER */}
          <div className="w-full max-w-[280px] my-6 bg-white p-5 rounded-3xl shadow-sm border border-red-100 flex flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-1.5 h-16 w-full">
              {[40, 75, 95, 60, 85, 100, 70, 90, 65, 80, 45, 90, 75, 50].map((h, i) => (
                <div
                  key={i}
                  className="w-2 bg-[#d92d20] rounded-full transition-all duration-150 animate-pulse"
                  style={{
                    height: `${Math.max(14, (h * (0.6 + Math.sin(recordingSeconds * 3 + i) * 0.4)))}%`,
                    animationDelay: `${i * 80}ms`
                  }}
                ></div>
              ))}
            </div>

            {/* Live speech transcription box */}
            <div className="w-full min-h-[48px] bg-red-50/60 rounded-xl p-2.5 text-xs text-[#002541] font-medium italic border border-red-100">
              {spokenText ? `« ${spokenText} »` : "« Parlez maintenant : par exemple « Véhicule immobilisé près de Bafia » »"}
            </div>
          </div>

          {/* BOUTON ARRÊTER L'ENREGISTREMENT */}
          <div className="w-full max-w-[320px] flex flex-col gap-2">
            <button
              onClick={() => handleStopRecording()}
              type="button"
              className="w-full min-h-[60px] bg-[#d92d20] hover:bg-red-700 text-white rounded-2xl px-6 py-3 font-black text-lg uppercase tracking-wide flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-all"
              aria-label="Arrêter l'enregistrement"
            >
              <div className="w-5 h-5 rounded-xs bg-white"></div>
              <span>ARRÊTER L'ENREGISTREMENT</span>
            </button>
            <p className="text-[11px] text-[#5a6573]">
              Appuyez dès que vous avez fini de parler.
            </p>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ÉCRAN 3 : ANALYSE IA (INTERPRÉTATION IA)                     */}
      {/* ============================================================ */}
      {step === 'AI_ANALYSIS' && interpretation && (
        <div className="flex flex-col justify-between flex-1 py-3">
          <div className="flex flex-col gap-3">
            {/* Titre 🤖 INTERPRÉTATION IA */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <h2 className="font-black text-[22px] text-[#002541] uppercase tracking-tight">
                  INTERPRÉTATION IA
                </h2>
              </div>
              <span className="text-[11px] font-black uppercase tracking-wider bg-amber-100 text-[#914d00] border border-amber-300 px-2.5 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-[#f28c28]"></span>
                VÉRIFICATION EN COURS
              </span>
            </div>

            {/* Structured Card: J'AI COMPRIS */}
            <div className="bg-white rounded-2xl border-2 border-[#123b5d] shadow-md p-4 flex flex-col gap-3.5">
              <div className="text-[13px] font-black text-[#5a6573] uppercase tracking-wider">
                J'AI COMPRIS :
              </div>

              {/* Nature du danger */}
              <div className="flex flex-col bg-[#edf4ff] p-3 rounded-xl border border-[#dfe9f7]">
                <span className="text-[11px] font-bold text-[#5a6573] uppercase tracking-wide">
                  Nature du danger :
                </span>
                <span className="text-[20px] font-black text-[#d92d20] uppercase mt-0.5">
                  {interpretation.dangerType}
                </span>
              </div>

              {/* Secteur repéré */}
              <div className="flex flex-col bg-[#edf4ff] p-3 rounded-xl border border-[#dfe9f7]">
                <span className="text-[11px] font-bold text-[#5a6573] uppercase tracking-wide">
                  Secteur repéré :
                </span>
                <span className="text-[18px] font-black text-[#002541] uppercase mt-0.5">
                  {interpretation.sector}
                </span>
              </div>

              {/* Sens de circulation */}
              <div className="flex flex-col bg-[#edf4ff] p-3 rounded-xl border border-[#dfe9f7]">
                <span className="text-[11px] font-bold text-[#5a6573] uppercase tracking-wide">
                  Sens de circulation :
                </span>
                <span className="text-[18px] font-black text-[#002541] uppercase mt-0.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[20px] text-[#f28c28]">trending_flat</span>
                  {interpretation.direction}
                </span>
              </div>
            </div>

            {/* MANDATORY SAFETY NOTICE */}
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 flex items-start gap-2.5 text-[#6e3900]">
              <AlertTriangle className="w-5 h-5 text-[#f28c28] shrink-0 mt-0.5" />
              <div className="flex flex-col text-xs leading-relaxed">
                <span className="font-extrabold uppercase">RÈGLE DE SÉCURITÉ ROUTIÈRE :</span>
                <span className="font-medium text-[#6e3900]">
                  Cette information est une <strong>INTERPRÉTATION</strong> de l'IA et non encore une alerte publiée. Votre confirmation explicite est obligatoire.
                </span>
              </div>
            </div>
          </div>

          {/* Quick pass to confirmation */}
          <div className="pt-2">
            <button
              onClick={() => {
                setStep('CONFIRMATION');
                startConfirmationStep(interpretation);
              }}
              type="button"
              className="w-full min-h-[56px] bg-[#123b5d] hover:bg-[#002541] text-white rounded-xl font-black text-[15px] uppercase tracking-wide flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
            >
              <span>Vérifier et confirmer</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>
        </div>
      )}

      {/* Loading state during Gemini API call */}
      {step === 'AI_ANALYSIS' && !interpretation && !analysisError && (
        <div className="flex flex-col items-center justify-center flex-1 py-12 text-center gap-5">
          <div className="w-16 h-16 rounded-full border-4 border-[#123b5d] border-t-[#f28c28] animate-spin"></div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-black uppercase tracking-widest text-[#f28c28]">ROUTEGUARD AI</span>
            <h3 className="text-xl font-black text-[#002541] uppercase">Analyse vocale Gemini en cours...</h3>
            <p className="text-xs text-[#5a6573] max-w-[280px]">
              Le modèle Gemini extrait les paramètres de sécurité routière de votre message.
            </p>
          </div>
          {spokenText && (
            <div className="w-full max-w-[320px] bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs italic text-slate-700 shadow-xs">
              « {spokenText} »
            </div>
          )}
        </div>
      )}

      {/* Error state if Gemini call fails */}
      {step === 'AI_ANALYSIS' && analysisError && (
        <div className="flex flex-col items-center justify-center flex-1 py-10 text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center text-red-600 shadow-sm">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-lg font-black text-red-700 uppercase">Échec de l'analyse vocale</h3>
            <p className="text-xs text-slate-600 max-w-[300px]">
              {analysisError}
            </p>
          </div>
          <button
            onClick={handleRejectAndRestart}
            type="button"
            className="mt-3 bg-[#002541] hover:bg-[#123b5d] text-white px-6 py-3 rounded-xl font-bold text-sm uppercase shadow-sm active:scale-95 transition-all"
          >
            Recommencer le signalement
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* ÉCRAN 4 : CONFIRMATION HUMAINE (OUI / NON)                   */}
      {/* ============================================================ */}
      {step === 'CONFIRMATION' && interpretation && (
        <div className="flex flex-col justify-between flex-1 py-3 text-center">
          <div className="flex flex-col items-center gap-3">
            {/* Header: 🤖 J'AI COMPRIS */}
            <div className="flex items-center gap-2">
              <span className="text-2xl">🤖</span>
              <h2 className="font-black text-[22px] text-[#002541] uppercase tracking-tight">
                J'AI COMPRIS
              </h2>
            </div>

            {/* Synthesized quote box */}
            <div className="w-full bg-white rounded-2xl border-2 border-[#002541] p-4 shadow-md text-center">
              <p className="text-[20px] font-black text-[#002541] leading-snug">
                {interpretation.summaryText}
              </p>
            </div>

            {/* Prominent question */}
            <div className="mt-2 flex flex-col items-center gap-1">
              <p className="font-black text-[18px] text-[#d92d20] uppercase tracking-wide">
                VOUS VOULEZ ENVOYER CETTE ALERTE ?
              </p>
              
              {/* Vocal listening status */}
              <div className="inline-flex items-center gap-2 bg-[#ffdcc3] text-[#914d00] px-3.5 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wide mt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f28c28] animate-ping"></span>
                <span>DITES « OUI » OU « NON »</span>
              </div>
            </div>
          </div>

          {/* TWO GIANT TACTILE BUTTONS: NON vs OUI */}
          <div className="w-full pt-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 w-full">
              {/* BOUTON NON : Recommencer l'enregistrement */}
              <button
                onClick={handleRejectAndRestart}
                type="button"
                className="min-h-[72px] bg-[#dfe9f7] hover:bg-[#d1dbe9] active:scale-95 text-[#002541] border-2 border-[#c2c7cf] rounded-2xl flex flex-col items-center justify-center p-2 shadow-sm transition-all"
                aria-label="Non, recommencer l'enregistrement"
              >
                <div className="flex items-center gap-1.5 text-red-600">
                  <X className="w-6 h-6 stroke-[3]" />
                  <span className="font-black text-[22px] tracking-wider">NON</span>
                </div>
                <span className="text-[11px] font-bold text-[#42474e]">
                  Recommencer
                </span>
              </button>

              {/* BOUTON OUI : Confirmer et envoyer l'alerte */}
              <button
                onClick={handleConfirmAndSend}
                type="button"
                className="min-h-[72px] bg-[#2e7d32] hover:bg-emerald-700 active:scale-95 text-white border-2 border-emerald-500 rounded-2xl flex flex-col items-center justify-center p-2 shadow-lg transition-all"
                aria-label="Oui, envoyer cette alerte"
              >
                <div className="flex items-center gap-1.5 text-white">
                  <Check className="w-6 h-6 stroke-[3]" />
                  <span className="font-black text-[22px] tracking-wider">OUI</span>
                </div>
                <span className="text-[11px] font-extrabold text-emerald-100 uppercase tracking-wide">
                  Envoyer l'alerte
                </span>
              </button>
            </div>

            <p className="text-[11px] text-[#5a6573] font-medium text-center">
              🔒 La confirmation humaine est obligatoire avant toute diffusion sur la route.
            </p>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ÉCRAN 5 : ALERTE ENVOYÉE                                     */}
      {/* ============================================================ */}
      {step === 'SENT' && publishedAlert && (
        <div className="flex flex-col items-center justify-between flex-1 py-6 text-center">
          <div className="flex flex-col items-center gap-3">
            {/* Green Checkmark */}
            <div className="w-20 h-20 rounded-full bg-emerald-100 border-4 border-emerald-500 text-[#2e7d32] flex items-center justify-center shadow-lg animate-bounce">
              <Check className="w-10 h-10 stroke-[3]" />
            </div>

            <h1 className="font-black text-[28px] text-[#2e7d32] uppercase tracking-tight mt-2">
              ✓ ALERTE ENVOYÉE
            </h1>

            {/* Summary card */}
            <div className="w-full max-w-[320px] bg-white rounded-2xl border-2 border-emerald-200 p-4 shadow-md flex flex-col gap-2 text-center mt-2">
              <span className="font-black text-[22px] text-[#002541] uppercase">
                {publishedAlert.title}
              </span>
              <div className="flex items-center justify-center gap-1.5 text-[15px] font-extrabold text-[#f28c28]">
                <span>{publishedAlert.sector}</span>
                <span>{publishedAlert.direction}</span>
              </div>
              <div className="text-[12px] text-[#5a6573] border-t border-slate-100 pt-2 font-medium">
                Transmise instantanément aux bus du Corridor N4
              </div>
            </div>
          </div>

          {/* Action: RETOUR À L'ACCUEIL */}
          <div className="w-full max-w-[320px] pt-6">
            <button
              onClick={onReturnHome}
              type="button"
              className="w-full min-h-[60px] bg-[#002541] hover:bg-[#123b5d] text-white rounded-2xl font-black text-lg uppercase tracking-wide flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[24px]">home</span>
              <span>RETOUR À L'ACCUEIL</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
