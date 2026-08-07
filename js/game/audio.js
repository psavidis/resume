// Procedural audio: tribal/jungle-flavoured soundtrack + SFX, generated with the
// Web Audio API so the page ships no copyrighted (or any) sound files.
//
// The music is a small generative engine: a looping bongo/tom pattern, a bass
// ostinato and a pentatonic marimba melody, all scheduled a beat ahead of time
// on the audio clock so timing does not drift with the render loop.

const PENTATONIC = [0, 3, 5, 7, 10]; // minor pentatonic, in semitones

const noteToFreq = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);

export class GameAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.started = false;
        this.muted = false;
        this._nextNoteTime = 0;
        this._step = 0;
        this._timer = null;
        this._noiseBuffer = null;
    }

    // Browsers require a user gesture before audio can start.
    start() {
        if (this.started) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;

        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.32;
        this.musicGain.connect(this.master);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.55;
        this.sfxGain.connect(this.master);

        this._noiseBuffer = this._makeNoiseBuffer();
        this.started = true;

        this._nextNoteTime = this.ctx.currentTime + 0.1;
        this._timer = setInterval(() => this._scheduler(), 25);
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.master) {
            this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
        }
        return this.muted;
    }

    _makeNoiseBuffer() {
        const len = this.ctx.sampleRate * 1.0;
        const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    // ---- music engine -----------------------------------------------------

    _scheduler() {
        if (!this.ctx) return;
        const tempo = 104; // bpm
        const stepDur = 60 / tempo / 2; // eighth notes

        // Schedule every step that falls inside the next 100ms lookahead.
        while (this._nextNoteTime < this.ctx.currentTime + 0.1) {
            this._playStep(this._step, this._nextNoteTime, stepDur);
            this._nextNoteTime += stepDur;
            this._step = (this._step + 1) % 32;
        }
    }

    _playStep(step, time, stepDur) {
        const bar = Math.floor(step / 8);

        // Bongos: a syncopated jungle pattern, accented on the off-beats.
        const bongoPattern = [1, 0, 0.5, 0.7, 0, 0.6, 0.9, 0.3];
        const hit = bongoPattern[step % 8];
        if (hit > 0) this._bongo(time, hit, step % 16 === 0 ? 210 : 320);

        // Low tom on the downbeat of every bar, doubled at the turnaround.
        if (step % 8 === 0) this._bongo(time, 1.0, 110, 0.28);
        if (step === 30) this._bongo(time + stepDur * 0.5, 0.8, 140, 0.24);

        // Bass ostinato: root - root - fifth - flat-seventh, one note per bar.
        const bassRoots = [-24, -24, -17, -14];
        if (step % 8 === 0) this._bass(time, noteToFreq(bassRoots[bar]), stepDur * 7);

        // Marimba melody on a minor pentatonic; the phrase shifts each bar so the
        // loop does not feel like a two-second sample on repeat.
        const melodyMask = [1, 0, 1, 1, 0, 1, 0, 1];
        if (melodyMask[step % 8]) {
            const degree = PENTATONIC[(step * 3 + bar * 2) % PENTATONIC.length];
            const octave = (step % 16 < 8) ? 0 : 12;
            this._marimba(time, noteToFreq(degree + octave - 5), stepDur * 1.6);
        }

        // Shaker on every step, quieter on the beat, for a constant groove bed.
        this._shaker(time, step % 2 === 0 ? 0.05 : 0.11);
    }

    _bongo(time, velocity, freq, decay = 0.18) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.55, time + decay);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.5 * velocity, time + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
        osc.connect(gain).connect(this.musicGain);
        osc.start(time);
        osc.stop(time + decay + 0.05);
    }

    _bass(time, freq, dur) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.42, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        osc.connect(filter).connect(gain).connect(this.musicGain);
        osc.start(time);
        osc.stop(time + dur + 0.05);
    }

    _marimba(time, freq, dur) {
        // Two detuned sines plus a hard attack transient reads as "wooden mallet".
        [1, 2.01].forEach((mult, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq * mult;
            const peak = i === 0 ? 0.22 : 0.07;
            gain.gain.setValueAtTime(0.0001, time);
            gain.gain.exponentialRampToValueAtTime(peak, time + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
            osc.connect(gain).connect(this.musicGain);
            osc.start(time);
            osc.stop(time + dur + 0.05);
        });
    }

    _shaker(time, velocity) {
        const src = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        src.buffer = this._noiseBuffer;
        filter.type = 'highpass';
        filter.frequency.value = 6000;
        gain.gain.setValueAtTime(velocity, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        src.connect(filter).connect(gain).connect(this.musicGain);
        src.start(time, Math.random() * 0.5, 0.06);
    }

    // ---- sound effects ----------------------------------------------------

    _sfxEnvelope(time, dur, peak = 0.5) {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        gain.connect(this.sfxGain);
        return gain;
    }

    jump() {
        if (!this.started) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(760, t + 0.12);
        osc.connect(this._sfxEnvelope(t, 0.16, 0.18));
        osc.start(t);
        osc.stop(t + 0.2);
    }

    spin() {
        if (!this.started) return;
        const t = this.ctx.currentTime;
        // Whoosh: filtered noise sweeping upward.
        const src = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        src.buffer = this._noiseBuffer;
        filter.type = 'bandpass';
        filter.Q.value = 6;
        filter.frequency.setValueAtTime(500, t);
        filter.frequency.exponentialRampToValueAtTime(3000, t + 0.3);
        // Bandpassed noise loses a lot of energy, so this needs a hotter
        // envelope than the tonal effects to sit at the same apparent level.
        src.connect(filter).connect(this._sfxEnvelope(t, 0.32, 0.9));
        src.start(t);
        src.stop(t + 0.35);
    }

    crateBreak() {
        if (!this.started) return;
        const t = this.ctx.currentTime;
        // Splintering wood: a noise burst plus a few random low clacks.
        const src = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        src.buffer = this._noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = 1400;
        filter.Q.value = 1.2;
        src.connect(filter).connect(this._sfxEnvelope(t, 0.25, 0.5));
        src.start(t);
        src.stop(t + 0.3);

        for (let i = 0; i < 4; i++) {
            const osc = this.ctx.createOscillator();
            const at = t + Math.random() * 0.09;
            osc.type = 'square';
            osc.frequency.value = 120 + Math.random() * 260;
            osc.connect(this._sfxEnvelope(at, 0.07, 0.14));
            osc.start(at);
            osc.stop(at + 0.1);
        }
    }

    pickup(index = 0) {
        if (!this.started) return;
        const t = this.ctx.currentTime;
        // Rising arpeggio; the index climbs the scale so streaks sound rewarding.
        const base = noteToFreq(PENTATONIC[index % PENTATONIC.length] + 7);
        [1, 1.5, 2].forEach((mult, i) => {
            const osc = this.ctx.createOscillator();
            const at = t + i * 0.045;
            osc.type = 'triangle';
            osc.frequency.value = base * mult;
            osc.connect(this._sfxEnvelope(at, 0.14, 0.28));
            osc.start(at);
            osc.stop(at + 0.18);
        });
    }

    fanfare() {
        if (!this.started) return;
        const t = this.ctx.currentTime;
        [0, 4, 7, 12].forEach((semi, i) => {
            const osc = this.ctx.createOscillator();
            const at = t + i * 0.1;
            osc.type = 'triangle';
            osc.frequency.value = noteToFreq(semi + 7);
            osc.connect(this._sfxEnvelope(at, 0.5, 0.3));
            osc.start(at);
            osc.stop(at + 0.55);
        });
    }
}
