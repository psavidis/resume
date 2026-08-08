// Audio: SFX generated with the Web Audio API (so those ship no sound files),
// plus a per-island mp3 soundtrack that crossfades as the player crosses
// zones — see `playTrack`.

const PENTATONIC = [0, 3, 5, 7, 10]; // minor pentatonic, in semitones

const noteToFreq = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);

// Music fade timing, in seconds. Slow enough to read as a deliberate
// transition rather than a cut, but not so slow that fast island-hopping
// leaves two tracks audibly overlapping.
const MUSIC_FADE = 1.8;
const MUSIC_VOLUME = 0.55;

export class GameAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.sfxGain = null;
        this.started = false;
        this.muted = false;
        this._noiseBuffer = null;

        // Two <audio> elements so the outgoing track can fade out while the
        // incoming one fades in, rather than the sound cutting out and back.
        this._musicA = new Audio();
        this._musicB = new Audio();
        [this._musicA, this._musicB].forEach((el) => {
            el.loop = true;
            el.volume = 0;
            el.preload = 'auto';
        });
        this._activeMusic = this._musicA;
        this._currentTrackUrl = null;
        this._pendingTrack = null;
        this._replayingPending = false;
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

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.55;
        this.sfxGain.connect(this.master);

        this._noiseBuffer = this._makeNoiseBuffer();
        this.started = true;

        // A track may already have been requested (the player reached an
        // island before clicking "play with music"); start it now. The dedup
        // guard in playTrack would otherwise no-op this, since it already
        // recorded the URL as "current" when the request was queued.
        if (this._pendingTrack) {
            const { url } = this._pendingTrack;
            this._pendingTrack = null;
            this._replayingPending = true;
            this.playTrack(url);
            this._replayingPending = false;
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.master) {
            this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
        }
        // The music elements sit outside the WebAudio graph (playing an
        // <audio> tag through it needs a MediaElementSource, which is more
        // machinery than this needs), so muting them is a direct volume cut.
        [this._musicA, this._musicB].forEach((el) => { el.muted = this.muted; });
        return this.muted;
    }

    // Crossfades to `url` — the currently playing island's mp3 — fading the
    // previous track out and the new one in over MUSIC_FADE seconds. Passing
    // `null` fades out to silence (an island with no theme of its own).
    // Safe to call before `start()`: the request is queued and applied once
    // the user gesture arrives.
    playTrack(url) {
        // Calling with the same URL already committed is a no-op — except
        // right after start(), which replays a request queued before the
        // context existed: _currentTrackUrl was set at queue time but the
        // audio element was never actually touched, so that replay must go
        // through even though the URL "already matches".
        if (url === this._currentTrackUrl && !this._replayingPending) return;
        this._currentTrackUrl = url;

        if (!this.started) {
            this._pendingTrack = { url };
            return;
        }

        const outgoing = this._activeMusic;

        if (!url) {
            // Fade the current track to silence; nothing to fade in.
            this._fade(outgoing, 0, () => outgoing.pause());
            return;
        }

        const incoming = outgoing === this._musicA ? this._musicB : this._musicA;
        this._activeMusic = incoming;

        incoming.src = url;
        incoming.currentTime = 0;
        incoming.volume = 0;
        incoming.muted = this.muted;
        const playPromise = incoming.play();
        // Autoplay can still reject if this fires outside a gesture; a track
        // switch mid-game always follows the initial "play with music" click,
        // so this is a defensive no-op rather than an expected path.
        if (playPromise) playPromise.catch(() => {});

        if (outgoing !== incoming && !outgoing.paused) {
            this._fade(outgoing, 0, () => outgoing.pause());
        }
        this._fade(incoming, MUSIC_VOLUME);
    }

    // Ramps `el.volume` toward `target` over MUSIC_FADE seconds with a plain
    // interval — <audio> volume isn't a Web Audio param, so there's no
    // AudioParam ramp to lean on here. Cancels any fade already running on
    // this element first, so rapid island-hopping can't leave two timers
    // fighting over the same volume.
    _fade(el, target, onDone) {
        clearInterval(el._fadeTimer);
        const start = el.volume;
        const startTime = performance.now();
        const step = () => {
            const t = Math.min(1, (performance.now() - startTime) / (MUSIC_FADE * 1000));
            el.volume = start + (target - start) * t;
            if (t >= 1) {
                clearInterval(el._fadeTimer);
                if (onDone) onDone();
            }
        };
        el._fadeTimer = setInterval(step, 40);
        step();
    }

    _makeNoiseBuffer() {
        const len = this.ctx.sampleRate * 1.0;
        const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
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

    gunshot() {
        if (!this.started) return;
        const t = this.ctx.currentTime;
        // A sharp crack: a very short, hot noise burst through a wide-open
        // filter, plus a low thump under it for body — the opposite shape
        // from spin()'s slow rising sweep, since a gunshot is instantaneous.
        const src = this.ctx.createBufferSource();
        const filter = this.ctx.createBiquadFilter();
        src.buffer = this._noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value = 2200;
        filter.Q.value = 0.7;
        src.connect(filter).connect(this._sfxEnvelope(t, 0.09, 1.0));
        src.start(t);
        src.stop(t + 0.1);

        const thump = this.ctx.createOscillator();
        thump.type = 'square';
        thump.frequency.setValueAtTime(150, t);
        thump.frequency.exponentialRampToValueAtTime(60, t + 0.07);
        thump.connect(this._sfxEnvelope(t, 0.09, 0.5));
        thump.start(t);
        thump.stop(t + 0.1);
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
