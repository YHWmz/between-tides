// Everything heard is synthesised: wind, the sea under the cliff, footsteps, the gate, the lamp.
export function createAudio() {
  let ctx = null, master, output, tone, wind, sea, windowWind, windowSea, windowPan, hum;
  const noiseBuffer = (seconds, brown) => {
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  };
  let white, brown;
  const loop = (buffer, filterType, freq, q, gain, destination = master) => {
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(destination); src.start();
    return { f, g };
  };
  const burst = (buffer, type, freq, q, peak, attack, decay, when = 0) => {
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 1.5, attack + decay + 0.05);
  };

  return {
    start() {
      if (ctx) { ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      output = ctx.createGain(); output.gain.value = 0;
      tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 18000; tone.Q.value = 0.3;
      master.connect(tone).connect(output).connect(ctx.destination);
      output.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3);
      white = noiseBuffer(3, false); brown = noiseBuffer(6, true);
      wind = loop(white, 'bandpass', 420, 0.5, 0.05);
      sea = loop(brown, 'lowpass', 520, 0.3, 0.3);
      windowPan = ctx.createStereoPanner();
      windowPan.connect(output);
      windowWind = loop(white, 'bandpass', 900, 0.7, 0, windowPan);
      windowSea = loop(brown, 'lowpass', 960, 0.4, 0, windowPan);
    },
    suspend() { ctx?.suspend(); },
    /** t seconds, shore 0..1 (how close the cliff edge is), moving 0..1 */
    update(t, shore) {
      if (!ctx) return;
      const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1.3);
      wind.g.gain.setTargetAtTime(0.03 + 0.05 * gust, ctx.currentTime, 0.4);
      wind.f.frequency.setTargetAtTime(330 + 260 * gust, ctx.currentTime, 0.4);
      const swell = 0.55 + 0.45 * Math.sin(t * (Math.PI * 2 / 5.4));          // the same period as the shore breakers
      sea.g.gain.setTargetAtTime((0.1 + 0.34 * shore) * (0.6 + 0.4 * swell), ctx.currentTime, 0.3);
      sea.f.frequency.setTargetAtTime(380 + 420 * swell * shore, ctx.currentTime, 0.3);
    },
    // Air from the open sash is mixed after the indoor low-pass, and follows the player's ears.
    setWindowAir(strength, pan, t) {
      if (!windowPan) return;
      const now = ctx.currentTime;
      const gust = 0.66 + 0.34 * Math.sin(t * 0.69);
      const swell = 0.65 + 0.35 * Math.sin(t * Math.PI * 2 / 5.4);
      windowPan.pan.setTargetAtTime(pan, now, 0.10);
      windowWind.g.gain.setTargetAtTime(strength * (0.05 + gust * 0.065), now, 0.19);
      windowSea.g.gain.setTargetAtTime(strength * (0.09 + swell * 0.14), now, 0.22);
    },
    /** k 0 outdoors .. 1 indoors: walls take the top off the wind and the sea */
    setIndoor(k) { if (ctx) tone.frequency.setTargetAtTime(18000 * Math.pow(420 / 18000, k), ctx.currentTime, 0.15); },
    door() {
      if (!ctx) return;
      const t = ctx.currentTime + 0.12, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.8);
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 1.1);
    },
    match() { if (ctx) { burst(white, 'highpass', 2600, 0.7, 0.14, 0.004, 0.09); burst(white, 'bandpass', 1400, 0.6, 0.06, 0.05, 0.5, 0.08); } },
    step(kind, effort) {
      if (!ctx) return;
      if (kind === 'wood') { burst(brown, 'lowpass', 150, 1.2, 0.5 + 0.2 * effort, 0.003, 0.11); burst(white, 'bandpass', 800 + Math.random() * 200, 1.5, 0.03, 0.003, 0.05); return; }
      if (kind === 'stone') { burst(white, 'bandpass', 1500 + Math.random() * 500, 1.2, 0.05 + 0.04 * effort, 0.004, 0.07); burst(brown, 'lowpass', 240, 0.7, 0.2, 0.003, 0.09); }
      else { burst(white, 'bandpass', 2600 + Math.random() * 900, 0.6, 0.03 + 0.03 * effort, 0.02, 0.16); burst(brown, 'lowpass', 180, 0.7, 0.1, 0.006, 0.1); }
    },
    gate() {
      if (!ctx) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(310, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.9); o.frequency.exponentialRampToValueAtTime(235, t + 1.5);
      f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 7;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.08); g.gain.linearRampToValueAtTime(0.02, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 1.7);
      burst(brown, 'lowpass', 300, 0.8, 0.5, 0.004, 0.2, 1.75);              // it knocks against the stop
    },
    paper() { if (ctx) { burst(white, 'highpass', 3200, 0.5, 0.05, 0.03, 0.22); burst(white, 'highpass', 4200, 0.5, 0.035, 0.03, 0.18, 0.16); } },
    latch() { if (ctx) { burst(white, 'bandpass', 2400, 3, 0.12, 0.002, 0.05); burst(white, 'bandpass', 1700, 3, 0.1, 0.002, 0.06, 0.09); } },
    locked() { if (ctx) { burst(brown, 'lowpass', 420, 1, 0.5, 0.002, 0.08); burst(brown, 'lowpass', 380, 1, 0.4, 0.002, 0.08, 0.13); } },
    shutter() { if (ctx) { burst(white, 'bandpass', 3400, 2, 0.16, 0.001, 0.03); burst(white, 'bandpass', 2300, 2, 0.13, 0.001, 0.05, 0.07); } },
    lamp() {
      if (!ctx) return;
      burst(brown, 'lowpass', 500, 1, 0.9, 0.003, 0.22);                    // the breaker lever
      const t = ctx.currentTime + 0.2, g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 3);
      for (const [fr, type] of [[100, 'sine'], [200, 'sine'], [50, 'triangle']]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.connect(g); o.start(t); }
      g.connect(master); hum = g;
    },
  };
}
