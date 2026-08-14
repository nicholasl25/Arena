/**
 * Premade ball registry — each ball file calls register() with its spec.
 * Depends: Ball
 */
(function () {
    'use strict';

    const PREMADE_BALLS = {};
    const PremadeBallId = {};

    window.PremadeBallRegistry = {
        /**
         * @param {string} id stable string id (e.g. 'multiplier')
         * @param {string} idKey constant key on PremadeBallId (e.g. 'MULTIPLIER')
         * @param {{ name: string, color: string, Cls: typeof Ball, radius: number, health: number, mass: number, fontName: string, bio: string }} spec
         */
        register(id, idKey, spec) {
            PremadeBallId[idKey] = id;
            PREMADE_BALLS[id] = spec;
        },

        getPremadeBall(id) {
            return PREMADE_BALLS[id] || null;
        },

        getPremadeBallId() {
            return PremadeBallId;
        },

        getPremadeBalls() {
            return PREMADE_BALLS;
        },
    };
}());
