// ============================================================================
// Web Audio API Pleasant Two-Tone Cafe Chime Notification System
// Compliant with Browser Autoplay Policies (lazy AudioContext unlock)
// ============================================================================

let audioCtx: AudioContext | null = null;
let isUnlocked = false;

// Audio context singleton with unlock listener
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  if (audioCtx && audioCtx.state === 'suspended' && isUnlocked) {
    audioCtx.resume().catch(() => {});
  }

  return audioCtx;
}

// Unlock audio on first user gesture
export function initAudioOnUserGesture(): void {
  if (typeof window === 'undefined' || isUnlocked) return;

  const unlock = () => {
    isUnlocked = true;
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        // Silent buffer to warm up audio pipeline
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }).catch(() => {});
    }

    // Remove listeners once unlocked
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };

  window.addEventListener('click', unlock, { passive: true, once: true });
  window.addEventListener('keydown', unlock, { passive: true, once: true });
  window.addEventListener('touchstart', unlock, { passive: true, once: true });
}

// Mute settings persistence
const MUTE_STORAGE_KEY = 'vanya_cafe_order_sound_muted';

export function isAudioMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAudioMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {}
}

let lastChimeTimestamp = 0;
const CHIME_THROTTLE_MS = 2000;

/**
 * Plays a loud, pleasant two-tone café chime (D5 -> A5 with bell harmonics).
 * Throttled to play at most once per 2 seconds, guaranteeing a single crisp chime
 * even when customer and admin clients or multiple WebSocket events fire simultaneously.
 */
export function playOrderChime(): void {
  if (isAudioMuted()) return;

  const nowMs = Date.now();
  if (nowMs - lastChimeTimestamp < CHIME_THROTTLE_MS) {
    return;
  }
  lastChimeTimestamp = nowMs;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Helper to synthesize a melodic bell tone with fundamental + harmonic
    const playBellTone = (freq: number, startTime: number, duration: number, gainVal: number) => {
      // Main fundamental oscillator
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, startTime);

      // Harmonic overtone for shimmering bell timbre
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq * 2, startTime);

      // Exponential decay envelope (natural bell chime)
      gain1.gain.setValueAtTime(0.001, startTime);
      gain1.gain.exponentialRampToValueAtTime(gainVal, startTime + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      gain2.gain.setValueAtTime(0.001, startTime);
      gain2.gain.exponentialRampToValueAtTime(gainVal * 0.35, startTime + 0.015);
      gain2.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.7);

      osc1.connect(gain1);
      osc2.connect(gain2);

      gain1.connect(ctx.destination);
      gain2.connect(ctx.destination);

      osc1.start(startTime);
      osc2.start(startTime);

      osc1.stop(startTime + duration);
      osc2.stop(startTime + duration);
    };

    // Note 1: D5 (587.33 Hz)
    playBellTone(587.33, now, 0.45, 0.35);

    // Note 2: A5 (880.00 Hz) — ascending major fifth for attention
    playBellTone(880.00, now + 0.18, 0.75, 0.4);

    // Subtle third harmonic chime sparkle: D6 (1174.66 Hz)
    playBellTone(1174.66, now + 0.28, 0.6, 0.18);
  } catch (err) {
    console.warn('[Audio Alert] Failed to play order chime:', err);
  }
}
