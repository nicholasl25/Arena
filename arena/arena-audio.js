/**
 * Arena sound effects via Howler.js.
 * Depends: sound-effects/howler.min.js, sound-effects/zzfx.js (sample bake only)
 * Exposes: window.ArenaAudio
 *
 * SFX: ZzFX presets baked to WAV → Howl
 * Design presets at https://killedbyapixel.github.io/ZzFX/
 *
 * Offline capture: beginCapture() logs timed events on sim time, then
 * renderCaptureWav(durationSec) mixes them with OfflineAudioContext.
 */
(function () {
    'use strict';

    if (!window.Howl) {
        throw new Error('ArenaAudio: missing Howler (load sound-effects/howler.min.js first)');
    }

    let gestureGranted = false;
    let lastPlay = -Infinity;
    let lastTickPlay = -Infinity;
    const MIN_INTERVAL = 0.03;
    const MIN_TICK_INTERVAL = 0.008;
    const SAMPLE_RATE = 44100;

    const PRESETS = {
        // Hard sphere clack — mid punch, brief body, not a tinny click or bass thud.
        collision: [1.5, 0.02, 620, 0, 0.009, 0.05, 1, 3.2, -14, 0.12, 240, 0.02, 0, 0.18, 0, 0, 0, 0.34, 0.012],
        weaponHit: [1.4, 0.08, 520, 0, 0.04, 0.16, 3, 1.6, -7, 0.2, 0, 0, 0, 0.35, 0, 0.05, 0.02, 0.85, 0.05],
        weaponClash: [1.5, 0.1, 980, 0, 0.02, 0.14, 2, 2.2, -3, 0.4, 400, 0.04, 0, 0.55, 0, 0.02, 0.03, 0.9, 0.04],
        projectileDeflect: [1.3, 0.05, 1400, 0, 0.02, 0.1, 1, 1.8, -8, 0.3, 550, 0.03, 0, 0.4, 0, 0.02, 0.02, 0.8, 0.03],
        // Bright metallic parry — higher pitch + short ring so shield blocks read clearly.
        shieldDeflect: [1.7, 0.05, 1650, 0, 0.015, 0.22, 1, 2.6, -2, 0.55, 900, 0.06, 0.12, 0.7, 0, 0.015, 0.04, 0.95, 0.06],
        // Twangy string snap when a blade severs a web strand.
        webCut: [1.2, 0.04, 720, 0, 0.01, 0.18, 3, 2.4, -18, 0.4, 0, 0, 0.25, 0.85, 0, 0.08, 0.02, 0.7, 0.08],
        punch: [1.55, 0.04, 280, 0, 0.025, 0.09, 0, 2.2, -22, 0.25, 95, 0.035, 0, 0.18, 0, 0, 0.01, 0.5, 0.04],
        gloveClash: [1.35, 0.08, 420, 0, 0.012, 0.08, 3, 1.6, -10, 0.15, 0, 0, 0.05, 0.35, 0, 0.04, 0.015, 0.8, 0.03],
        // Heavy boom — deep thump, noisy blast body, long rumble tail.
        explosion: [3.5, 0.02, 42, 0.004, 0.28, 0.85, 4, 0.7, -22, 0.55, 0, 0, 0, 1.6, 0, 0.1, 0.22, 0.4, 0.06],
        // Prize-wheel peg click — short, bright, no tail.
        wheelTick: [0.85, 0, 780, 0, 0.001, 0.038, 0, 2.4, 6, 0.12, 220, 0.018, 0, 0.22, 0, 0, 0, 0.55, 0.012],
    };

    /** @type {Record<string, Howl>} */
    const sfx = {};
    /** @type {Record<string, string>} */
    const wavUris = {};
    let ready = false;

    let capturing = false;
    let captureClock = 0;
    /** @type {{ name: string, t: number, volume: number, rate: number }[]} */
    let captureEvents = [];
    /** @type {{ url: string, t: number, volume: number }[]} */
    let captureMusic = [];

    function writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    /** Encode mono float samples as a WAV data URI for Howler. */
    function samplesToWavUri(samples, sampleRate = SAMPLE_RATE) {
        const n = samples.length;
        const buffer = new ArrayBuffer(44 + n * 2);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + n * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, n * 2, true);

        let offset = 44;
        for (let i = 0; i < n; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            offset += 2;
        }

        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return `data:audio/wav;base64,${btoa(binary)}`;
    }

    function audioBufferToWavBase64(audioBuffer) {
        const numChannels = 1;
        const sampleRate = audioBuffer.sampleRate;
        const samples = audioBuffer.getChannelData(0);
        const n = samples.length;
        const buffer = new ArrayBuffer(44 + n * 2);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + n * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        view.setUint16(32, numChannels * 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, n * 2, true);

        let offset = 44;
        for (let i = 0; i < n; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            offset += 2;
        }

        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    function bakeZzfxHowl(params, volume = 1) {
        if (!window.ZZFX?.buildSamples) {
            throw new Error('ArenaAudio: missing ZZFX.buildSamples');
        }
        const baked = params.slice();
        baked[1] = 0;
        const samples = ZZFX.buildSamples(...baked);
        const uri = samplesToWavUri(samples, ZZFX.sampleRate || SAMPLE_RATE);
        return {
            uri,
            howl: new Howl({
                src: [uri],
                format: ['wav'],
                volume,
                preload: true,
            }),
        };
    }

    function initSfx() {
        for (const [name, preset] of Object.entries(PRESETS)) {
            const baked = bakeZzfxHowl(preset, 1);
            sfx[name] = baked.howl;
            wavUris[name] = baked.uri;
        }
    }

    function unlockHowler() {
        if (typeof Howler !== 'undefined') {
            Howler.mute(false);
            if (Howler.ctx && Howler.ctx.state === 'suspended') {
                Howler.ctx.resume();
            }
        }
    }

    function playSfx(name, impactSpeed) {
        if (!capturing && !gestureGranted) return;
        if (!ready) return;
        const howl = sfx[name];
        if (!howl) return;

        const speed = Math.max(impactSpeed || 0, 0);
        if (speed < 5) return;

        let now = capturing ? captureClock : performance.now() / 1000;
        if (now - lastPlay < MIN_INTERVAL) {
            if (!capturing) return;
            // Keep stacked hits in offline capture instead of dropping them.
            now = lastPlay + MIN_INTERVAL;
        }
        lastPlay = now;

        const t = Math.min(speed / 350, 1);
        let volume = 0.55 + t * 0.45;
        let rate = 0.92 + t * 0.2;
        if (name === 'explosion') {
            volume = Math.min(1, 0.92 + t * 0.08);
            rate = 0.72 + t * 0.1; // slower = heavier boom
        }

        if (capturing) {
            captureEvents.push({ name, t: now, volume, rate });
            return;
        }

        unlockHowler();
        const id = howl.play();
        howl.volume(volume, id);
        howl.rate(rate, id);
    }

    /** Call from a user gesture (click / tap / key). Safe to call repeatedly. */
    function unlock() {
        gestureGranted = true;
        unlockHowler();
    }

    function beginCapture() {
        capturing = true;
        captureClock = 0;
        captureEvents = [];
        captureMusic = [];
        lastPlay = -Infinity;
        lastTickPlay = -Infinity;
        gestureGranted = true;
    }

    function addCaptureMusic(url, startSec = 0, volume = 0.85) {
        if (!url) return;
        captureMusic.push({
            url,
            t: Math.max(0, Number(startSec) || 0),
            volume: Math.max(0, Math.min(1, Number(volume) || 0.85)),
        });
    }

    function setCaptureTime(seconds) {
        captureClock = Math.max(0, Number(seconds) || 0);
    }

    function endCapture() {
        capturing = false;
        return captureEvents.slice();
    }

    function getCaptureEvents() {
        return captureEvents.slice();
    }

    function getCaptureMusic() {
        return captureMusic.slice();
    }

    /** @type {Record<string, Promise<AudioBuffer>>} */
    const decodedBuffers = {};
    /** @type {Map<string, Promise<AudioBuffer>>} */
    const decodedMusic = new Map();

    async function decodeMusic(url, ctx) {
        if (!decodedMusic.has(url)) {
            decodedMusic.set(url, (async () => {
                const res = await fetch(url);
                const raw = await res.arrayBuffer();
                return ctx.decodeAudioData(raw.slice(0));
            })());
        }
        return decodedMusic.get(url);
    }

    async function decodePreset(name, ctx) {
        if (!wavUris[name]) throw new Error(`Unknown sfx: ${name}`);
        if (!decodedBuffers[name]) {
            decodedBuffers[name] = (async () => {
                const res = await fetch(wavUris[name]);
                const raw = await res.arrayBuffer();
                return ctx.decodeAudioData(raw.slice(0));
            })();
        }
        return decodedBuffers[name];
    }

    /**
     * Mix captured SFX onto a timeline and return WAV as base64 (no data: prefix).
     * @param {number} durationSec
     */
    async function renderCaptureWav(durationSec) {
        const duration = Math.max(0.05, Number(durationSec) || 0.05);
        const sampleRate = SAMPLE_RATE;
        const length = Math.ceil(duration * sampleRate);
        const ctx = new OfflineAudioContext(1, length, sampleRate);

        const events = captureEvents;
        for (const ev of events) {
            if (!wavUris[ev.name]) continue;
            const buffer = await decodePreset(ev.name, ctx);
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.value = ev.rate || 1;
            const gain = ctx.createGain();
            gain.gain.value = ev.volume ?? 1;
            src.connect(gain);
            gain.connect(ctx.destination);
            const startAt = Math.max(0, Math.min(duration - 0.001, ev.t || 0));
            src.start(startAt);
        }

        for (const track of captureMusic) {
            try {
                const buffer = await decodeMusic(track.url, ctx);
                const src = ctx.createBufferSource();
                src.buffer = buffer;
                const gain = ctx.createGain();
                gain.gain.value = track.volume ?? 0.85;
                src.connect(gain);
                gain.connect(ctx.destination);
                const startAt = Math.max(0, Math.min(duration - 0.001, track.t || 0));
                src.start(startAt);
            } catch {
                /* missing or unsupported music file */
            }
        }

        const rendered = await ctx.startRendering();
        return {
            wavBase64: audioBufferToWavBase64(rendered),
            eventCount: events.length,
            durationSec: duration,
            sampleRate,
        };
    }

    function playCollision(impactSpeed) {
        playSfx('collision', impactSpeed);
    }

    function playWeaponHit(impactSpeed) {
        playSfx('weaponHit', impactSpeed);
    }

    function playWeaponClash(impactSpeed) {
        playSfx('weaponClash', impactSpeed);
    }

    function playProjectileDeflect(impactSpeed) {
        playSfx('projectileDeflect', impactSpeed);
    }

    function playShieldDeflect(impactSpeed) {
        playSfx('shieldDeflect', impactSpeed);
    }

    function playWebCut(impactSpeed) {
        playSfx('webCut', impactSpeed);
    }

    function playPunch(impactSpeed) {
        playSfx('punch', impactSpeed);
    }

    function playGloveClash(impactSpeed) {
        playSfx('gloveClash', impactSpeed);
    }

    function playExplosion(impactSpeed) {
        playSfx('explosion', impactSpeed);
    }

    /** Sector tick for the powerup wheel. `intensity` 0..1 raises pitch/volume. */
    function playWheelTick(intensity) {
        if (!capturing && !gestureGranted) return;
        if (!ready) return;
        const howl = sfx.wheelTick;
        if (!howl) return;

        const t = Math.min(1, Math.max(0, Number(intensity) || 0));
        const volume = 0.28 + t * 0.34;
        const rate = 0.86 + t * 0.38;
        let now = capturing ? captureClock : performance.now() / 1000;
        if (capturing) {
            if (now <= lastTickPlay) now = lastTickPlay + 0.006;
            lastTickPlay = now;
            captureEvents.push({ name: 'wheelTick', t: now, volume, rate });
            return;
        }
        if (now - lastTickPlay < MIN_TICK_INTERVAL) return;
        lastTickPlay = now;
        unlockHowler();
        const id = howl.play();
        howl.volume(volume, id);
        howl.rate(rate, id);
    }

    initSfx();
    ready = true;

    window.ArenaAudio = {
        unlock,
        playCollision,
        playWeaponHit,
        playWeaponClash,
        playProjectileDeflect,
        playShieldDeflect,
        playWebCut,
        playPunch,
        playGloveClash,
        playExplosion,
        playWheelTick,
        beginCapture,
        addCaptureMusic,
        getCaptureMusic,
        setCaptureTime,
        endCapture,
        getCaptureEvents,
        renderCaptureWav,
        PRESETS,
    };
}());
