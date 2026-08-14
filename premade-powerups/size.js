/**
 * Size — larger weapons and projectiles.
 */
(function () {
    'use strict';

    PremadePowerupRegistry.register('size-i', 'SIZE_I', {
        name: 'Size I',
        icon: 'premade-powerups/sprites/Size.webp',
        color: '#d946ef',
        sizeMult: 1.35,
        wheelWeight: 10,
        bio: 'Bigger weapons and shots.',
    });

    PremadePowerupRegistry.register('size-ii', 'SIZE_II', {
        name: 'Size II',
        icon: 'premade-powerups/sprites/Size.webp',
        color: '#c026d3',
        sizeMult: 1.7,
        wheelWeight: 5,
        bio: 'Much bigger weapons and shots.',
    });
}());
