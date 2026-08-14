/**
 * Power — boosts weapon / projectile damage.
 */
(function () {
    'use strict';

    PremadePowerupRegistry.register('power-i', 'POWER_I', {
        name: 'Power I',
        icon: 'premade-powerups/sprites/Power.png',
        color: '#dc2626',
        damageMult: 1.5,
        wheelWeight: 10,
        bio: 'Hits harder.',
    });

    PremadePowerupRegistry.register('power-ii', 'POWER_II', {
        name: 'Power II',
        icon: 'premade-powerups/sprites/Power.png',
        color: '#b91c1c',
        damageMult: 2,
        wheelWeight: 5,
        bio: 'Hits much harder.',
    });
}());
