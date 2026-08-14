/**
 * Dagger — short blade, fast spin, light hits. Uses default blade behavior.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    PremadeWeaponRegistry.register('dagger', 'DAGGER', {
        name: 'Dagger',
        icon: 'premade-weapons/sprites/Sword.png',
        weaponDamage: 9,
        spinSpeed: 13,
        swordLength: 45,
        knockbackScale: 0.8,
        bladeWidthScale: 0.8,
        bio: 'Fast light blade.',
    });
}());
