/**
 * Wizard Staff — melee pole that also looses plasma orbs.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinAndShoot } = PremadeWeaponRegistry.helpers;

    PremadeWeaponRegistry.register('staff', 'STAFF', {
        name: 'Wizard Staff',
        icon: 'premade-weapons/sprites/Staff.png',
        weaponKind: 'staff',
        weaponDamage: 8,
        projectileDamage: 22,
        spinSpeed: 3.4,
        swordLength: 48,
        shootInterval: 1.55,
        arrowSpeed: 210,
        knockbackScale: 1.05,
        bladeWidthScale: 3.25,
        bio: 'Pole and plasma orbs.',
        projectileKind: 'plasma',
        projectileDraw(ctx, arrow, h) {
            h.drawPlasmaOrb(ctx, h.cx, h.cy, h.ballR, h.dpr, arrow.color || '#888');
        },
        behavior: {
            shootsProjectiles() {
                return true;
            },
            step(ball, dt) {
                spinAndShoot(ball, dt);
            },
            buildProjectile(owner) {
                return {
                    kind: owner.projectileKind || 'plasma',
                    radius: owner.projectileRadius ?? 12,
                    bounceWalls: false,
                    spawnOffset: owner.radius + 2 + (owner.swordLength || 0),
                };
            },
            draw(ctx, ball, h) {
                if (!ball.getSwordSegment) return;
                const seg = ball.getSwordSegment();
                const charge = ball.shootInterval > 0
                    ? (ball._shootTimer ?? 0) / ball.shootInterval
                    : 0;
                h.drawStaff(
                    ctx,
                    h.toX(seg.x1),
                    h.toY(seg.y1),
                    h.toX(seg.x2),
                    h.toY(seg.y2),
                    h.scale,
                    h.dpr,
                    ball.bladeWidthScale ?? 1,
                    charge,
                    ball.color,
                );
            },
        },
    });
}());
