/**
 * Speed — faster orbit spin and fire / hit rate
 * (slightly less when the weapon already has both melee and ranged threat).
 */
(function () {
    'use strict';

    PremadePowerupRegistry.register('speed-i', 'SPEED_I', {
        name: 'Speed I',
        icon: 'premade-powerups/sprites/Speed.png',
        color: '#2563eb',
        speedMult: 1.75,
        hybridSpeedMult: 1.33,
        wheelWeight: 10,
        bio: 'Faster swings and shots.',
    });

    PremadePowerupRegistry.register('speed-ii', 'SPEED_II', {
        name: 'Speed II',
        icon: 'premade-powerups/sprites/Speed.png',
        color: '#1d4ed8',
        speedMult: 2.25,
        hybridSpeedMult: 1.6,
        wheelWeight: 5,
        bio: 'Much faster swings and shots.',
    });
}());
