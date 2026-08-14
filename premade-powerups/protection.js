/**
 * Protection — reduces incoming weapon / projectile damage.
 */
(function () {
    'use strict';

    PremadePowerupRegistry.register('protection-i', 'PROTECTION_I', {
        name: 'Protection I',
        icon: 'premade-powerups/sprites/Protection.png',
        color: '#64748b',
        damageTakenMult: 2 / 3,
        wheelWeight: 10,
        bio: 'Takes less damage.',
    });

    PremadePowerupRegistry.register('protection-ii', 'PROTECTION_II', {
        name: 'Protection II',
        icon: 'premade-powerups/sprites/Protection.png',
        color: '#475569',
        damageTakenMult: 0.5,
        wheelWeight: 5,
        bio: 'Takes much less damage.',
    });
}());
