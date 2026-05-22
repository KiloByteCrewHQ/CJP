/* ============================================================
   audio.js — procedural UI sound via Web Audio API.
   No audio files needed: every sound is synthesized on the fly,
   so there is nothing to download and nothing to lag.
   ============================================================ */

window.GameAudio = (function () {
  let ctx = null;
  let enabled = true;

  // The browser only allows audio after a user gesture, so the
  // AudioContext is created lazily on the first sound request.
  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /**
   * Play a short synthesized tone.
   * @param {object} o - {freq, type, dur, vol, slideTo}
   */
  function tone({ freq = 440, type = "sine", dur = 0.12, vol = 0.18, slideTo = null }) {
    if (!enabled) return;
    const ac = getCtx();
    if (!ac) return;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const now = ac.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);

    // quick attack, smooth decay — keeps clicks soft, not harsh
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  return {
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },

    /** soft tick for hovering interactive elements */
    hover() { tone({ freq: 520, type: "sine", dur: 0.07, vol: 0.06 }); },

    /** crisp click for buttons */
    click() { tone({ freq: 660, type: "triangle", dur: 0.1, vol: 0.14, slideTo: 880 }); },

    /** selecting a difficulty */
    select() { tone({ freq: 480, type: "square", dur: 0.11, vol: 0.1, slideTo: 720 }); },

    /** turning sound on */
    on() { tone({ freq: 440, type: "triangle", dur: 0.16, vol: 0.16, slideTo: 880 }); },

    /** turning sound off — plays once even while "disabled" so the
        user gets feedback that the toggle worked */
    off() {
      const was = enabled;
      enabled = true;
      tone({ freq: 600, type: "triangle", dur: 0.16, vol: 0.14, slideTo: 240 });
      enabled = was;
    },

    /** triumphant little fanfare for Start Game */
    start() {
      [523, 659, 784, 1046].forEach((f, i) => {
        setTimeout(() => tone({ freq: f, type: "triangle", dur: 0.18, vol: 0.16 }), i * 90);
      });
    },
  };
})();
