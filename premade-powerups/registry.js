/**
 * Premade powerup registry — optional per-ball ability modifiers.
 *
 * To add a powerup:
 *   1. Create premade-powerups/your-powerup.js that calls PremadePowerupRegistry.register(...)
 *   2. Include the script after registry.js (before index.js)
 */
(function () {
    'use strict';

    const PREMADE_POWERUPS = {};
    const PremadePowerupId = {};

    window.PremadePowerupRegistry = {
        /**
         * @param {string} id stable id (e.g. 'power-i')
         * @param {string} idKey constant key (e.g. 'POWER_I')
         * @param {object} spec
         * @param {string} spec.name
         * @param {string} [spec.icon] potion sprite path
         * @param {string} spec.color hex label tint
         * @param {string} [spec.bio]
         * @param {number} [spec.damageMult=1]
         * @param {number} [spec.speedMult=1] orbit + fire rate (+ hit cooldown)
         * @param {number} [spec.hybridSpeedMult] smaller speedMult when weapon has melee + range
         * @param {number} [spec.sizeMult=1] weapon reach / width + projectile radius
         * @param {number} [spec.damageTakenMult=1] incoming damage scale
         * @param {number} [spec.thornsReflectMult=0] fraction of damage taken reflected to attacker
         * @param {number} [spec.wheelWeight=0] relative slice size on the tournament powerup wheel
         */
        register(id, idKey, spec) {
            PremadePowerupId[idKey] = id;
            PREMADE_POWERUPS[id] = {
                damageMult: 1,
                speedMult: 1,
                sizeMult: 1,
                damageTakenMult: 1,
                thornsReflectMult: 0,
                wheelWeight: 0,
                icon: null,
                color: '#888888',
                bio: '',
                ...spec,
            };
        },

        getPremadePowerup(id) {
            return PREMADE_POWERUPS[id] || null;
        },

        getPremadePowerupId() {
            return PremadePowerupId;
        },

        getPremadePowerups() {
            return PREMADE_POWERUPS;
        },
    };
}());
