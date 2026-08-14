/**
 * Sword — long reach, heavy hits, slow spin. Uses default blade behavior.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    PremadeWeaponRegistry.register('sword', 'SWORD', {
        name: 'Sword',
        icon: 'premade-weapons/sprites/Sword.png',
        weaponDamage: 15,
        spinSpeed: 2.75,
        swordLength: 64,
        knockbackScale: 1.4,
        bladeWidthScale: 1.2,
        bio: 'Long heavy blade.',
    });
}());
