/**
 * Thorns — reflects some damage taken back onto the attacker.
 */
(function () {
    'use strict';

    PremadePowerupRegistry.register('thorns-i', 'THORNS_I', {
        name: 'Thorns I',
        icon: 'premade-powerups/sprites/Thorns.png',
        color: '#16a34a',
        thornsReflectMult: 1 / 3,
        wheelWeight: 10,
        bio: 'Hurts attackers back.',
    });

    PremadePowerupRegistry.register('thorns-ii', 'THORNS_II', {
        name: 'Thorns II',
        icon: 'premade-powerups/sprites/Thorns.png',
        color: '#15803d',
        thornsReflectMult: 0.5,
        wheelWeight: 5,
        bio: 'Hurts attackers back harder.',
    });
}());