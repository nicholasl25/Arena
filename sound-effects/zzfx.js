/**
 * ZzFX - Zuper Zmall Zound Zynth v1.3.0 by Frank Force
 * https://github.com/KilledByAPixel/ZzFX
 *
 * Global build for classic <script> tags (no ES modules).
 * Exposes: window.zzfx, window.ZZFX
 *
 * MIT License — Copyright (c) 2019 Frank Force
 */
'use strict';

function zzfx(...parameters) {
    return ZZFX.play(...parameters);
}

const ZZFX = {
    volume: 0.3,
    sampleRate: 44100,
    x: null,

    ensureContext() {
        if (!this.x) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            this.x = new AudioCtx();
        }
        return this.x;
    },

    play(...parameters) {
        return this.playSamples(this.buildSamples(...parameters));
    },

    playSamples(...samples) {
        const audio = this.ensureContext();
        if (!audio || !samples[0]?.length) return null;

        const buffer = audio.createBuffer(samples.length, samples[0].length, this.sampleRate);
        const source = audio.createBufferSource();
        samples.forEach((d, i) => buffer.getChannelData(i).set(d));
        source.buffer = buffer;
        source.connect(audio.destination);
        source.start();
        return source;
    },

    buildSamples(
        volume = 1,
        randomness = 0.05,
        frequency = 220,
        attack = 0,
        sustain = 0,
        release = 0.1,
        shape = 0,
        shapeCurve = 1,
        slide = 0,
        deltaSlide = 0,
        pitchJump = 0,
        pitchJumpTime = 0,
        repeatTime = 0,
        noise = 0,
        modulation = 0,
        bitCrush = 0,
        delay = 0,
        sustainVolume = 1,
        decay = 0,
        tremolo = 0,
        filter = 0,
    ) {
        let PI2 = Math.PI * 2;
        const sign = (v) => (v < 0 ? -1 : 1);
        const sampleRate = this.sampleRate;
        let startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate);
        let startFrequency = (frequency *=
            (1 + randomness * 2 * Math.random() - randomness) * PI2 / sampleRate);
        const b = [];
        let t = 0;
        let tm = 0;
        let i = 0;
        let j = 1;
        let r = 0;
        let c = 0;
        let s = 0;
        let f;
        let length;

        const quality = 2;
        const w = (PI2 * Math.abs(filter) * 2) / sampleRate;
        const cos = Math.cos(w);
        const alpha = Math.sin(w) / 2 / quality;
        const a0 = 1 + alpha;
        const a1 = (-2 * cos) / a0;
        const a2 = (1 - alpha) / a0;
        const b0 = (1 + sign(filter) * cos) / 2 / a0;
        const b1 = -(sign(filter) + cos) / a0;
        const b2 = b0;
        let x2 = 0;
        let x1 = 0;
        let y2 = 0;
        let y1 = 0;

        attack = attack * sampleRate + 9;
        decay *= sampleRate;
        sustain *= sampleRate;
        release *= sampleRate;
        delay *= sampleRate;
        deltaSlide *= (500 * PI2) / sampleRate ** 3;
        modulation *= PI2 / sampleRate;
        pitchJump *= PI2 / sampleRate;
        pitchJumpTime *= sampleRate;
        repeatTime = (repeatTime * sampleRate) | 0;
        volume *= this.volume;

        for (
            length = (attack + decay + sustain + release + delay) | 0;
            i < length;
            b[i++] = s * volume
        ) {
            if (!(++c % ((bitCrush * 100) | 0))) {
                s = shape
                    ? shape > 1
                        ? shape > 2
                            ? shape > 3
                                ? Math.sin(t * t)
                                : Math.max(Math.min(Math.tan(t), 1), -1)
                            : 1 - (((2 * t) / PI2) % 2 + 2) % 2
                        : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
                    : Math.sin(t);

                s =
                    (repeatTime
                        ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime)
                        : 1) *
                    sign(s) *
                    Math.abs(s) ** shapeCurve *
                    (i < attack
                        ? i / attack
                        : i < attack + decay
                          ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
                          : i < attack + decay + sustain
                            ? sustainVolume
                            : i < length - delay
                              ? ((length - i - delay) / release) * sustainVolume
                              : 0);

                s = delay
                    ? s / 2 +
                      (delay > i
                          ? 0
                          : (i < length - delay ? 1 : (length - i) / delay) *
                            b[(i - delay) | 0] /
                            2 /
                            volume)
                    : s;

                if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
            }

            f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
            t += f + f * noise * Math.sin(i ** 5);

            if (j && ++j > pitchJumpTime) {
                frequency += pitchJump;
                startFrequency += pitchJump;
                j = 0;
            }

            if (repeatTime && !(++r % repeatTime)) {
                frequency = startFrequency;
                slide = startSlide;
                j = j || 1;
            }
        }

        return b;
    },

    getNote(semitoneOffset = 0, rootNoteFrequency = 440) {
        return rootNoteFrequency * 2 ** (semitoneOffset / 12);
    },
};

window.zzfx = zzfx;
window.ZZFX = ZZFX;
