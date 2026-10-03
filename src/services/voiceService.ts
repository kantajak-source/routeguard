/**
 * Voice service for ROUTEGUARD:
 * - Speech synthesis (audio playback of alert messages)
 * - Speech recognition (voice dictation and voice YES/NO confirmation)
 * - Walkie-talkie sound effect synthesis via Web Audio API
 */

export class VoiceService {
  private static instance: VoiceService;
  private synth: SpeechSynthesis | null = null;
  private recognition: any = null;
  private audioCtx: AudioContext | null = null;
  private isListening: boolean = false;

  private constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  /**
   * Sound effect for walkie-talkie / radio button click & start recording
   */
  public playRadioBeep(type: 'start' | 'stop' | 'success' | 'alert' = 'start') {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      const now = this.audioCtx.currentTime;

      if (type === 'start') {
        // Double radio squelch chirp
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'stop') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'alert') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.15);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch {
      // AudioContext not available or blocked by user gesture policy
    }
  }

  /**
   * Speak French text out loud
   */
  public speakText(
    text: string, 
    onEnd?: () => void, 
    onError?: () => void
  ): { stop: () => void } {
    if (!this.synth) {
      if (onEnd) setTimeout(onEnd, 2000);
      return { stop: () => {} };
    }

    this.synth.cancel(); // Stop any pending utterance

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Pick best French voice if available
    const voices = this.synth.getVoices();
    const frVoice = voices.find(v => v.lang.startsWith('fr') && !v.name.includes('Google') === false) ||
                    voices.find(v => v.lang.startsWith('fr'));
    if (frVoice) {
      utterance.voice = frVoice;
    }

    utterance.onend = () => {
      if (onEnd) onEnd();
    };

    utterance.onerror = () => {
      if (onError) onError();
    };

    this.synth.speak(utterance);

    return {
      stop: () => {
        this.synth?.cancel();
      }
    };
  }

  public stopSpeaking(): void {
    if (this.synth) {
      this.synth.cancel();
    }
  }

  /**
   * Immediately stops any speech recognition instance and clears listeners
   */
  public stopAllListening(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
        this.recognition.abort?.();
      } catch {}
      this.recognition = null;
    }
    this.isListening = false;
  }

  public isSpeechSupported(): boolean {
    return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }

  /**
   * Starts listening to microphone for general dictation
   */
  public startSpeechRecognition(
    onResult: (transcript: string, isFinal: boolean) => void,
    onError: (err: any) => void,
    onEnd: () => void
  ): { stop: () => void } {
    this.stopAllListening();
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      onError(new Error('Reconnaissance vocale non disponible sur ce navigateur'));
      return { stop: () => {} };
    }

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.lang = 'fr-FR';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
          } else {
            interimTranscript += item[0].transcript;
          }
        }

        const text = finalTranscript || interimTranscript;
        if (text.trim()) {
          onResult(text.trim(), !!finalTranscript);
        }
      };

      this.recognition.onerror = (event: any) => {
        // Do not crash on 'no-speech'
        if (event.error !== 'no-speech') {
          onError(event);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        onEnd();
      };

      this.recognition.start();
      this.isListening = true;

      return {
        stop: () => {
          this.stopAllListening();
        }
      };
    } catch (e) {
      onError(e);
      return { stop: () => {} };
    }
  }

  /**
   * Specific listener for vocal confirmation "OUI" or "NON"
   */
  public listenForYesNo(
    onDecision: (decision: 'OUI' | 'NON') => void,
    onEnded: () => void
  ): { stop: () => void } {
    this.stopAllListening();
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      return { stop: () => {} };
    }

    try {
      const recognizer = new SpeechRecognitionClass();
      this.recognition = recognizer;
      recognizer.lang = 'fr-FR';
      recognizer.continuous = false;
      recognizer.interimResults = true;

      recognizer.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript.toLowerCase();
          if (text.includes('oui') || text.includes('ouais') || text.includes('confirme') || text.includes('envoyer') || text.includes('d\'accord')) {
            recognizer.stop();
            this.recognition = null;
            onDecision('OUI');
            return;
          } else if (text.includes('non') || text.includes('annule') || text.includes('pas') || text.includes('recommence')) {
            recognizer.stop();
            this.recognition = null;
            onDecision('NON');
            return;
          }
        }
      };

      recognizer.onend = () => {
        if (this.recognition === recognizer) {
          this.recognition = null;
        }
        onEnded();
      };

      recognizer.start();

      return {
        stop: () => {
          try { recognizer.stop(); } catch {}
          if (this.recognition === recognizer) {
            this.recognition = null;
          }
        }
      };
    } catch {
      return { stop: () => {} };
    }
  }
}

export const voiceService = VoiceService.getInstance();
