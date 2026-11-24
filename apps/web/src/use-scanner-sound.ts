import { useCallback, useEffect, useRef, useState } from 'react';

export function useScannerSound() {
  const audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const Audio =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  const enable = useCallback(async () => {
    if (!Audio) return;
    try {
      if (!audio.current || audio.current.state === 'closed') {
        const context = new Audio();
        audio.current = context;
        context.onstatechange = () => {
          if (audio.current === context) setEnabled(context.state === 'running');
        };
      }
      const context = audio.current;
      // Mobile browsers require resume() to originate from a tap or keyboard interaction.
      if (context.state !== 'running') await context.resume();
      if (audio.current === context) setEnabled(context.state === 'running');
    } catch {
      // Scanning and visual confirmation remain available without audio output.
      setEnabled(false);
    }
  }, [Audio]);

  useEffect(() => {
    const unlock = () => {
      void enable();
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      const context = audio.current;
      audio.current = null;
      if (context) {
        context.onstatechange = null;
        if (context.state !== 'closed') void context.close().catch(() => {});
      }
    };
  }, [enable]);

  const play = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running' || document.visibilityState !== 'visible') return;
    try {
      const start = context.currentTime;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = 'square';
      tone.frequency.value = 1200;
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(0.08, start + 0.005);
      volume.gain.setValueAtTime(0.08, start + 0.075);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.095);
      tone.connect(volume).connect(context.destination);
      tone.onended = () => {
        tone.disconnect();
        volume.disconnect();
      };
      tone.start(start);
      tone.stop(start + 0.1);
    } catch {
      // A device audio failure must not interrupt scan delivery.
    }
  }, []);

  return { supported: !!Audio, enabled, enable, play };
}
