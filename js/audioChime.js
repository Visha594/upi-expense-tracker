/**
 * Web Audio API synthesized UPI payment confirmation chime and voice announcer.
 */
class AudioChimeService {
  constructor() {
    this.ctx = null;
    this.soundEnabled = true;
    this.voiceEnabled = true;
  }

  initContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Plays a pleasant dual-tone harmonic chime (Google Pay / PhonePe style)
   */
  playUpiSuccessChime() {
    if (!this.soundEnabled) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.01, now);
      gain1.gain.exponentialRampToValueAtTime(0.25, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: B5 (987.77 Hz)
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now + 0.1);
      gain2.gain.setValueAtTime(0.01, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.3, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.55);

      // Note 3: E6 (1318.51 Hz) - sparkling finish
      const osc3 = this.ctx.createOscillator();
      const gain3 = this.ctx.createGain();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(1318.51, now + 0.22);
      gain3.gain.setValueAtTime(0.01, now + 0.22);
      gain3.gain.exponentialRampToValueAtTime(0.2, now + 0.25);
      gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      osc3.connect(gain3);
      gain3.connect(this.ctx.destination);
      osc3.start(now + 0.22);
      osc3.stop(now + 0.85);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  /**
   * Simulates Indian UPI Soundbox voice announcement
   * e.g., "Paid 350 rupees via UPI" or "350 rupees received on PhonePe"
   */
  speakPayment(amount, merchant, type = 'debit') {
    if (!this.voiceEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel(); // Stop ongoing speech
      const text = type === 'debit'
        ? `₹${amount} paid to ${merchant}`
        : `₹${amount} received via UPI`;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-IN'; // Indian English accent if available

      // Check if Indian English voice exists
      const voices = window.speechSynthesis.getVoices();
      const inVoice = voices.find(v => v.lang === 'en-IN' || v.lang.includes('IN'));
      if (inVoice) {
        utterance.voice = inVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Voice announcement error:', e);
    }
  }

  toggleSound(enabled) {
    this.soundEnabled = enabled;
  }

  toggleVoice(enabled) {
    this.voiceEnabled = enabled;
  }
}

export const audioService = new AudioChimeService();
