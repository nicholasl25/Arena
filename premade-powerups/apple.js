/**
 * Golden Apple / Enchanted Apple — every powerup at Lvl 1 / Lvl 2.
 */
(function () {
    'use strict';

    PremadePowerupRegistry.register('apple-i', 'APPLE_I', {
        name: 'Golden Apple',
        icon: 'premade-powerups/sprites/GoldenApple.webp',
        color: '#fbbf24',
        damageMult: 1.5,
        speedMult: 1.75,
        hybridSpeedMult: 1.33,
        sizeMult: 1.35,
        damageTakenMult: 2 / 3,
        thornsReflectMult: 1 / 3,
        wheelWeight: 10,
        bio: 'All Lvl 1 boosts.',
    });

    PremadePowerupRegistry.register('apple-ii', 'APPLE_II', {
        name: 'Enchanted Apple',
        icon: 'premade-powerups/sprites/EnchantedApple.gif',
        color: '#a855f7',
        damageMult: 2,
        speedMult: 2.25,
        hybridSpeedMult: 1.6,
        sizeMult: 1.7,
        damageTakenMult: 0.5,
        thornsReflectMult: 0.5,
        wheelWeight: 5,
        bio: 'All Lvl 2 boosts.',
    });
}());
