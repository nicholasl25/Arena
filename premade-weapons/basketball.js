/**
 * Basketball — slingshot variant that fires fighter-colored basketballs.
 * Inherits slingshot kind behavior (loaded after slingshot.js).
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    PremadeWeaponRegistry.register('basketball', 'BASKETBALL', {
        name: 'Basketball',
        icon: 'premade-weapons/sprites/Basketball.png',
        weaponKind: 'slingshot',
        projectileKind: 'basketball',
        projectileRadius: 12,
        weaponDamage: 11,
        spinSpeed: 5.5,
        shootInterval: 1.65,
        arrowSpeed: 380,
        bowLength: 30,
        knockbackScale: 1.15,
        bio: 'Launches basketballs.',
        projectileDraw(ctx, arrow, h) {
            const spin = Math.atan2(arrow.vy || 0, arrow.vx || 0);
            h.drawBasketball(ctx, h.cx, h.cy, h.ballR, h.dpr, arrow.color || '#c45c14', spin);
        },
    });
}());
