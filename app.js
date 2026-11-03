/* Vagal Breath: a paced breathing guide. Plain JavaScript, no build step. */
(() => {
  'use strict';

  // ---------- Patterns and settings ----------
  const PRESETS = {
    slow: { name: 'Slow 5.5', inhale: 5.5, hold1: 0, exhale: 5.5, hold2: 0 },
    '478': { name: '4-7-8', inhale: 4, hold1: 7, exhale: 8, hold2: 0 },
    box: { name: 'Box', inhale: 4, hold1: 4, exhale: 4, hold2: 4 },
    long: { name: 'Long exhale', inhale: 4, hold1: 0, exhale: 8, hold2: 0 },
  };
  const PHASES = [
    { key: 'inhale', word: 'Breathe in', say: 'Breathe in', tone: 'inhale' },
    { key: 'hold1', word: 'Hold', say: 'Hold', tone: 'hold' },
    { key: 'exhale', word: 'Breathe out', say: 'Breathe out', tone: 'exhale' },
    { key: 'hold2', word: 'Hold', say: 'Hold', tone: 'hold' },
  ];
  const KEYS = ['inhale', 'hold1', 'exhale', 'hold2'];
  const STORE_KEY = 'vagal-breath:v1';
  const APP_VERSION = 6; // keep in step with VERSION in sw.js
  const DEFAULTS = {
    preset: 'slow', inhale: 5.5, hold1: 0, exhale: 5.5, hold2: 0,
    minutes: 5, cue: 'both', voiceURI: '', volume: 0.7, breath: 0.6,
  };

  const settings = Object.assign({}, DEFAULTS, loadSettings());

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      const s = JSON.parse(raw);
      const out = {};
      for (const k of KEYS) if (typeof s[k] === 'number' && isFinite(s[k])) out[k] = s[k];
      if (typeof s.preset === 'string') out.preset = s.preset;
      if ([0, 3, 5, 10, 20].includes(s.minutes)) out.minutes = s.minutes;
      if (['voice', 'breath', 'both', 'silent'].includes(s.cue)) out.cue = s.cue;
      if (typeof s.voiceURI === 'string') out.voiceURI = s.voiceURI;
      if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) out.volume = s.volume;
      if (typeof s.breath === 'number' && s.breath >= 0.1 && s.breath <= 1) out.breath = s.breath;
      return out;
    } catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* storage may be blocked */ }
  }

  const cycleSeconds = (s = settings) => s.inhale + s.hold1 + s.exhale + s.hold2;
  const fmtSec = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  function matchPreset(s = settings) {
    for (const [id, p] of Object.entries(PRESETS)) {
      if (KEYS.every((k) => p[k] === s[k])) return id;
    }
    return 'custom';
  }
  function patternText(s = settings) {
    const parts = [`In ${fmtSec(s.inhale)}`];
    if (s.hold1 > 0) parts.push(`Hold ${fmtSec(s.hold1)}`);
    parts.push(`Out ${fmtSec(s.exhale)}`);
    if (s.hold2 > 0) parts.push(`Hold ${fmtSec(s.hold2)}`);
    return parts.join(' · ');
  }
  function bpmText(s = settings) {
    const bpm = 60 / cycleSeconds(s);
    const r = Math.round(bpm * 10) / 10;
    return `${fmtSec(r)} breaths a minute`;
  }
  const presetLabel = () => (settings.preset === 'custom' ? 'Your own rhythm' : PRESETS[settings.preset].name);

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const clock = $('clock');
  const cueWord = $('cueWord');
  const cueCount = $('cueCount');
  const mainBtn = $('mainBtn');
  const adjustBtn = $('adjustBtn');
  const sheet = $('sheet');
  const scrim = $('scrim');
  const voiceSel = $('voiceSel');
  const voiceField = $('voiceField');
  const canvas = $('field');
  const ctx2d = canvas.getContext('2d');

  // ---------- Audio: breath sound and chime ----------
  const audio = {
    ctx: null, master: null, gain: null, band: null, soft: null, warm: null,

    // Fade the breath to silence, then pause the audio engine. Pausing at once
    // would cut any sound mid-wave and click.
    quiet() {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      try {
        this.cancel(this.gain.gain, now);
        this.gain.gain.setTargetAtTime(0, now, 0.015);
      } catch (e) { /* ignore */ }
      clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => {
        if (speech.busy() && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
      }, 90);
    },

    // Never wake the audio while the voice is talking: on iOS that takes the
    // audio away from speech and chops the words.
    wake() {
      if (speech.busy()) return;
      clearTimeout(this.quietTimer);
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        this.ctx.resume().catch(() => {});
      }
    },

    ensure() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      // Ask iOS 17+ to treat this as playback, so the ringer switch does not silence it.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
      if (!this.ctx) {
        const ctx = (this.ctx = new AC());
        const len = Math.floor(ctx.sampleRate * 6);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        // Pink noise (Paul Kellet's filter), which sounds like moving air.
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
        // Crossfade the loop seam so it does not click.
        const fade = Math.floor(ctx.sampleRate * 0.25);
        for (let i = 0; i < fade; i++) {
          const t = i / fade;
          d[i] = d[i] * t + d[len - fade + i] * (1 - t);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.loopEnd = (len - fade) / ctx.sampleRate;
        // A broad band in the range a phone speaker plays well, with two gentle
        // low-pass stages to take the hiss off the top.
        this.band = ctx.createBiquadFilter();
        this.band.type = 'bandpass';
        this.band.Q.value = 0.6;
        this.band.frequency.value = 700;
        this.soft = ctx.createBiquadFilter();
        this.soft.type = 'lowpass';
        this.soft.Q.value = 0.5;
        this.soft.frequency.value = 2000;
        this.warm = ctx.createBiquadFilter();
        this.warm.type = 'lowpass';
        this.warm.Q.value = 0.5;
        this.warm.frequency.value = 2600;
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.master = ctx.createGain();
        this.master.gain.value = settings.volume;
        src.connect(this.band).connect(this.soft).connect(this.warm).connect(this.gain).connect(this.master).connect(ctx.destination);
        src.start();
      }
      this.wake();
      return true;
    },

    setVolume(v) {
      if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    },

    // Swell of air shaped to the length of the phase.
    // Built from short ramps rather than one value curve: Safari throws if a new
    // curve overlaps one still playing, which silenced every breath after the first.
    breath(kind, seconds) {
      if (!this.ctx || seconds <= 0) return;
      this.wake();
      const now = this.ctx.currentTime;
      const g = this.gain.gain;
      const f = this.band.frequency;
      const peak = settings.breath;
      const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      // Slow, rounded swells: no sudden start, and a long fade at the end.
      const shape = (x) => (kind === 'inhale'
        ? smooth(0, 0.4, x) * (1 - smooth(0.62, 1, x))
        : smooth(0, 0.22, x) * (0.5 + 0.5 * Math.cos(Math.PI * Math.max(0, (x - 0.22) / 0.78))));
      const span = Math.max(0.3, seconds - 0.05);
      try {
        this.cancel(g, now);
        this.cancel(f, now);
        // Always start from silence so the handoff from the voice is seamless.
        g.setValueAtTime(0, now);
        const steps = 32;
        for (let i = 1; i <= steps; i++) {
          const x = i / steps;
          g.linearRampToValueAtTime(i === steps ? 0 : peak * shape(x), now + span * x);
        }
        const [f0, f1] = kind === 'inhale' ? [450, 1000] : [900, 380];
        f.setValueAtTime(f0, now);
        f.exponentialRampToValueAtTime(f1, now + span);
      } catch (e) { /* scheduling can fail if the context is closing */ }
    },

    cancel(param, t) {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else param.cancelScheduledValues(t);
    },

    hush() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      try {
        this.cancel(this.gain.gain, now);
        this.gain.gain.setTargetAtTime(0, now, 0.08);
      } catch (e) { /* ignore */ }
    },

    chime() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      [[392, 0.22], [588, 0.12], [784, 0.06]].forEach(([hz, amp]) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(amp, now + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 4);
        o.connect(g).connect(this.master);
        o.start(now);
        o.stop(now + 4.1);
      });
    },
  };

  // ---------- Voice ----------
  const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b/i;
  const PREFERRED = ['Ava', 'Samantha', 'Allison', 'Susan', 'Karen', 'Moira', 'Tessa', 'Serena', 'Daniel', 'Google US English'];
  const speech = {
    ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
    voices: [],

    load() {
      if (!this.ok) return;
      const all = window.speechSynthesis.getVoices() || [];
      const lang = (navigator.language || 'en-US').slice(0, 2).toLowerCase();
      let list = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang) && !NOVELTY.test(v.name));
      if (!list.length) list = all.filter((v) => !NOVELTY.test(v.name));
      list.sort((a, b) => this.rank(b) - this.rank(a) || a.name.localeCompare(b.name));
      this.voices = list;
      const keep = settings.voiceURI;
      voiceSel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'Best available';
      voiceSel.appendChild(def);
      for (const v of list) {
        const o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = `${v.name} (${v.lang})`;
        voiceSel.appendChild(o);
      }
      voiceSel.value = list.some((v) => v.voiceURI === keep) ? keep : '';
    },

    rank(v) {
      let r = 0;
      if (/premium|enhanced|natural/i.test(v.name)) r += 10;
      const i = PREFERRED.findIndex((p) => v.name.startsWith(p));
      if (i >= 0) r += 5 - i * 0.1;
      if (v.localService) r += 1;
      return r;
    },

    pick() {
      if (settings.voiceURI) {
        const v = this.voices.find((x) => x.voiceURI === settings.voiceURI);
        if (v) return v;
      }
      return this.voices[0] || null;
    },

    say(text) {
      if (!this.ok) return;
      const synth = window.speechSynthesis;
      // Only cut off our own cue if it is still talking. iOS often reports
      // speaking for a moment after a cue ends, and cancel() right before
      // speak() clips the next cue.
      if (this.talking) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pick();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = 0.82;
      u.pitch = 0.92;
      u.volume = settings.volume;
      const token = (this.token = (this.token || 0) + 1);
      this.talking = true;
      const done = () => {
        if (token !== this.token) return;
        this.talking = false;
        const fns = this.waiting;
        this.waiting = [];
        fns.forEach((fn) => fn());
      };
      u.onend = done;
      u.onerror = done;
      // iOS sometimes never fires onend, so don't wait forever.
      setTimeout(done, 2500);
      this.waiting = [];
      // Pause web audio completely while the voice talks. On iPhone a running
      // audio context, even a silent one, breaks up speech.
      audio.quiet();
      synth.speak(u);
    },

    talking: false,
    waiting: [],
    busy() { return this.ok && this.talking; },
    // Run fn once the current cue has been spoken.
    after(fn) {
      if (this.busy()) this.waiting.push(fn);
      else fn();
    },

    stop() {
      this.token = (this.token || 0) + 1;
      this.talking = false;
      this.waiting = [];
      if (this.ok) window.speechSynthesis.cancel();
    },
  };

  // ---------- Keep the screen awake ----------
  const wake = {
    lock: null,
    async on() {
      try {
        if ('wakeLock' in navigator && !this.lock) {
          this.lock = await navigator.wakeLock.request('screen');
          this.lock.addEventListener('release', () => { this.lock = null; });
        }
      } catch (e) { this.lock = null; }
    },
    off() { try { if (this.lock) this.lock.release(); } catch (e) { /* ignore */ } this.lock = null; },
  };

  // ---------- Session engine ----------
  const run = {
    mode: 'idle', // idle | running | paused | done
    phase: 0,
    phaseStart: 0, // performance.now() when the current phase began
    phaseDur: 0, // seconds
    elapsedBefore: 0, // ms of session time before the last resume
    resumedAt: 0,
    breaths: 0,
  };

  const now = () => performance.now();
  const sessionMs = () => run.elapsedBefore + (run.mode === 'running' ? now() - run.resumedAt : 0);
  const usesVoice = () => settings.cue === 'voice' || settings.cue === 'both';
  const usesBreath = () => settings.cue === 'breath' || settings.cue === 'both';

  function nextPhase(i) {
    for (let step = 1; step <= 4; step++) {
      const j = (i + step) % 4;
      if (settings[KEYS[j]] > 0) return j;
    }
    return 0;
  }

  function enterPhase(i, at) {
    run.phase = i;
    run.phaseStart = at;
    run.phaseDur = settings[KEYS[i]];
    const p = PHASES[i];
    cueWord.textContent = p.word;
    const airy = usesBreath() && (p.key === 'inhale' || p.key === 'exhale');
    if (!airy) audio.hush();
    if (usesVoice()) {
      // Voice first, then the breath sound over the rest of the phase. Speech and
      // Web Audio fight over the iPhone's audio when they start together.
      speech.say(p.say);
      if (airy) {
        const phaseAt = run.phaseStart;
        speech.after(() => {
          if (run.mode !== 'running' || run.phaseStart !== phaseAt) return;
          const left = run.phaseDur - (now() - phaseAt) / 1000;
          if (left > 0.8) audio.breath(p.key, left);
        });
      }
    } else if (airy) {
      audio.breath(p.key, run.phaseDur);
    }
  }

  function begin() {
    // Everything that needs a tap to unlock on iOS happens right here, inside the tap.
    if (settings.cue !== 'silent') audio.ensure();
    if (run.mode === 'idle' || run.mode === 'done') {
      run.elapsedBefore = 0;
      run.breaths = 0;
    }
    run.mode = 'running';
    run.resumedAt = now();
    enterPhase(0, run.resumedAt);
    wake.on();
    render();
  }

  function pause() {
    run.elapsedBefore = sessionMs();
    run.mode = 'paused';
    speech.stop();
    audio.hush();
    wake.off();
    cueWord.textContent = 'Paused';
    cueCount.textContent = `${run.breaths} ${run.breaths === 1 ? 'breath' : 'breaths'} so far`;
    render();
  }

  function finish(early) {
    const breaths = run.breaths;
    const mins = Math.max(1, Math.round(sessionMs() / 60000));
    run.elapsedBefore = sessionMs();
    run.mode = 'done';
    audio.hush();
    wake.off();
    if (!early) {
      if (usesVoice()) {
        speech.say('That is the end of your session');
        speech.after(() => { audio.wake(); audio.chime(); });
      } else {
        speech.stop();
        if (settings.cue !== 'silent') audio.chime();
      }
    } else {
      speech.stop();
    }
    cueWord.textContent = early ? 'Session ended' : 'Session complete';
    cueCount.textContent = `${breaths} ${breaths === 1 ? 'breath' : 'breaths'} · ${mins} min`;
    render();
  }

  function tick() {
    if (run.mode !== 'running') return;
    const t = now();
    let guard = 0;
    while (t - run.phaseStart >= run.phaseDur * 1000 && guard++ < 8) {
      const end = run.phaseStart + run.phaseDur * 1000;
      const j = nextPhase(run.phase);
      if (j <= run.phase) {
        run.breaths += 1;
        const target = settings.minutes * 60000;
        if (settings.minutes > 0 && sessionMs() >= target - 250) { finish(false); return; }
      }
      // If the app stalled, start fresh rather than replaying missed phases.
      enterPhase(j, t - end > 1000 ? t : end);
    }
    const left = Math.max(0, run.phaseDur - (t - run.phaseStart) / 1000);
    cueCount.textContent = String(Math.ceil(left - 0.05));
    updateClock();
  }

  function breathLevel() {
    if (run.mode !== 'running') return run.mode === 'idle' || run.mode === 'done' ? 0.28 : 0.12;
    const p = Math.min(1, (now() - run.phaseStart) / (run.phaseDur * 1000));
    const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
    switch (KEYS[run.phase]) {
      case 'inhale': return ease(p);
      case 'hold1': return 1;
      case 'exhale': return 1 - ease(p);
      default: return 0;
    }
  }
  function phaseProgress() {
    if (run.mode !== 'running') return 0;
    return Math.min(1, (now() - run.phaseStart) / (run.phaseDur * 1000));
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function updateClock() {
    if (run.mode === 'idle') {
      clock.textContent = settings.minutes ? `${settings.minutes} min` : 'Open session';
      return;
    }
    if (run.mode === 'done') { clock.textContent = 'Done'; return; }
    const ms = sessionMs();
    const left = settings.minutes * 60000 - ms;
    if (!settings.minutes) clock.textContent = fmtClock(ms);
    else clock.textContent = left > 0 ? `${fmtClock(left)} left` : 'Last breath';
  }

  // ---------- Drawing ----------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const colors = { inhale: [63, 132, 120], exhale: [109, 112, 166], hold: [154, 134, 90], ink: [31, 53, 50], soft: [90, 112, 107] };
  const tint = { cur: [63, 132, 120] };

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const hex = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim();
      const m = /^#([0-9a-f]{6})$/i.exec(v);
      if (!m) return fallback;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    colors.inhale = hex('--inhale', colors.inhale);
    colors.exhale = hex('--exhale', colors.exhale);
    colors.hold = hex('--hold', colors.hold);
    colors.ink = hex('--ink', colors.ink);
    colors.soft = hex('--ink-soft', colors.soft);
  }

  let cw = 0, ch = 0, dpr = 1;
  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cw = canvas.clientWidth;
    ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function draw(t) {
    if (!cw || !ch) return;
    const g = ctx2d;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const cx = cw / 2;
    const cy = ch / 2;
    const R = Math.min(cw, ch) * 0.44;
    const level = breathLevel();
    const scale = 0.42 + 0.58 * level;

    // Ease the tint toward the color of the current phase.
    const tone = run.mode === 'running' ? PHASES[run.phase].tone : 'inhale';
    const want = colors[tone];
    for (let k = 0; k < 3; k++) tint.cur[k] += (want[k] - tint.cur[k]) * 0.05;
    const c = tint.cur;

    // Guide ring at full breath, and the phase progress along it.
    g.lineWidth = 1;
    g.strokeStyle = rgba(colors.soft, 0.28);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    const prog = phaseProgress();
    if (prog > 0) {
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.strokeStyle = rgba(c, 0.85);
      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
      g.stroke();
    }

    // Layered, slowly shifting rings that grow with the breath.
    const still = reduceMotion.matches;
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const rr = R * scale * (1 - i * 0.15);
      const amp = still ? 0 : 0.022 * (1 + i * 0.35);
      const s1 = t * 0.00035 * (1 + i * 0.18) + i * 1.3;
      const s2 = -t * 0.00027 * (1 + i * 0.12) + i * 2.1;
      g.beginPath();
      const steps = 90;
      for (let k = 0; k <= steps; k++) {
        const th = (k / steps) * Math.PI * 2;
        const r = rr * (1 + amp * (0.6 * Math.sin(3 * th + s1) + 0.4 * Math.sin(5 * th + s2)));
        const x = cx + r * Math.cos(th);
        const y = cy + r * Math.sin(th);
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = rgba(c, 0.07 + i * 0.045);
      g.fill();
    }
  }

  function frame(t) {
    tick();
    draw(t);
    requestAnimationFrame(frame);
  }

  // ---------- UI ----------
  function render() {
    app.dataset.mode = run.mode;
    mainBtn.textContent = { idle: 'Begin', running: 'Pause', paused: 'Resume', done: 'Begin again' }[run.mode];
    adjustBtn.textContent = run.mode === 'running' || run.mode === 'paused' ? 'End' : 'Adjust';
    adjustBtn.setAttribute('aria-controls', run.mode === 'running' || run.mode === 'paused' ? '' : 'sheet');
    if (run.mode === 'idle') {
      cueWord.textContent = 'Ready when you are';
      cueCount.textContent = presetLabel();
    }
    updateClock();
  }

  function renderSettings() {
    settings.preset = matchPreset();
    document.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.preset === settings.preset));
    });
    $('p-custom').hidden = settings.preset !== 'custom';
    $('pattern').textContent = patternText();
    $('bpm').textContent = bpmText();
    for (const k of KEYS) {
      const el = $(`s-${k}`);
      el.value = settings[k];
      $(`o-${k}`).textContent = `${fmtSec(settings[k])} s`;
      paintFill(el);
    }
    const vol = $('s-volume');
    vol.value = settings.volume;
    $('o-volume').textContent = `${Math.round(settings.volume * 100)}%`;
    paintFill(vol);
    const br = $('s-breath');
    br.value = settings.breath;
    $('o-breath').textContent = `${Math.round(settings.breath * 100)}%`;
    paintFill(br);
    $('breathField').hidden = !usesBreath();
    document.querySelectorAll('#lengthSeg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.min) === settings.minutes)));
    document.querySelectorAll('#cueSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cue === settings.cue)));
    voiceField.hidden = !speech.ok || !usesVoice();
    if (run.mode === 'idle') render();
  }

  function paintFill(el) {
    const min = Number(el.min), max = Number(el.max), v = Number(el.value);
    el.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
  }

  function openSheet() {
    scrim.hidden = false;
    sheet.hidden = false;
    $('doneBtn').focus({ preventScroll: true });
  }
  function closeSheet() {
    scrim.hidden = true;
    sheet.hidden = true;
    adjustBtn.focus({ preventScroll: true });
  }

  mainBtn.addEventListener('click', () => {
    if (run.mode === 'running') pause();
    else begin();
  });
  adjustBtn.addEventListener('click', () => {
    if (run.mode === 'running' || run.mode === 'paused') finish(true);
    else openSheet();
  });
  $('doneBtn').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b || b.dataset.preset === 'custom') return;
    Object.assign(settings, PRESETS[b.dataset.preset]);
    delete settings.name;
    saveSettings();
    renderSettings();
  });

  for (const k of KEYS) {
    $(`s-${k}`).addEventListener('input', (e) => {
      settings[k] = Number(e.target.value);
      saveSettings();
      renderSettings();
    });
  }
  $('s-volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value);
    audio.setVolume(settings.volume);
    saveSettings();
    renderSettings();
  });
  $('s-breath').addEventListener('input', (e) => {
    settings.breath = Number(e.target.value);
    saveSettings();
    renderSettings();
  });
  $('lengthSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.minutes = Number(b.dataset.min);
    saveSettings();
    renderSettings();
  });
  $('cueSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.cue = b.dataset.cue;
    if (settings.cue !== 'silent') audio.ensure();
    if (!usesBreath()) audio.hush();
    if (!usesVoice()) speech.stop();
    saveSettings();
    renderSettings();
  });
  voiceSel.addEventListener('change', () => {
    settings.voiceURI = voiceSel.value;
    saveSettings();
    speech.say('Breathe in');
  });
  $('sampleBtn').addEventListener('click', () => {
    audio.ensure();
    if (settings.cue === 'silent') { speech.say('Cues are set to silent'); return; }
    if (usesVoice()) speech.say('Breathe in');
    if (usesBreath()) {
      if (usesVoice()) speech.after(() => audio.breath('inhale', 3.5));
      else audio.breath('inhale', 3.5);
    }
  });

  // Pause when the app goes to the background; timers and audio stop there anyway.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && run.mode === 'running') pause();
  });

  if (speech.ok) {
    speech.load();
    if ('onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', () => speech.load());
    }
    // Some browsers fill the voice list late without firing the event.
    setTimeout(() => speech.load(), 1200);
  }

  // Follow light and dark changes.
  readColors();
  tint.cur = colors.inhale.slice();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
  if ('ResizeObserver' in window) new ResizeObserver(sizeCanvas).observe(canvas);

  renderSettings();
  render();
  requestAnimationFrame(frame);

  // Offline support when served over https.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => { /* preview frames do not allow it */ });
      // When an update takes over, reload once so the new version shows right away.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded || run.mode === 'running') return;
        reloaded = true;
        location.reload();
      });
    });
  }

  const tag = $('buildTag');
  if (tag) tag.textContent = `Version ${APP_VERSION}`;

  // Exposed for testing only.
  window.__breath = { settings, run, PRESETS, cycleSeconds, matchPreset, bpmText, patternText };
})();
