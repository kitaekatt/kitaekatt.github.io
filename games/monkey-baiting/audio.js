/* MONKEY BAITING — audio.js
   All procedural WebAudio: oscillators and noise buffers only. Texture, not
   noise — the mix sits low under the game. Context resumes on first gesture. */
(function (g) {
  'use strict';

  var A = {
    ctx: null, master: null, muted: false, ready: false,
    amb: {} // ambience nodes: gas, crowd, drone, rail
  };

  function ctx() { return A.ctx; }

  A.init = function () {
    if (A.ctx) return;
    var AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return; // no audio support: play() becomes a no-op, game runs silent
    A.ctx = new AC();
    A.master = A.ctx.createGain();
    A.master.gain.value = 0.7;
    A.master.connect(A.ctx.destination);
    A.noiseBuf = makeNoise(A.ctx, 2.0);
    A.ready = true;
  };

  A.resume = function () {
    if (!A.ctx) A.init();
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };

  A.toggleMute = function () {
    A.muted = !A.muted;
    if (A.master) A.master.gain.value = A.muted ? 0 : 0.7;
    return A.muted;
  };

  function makeNoise(c, secs) {
    var buf = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function noiseSource(loop) {
    var s = A.ctx.createBufferSource();
    s.buffer = A.noiseBuf;
    s.loop = !!loop;
    return s;
  }

  function envGain(t0, a, peak, dur) {
    var gn = A.ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    return gn;
  }

  // ---- ambience ------------------------------------------------------------

  // gas: constant filtered hiss. crowd: bandpassed murmur w/ slow LFO.
  // drone: low ominous osc (Aistrop). rail: creak handled as one-shots.
  A.startAmbience = function () {
    if (!A.ready || A.amb.gas) return;
    var c = A.ctx, t = c.currentTime;

    var gas = noiseSource(true);
    var gasF = c.createBiquadFilter(); gasF.type = 'highpass'; gasF.frequency.value = 5200;
    var gasG = c.createGain(); gasG.gain.value = 0.012;
    gas.connect(gasF); gasF.connect(gasG); gasG.connect(A.master);
    gas.start(t);
    A.amb.gas = { src: gas, gain: gasG, filter: gasF };

    var crowd = noiseSource(true);
    var crF = c.createBiquadFilter(); crF.type = 'bandpass'; crF.frequency.value = 320; crF.Q.value = 0.6;
    var crG = c.createGain(); crG.gain.value = 0.03;
    var lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    var lfoG = c.createGain(); lfoG.gain.value = 0.012;
    lfo.connect(lfoG); lfoG.connect(crG.gain);
    crowd.connect(crF); crF.connect(crG); crG.connect(A.master);
    crowd.start(t); lfo.start(t);
    A.amb.crowd = { src: crowd, gain: crG, base: 0.03 };

    var dr = c.createOscillator(); dr.type = 'sawtooth'; dr.frequency.value = 36.5;
    var dr2 = c.createOscillator(); dr2.type = 'sine'; dr2.frequency.value = 36.9;
    var drF = c.createBiquadFilter(); drF.type = 'lowpass'; drF.frequency.value = 120;
    var drG = c.createGain(); drG.gain.value = 0.0;
    dr.connect(drF); dr2.connect(drF); drF.connect(drG); drG.connect(A.master);
    dr.start(t); dr2.start(t);
    A.amb.drone = { gain: drG };
  };

  A.setCrowd = function (level) { // 0..1 excitement
    if (!A.amb.crowd) return;
    var v = 0.02 + level * 0.05;
    A.amb.crowd.base = v;
    A.amb.crowd.gain.gain.setTargetAtTime(v, A.ctx.currentTime, 0.6);
  };

  A.setDrone = function (on) {
    if (!A.amb.drone) return;
    A.amb.drone.gain.gain.setTargetAtTime(on ? 0.05 : 0.0, A.ctx.currentTime, 1.2);
  };

  A.setGas = function (level) { // gutter dip: 0..1
    if (!A.amb.gas) return;
    A.amb.gas.gain.gain.setTargetAtTime(0.004 + 0.008 * level, A.ctx.currentTime, 0.15);
  };

  // duck everything: finishers play in near-silence
  A.hush = function (seconds) {
    if (!A.ready) return;
    var t = A.ctx.currentTime;
    if (A.amb.crowd) {
      A.amb.crowd.gain.gain.cancelScheduledValues(t);
      A.amb.crowd.gain.gain.setTargetAtTime(0.002, t, 0.1);
      A.amb.crowd.gain.gain.setTargetAtTime(A.amb.crowd.base, t + seconds, 1.5);
    }
    if (A.amb.gas) {
      A.amb.gas.gain.gain.cancelScheduledValues(t);
      A.amb.gas.gain.gain.setTargetAtTime(0.0001, t, 0.05);
      A.amb.gas.gain.gain.setTargetAtTime(0.012, t + seconds, 1.0);
    }
  };

  A.crowdSwell = function (amount) { // quick roar on hit confirms
    if (!A.amb.crowd) return;
    var gp = A.amb.crowd.gain.gain, t = A.ctx.currentTime;
    gp.cancelScheduledValues(t);
    gp.setTargetAtTime(Math.min(0.14, A.amb.crowd.base + amount), t, 0.03);
    gp.setTargetAtTime(A.amb.crowd.base, t + 0.25, 0.8);
  };

  // ---- one-shots -----------------------------------------------------------

  function osc(type, f0, f1, dur, peak, t0) {
    var c = A.ctx;
    var o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    var gn = envGain(t0, 0.005, peak, dur);
    o.connect(gn); gn.connect(A.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noiseHit(filterType, freq, dur, peak, t0, q) {
    var c = A.ctx;
    var s = noiseSource(false);
    var f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    if (q) f.Q.value = q;
    var gn = envGain(t0, 0.003, peak, dur);
    s.connect(f); f.connect(gn); gn.connect(A.master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  var PLAYERS = {
    thud: function (t) { osc('sine', 110, 40, 0.14, 0.5, t); noiseHit('lowpass', 300, 0.1, 0.35, t); },
    swipe: function (t) { noiseHit('bandpass', 2400, 0.08, 0.18, t, 1.2); },
    whiff: function (t) { noiseHit('bandpass', 1200, 0.12, 0.1, t, 1.5); },
    bite: function (t) { osc('square', 300, 90, 0.06, 0.22, t); noiseHit('highpass', 1800, 0.06, 0.22, t); },
    cane: function (t) { osc('square', 900, 500, 0.04, 0.18, t); noiseHit('highpass', 3000, 0.05, 0.15, t); },
    block: function (t) { osc('sine', 180, 90, 0.08, 0.25, t); noiseHit('lowpass', 600, 0.06, 0.15, t); },
    chain: function (t) { // dry iron on iron, short
      for (var i = 0; i < 3; i++) {
        var tt = t + i * 0.035;
        noiseHit('highpass', 4200 + i * 800, 0.03, 0.12, tt, 2);
        osc('square', 2100 + i * 500, 1600, 0.025, 0.05, tt);
      }
    },
    chain_rigid: function (t) { noiseHit('highpass', 3500, 0.05, 0.2, t, 3); osc('square', 1400, 900, 0.09, 0.12, t); },
    coins: function (t) { // guineas on wood: sharp, bright, expensive
      for (var i = 0; i < 4; i++) {
        var tt = t + i * 0.05 + Math.random() * 0.02;
        osc('sine', 2600 + Math.random() * 1400, null, 0.09, 0.08, tt);
        osc('sine', 5200 + Math.random() * 1000, null, 0.05, 0.04, tt);
      }
    },
    coin_one: function (t) { osc('sine', 3000 + Math.random() * 800, null, 0.08, 0.07, t); },
    rats: function (t) { // scurrying: rapid granular ticks
      for (var i = 0; i < 14; i++) noiseHit('bandpass', 2600 + Math.random() * 2000, 0.02, 0.05, t + i * 0.05, 4);
    },
    scuff: function (t) { noiseHit('lowpass', 900, 0.05, 0.05, t); },
    crack: function (t) { // the rail, one loud CRACK
      noiseHit('lowpass', 1400, 0.2, 0.6, t);
      osc('square', 140, 50, 0.16, 0.3, t);
    },
    creak: function (t) { osc('sawtooth', 90, 60, 0.4, 0.05, t); },
    sting: function (t) { // SERVE HIM OUT!
      osc('sawtooth', 196, null, 0.3, 0.12, t);
      osc('sawtooth', 233, null, 0.3, 0.12, t + 0.02);
      osc('sawtooth', 98, null, 0.55, 0.15, t + 0.28);
      noiseHit('lowpass', 500, 0.4, 0.12, t + 0.28);
    },
    roar: function (t) { noiseHit('bandpass', 400, 0.7, 0.25, t, 0.5); },
    ko: function (t) { osc('sine', 70, 30, 0.5, 0.5, t); noiseHit('lowpass', 250, 0.4, 0.4, t); },
    gutter: function (t) { noiseHit('highpass', 5000, 0.5, 0.05, t); },
    slate: function (t) { noiseHit('highpass', 2200, 0.1, 0.12, t, 2); osc('square', 700, 400, 0.06, 0.06, t); }
  };

  A.play = function (name) {
    if (!A.ready || A.muted) return;
    var fn = PLAYERS[name];
    if (!fn) return;
    fn(A.ctx.currentTime);
  };

  g.MB = g.MB || {};
  g.MB.Audio = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})(typeof window !== 'undefined' ? window : globalThis);
