/**
 * Slingshot — rotating slingshot that fires on a steady rhythm.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinAndShoot } = PremadeWeaponRegistry.helpers;

    PremadeWeaponRegistry.register('slingshot', 'SLINGSHOT', {
        name: 'Slingshot',
        icon: 'premade-weapons/sprites/Slingshot.png',
        weaponKind: 'slingshot',
        projectileKind: 'slingshot',
        weaponDamage: 10,
        spinSpeed: 6,
        shootInterval: 1.5,
        arrowSpeed: 420,
        bowLength: 30,
        knockbackScale: 0.95,
        bio: 'Fires pellets.',
        projectileDraw(ctx, arrow, h) {
            const spin = Math.atan2(arrow.vy || 0, arrow.vx || 0);
            h.drawSlingshotProjectile(ctx, h.cx, h.cy, h.ballR, h.dpr, arrow.color || '#888', spin);
        },
        behavior: {
            shootsProjectiles() {
                return true;
            },
            getHitSegments() {
                return [];
            },
            step(ball, dt) {
                spinAndShoot(ball, dt);
            },
            buildProjectile(owner) {
                return {
                    kind: owner.projectileKind || 'slingshot',
                    radius: owner.projectileRadius ?? 7.5,
                    bounceWalls: true,
                    spawnOffset: owner.radius + 10,
                };
            },
            draw(ctx, ball, h) {
                h.drawBow(ctx, ball, h.cx, h.cy, h.r, h.dpr);
            },
        },
    });
}());
