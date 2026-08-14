/**
 * Bow & Arrow — rotates and looses high-damage arrows in a straight line (no bounce).
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinAndShoot } = PremadeWeaponRegistry.helpers;

    PremadeWeaponRegistry.register('bow', 'BOW', {
        name: 'Bow & Arrow',
        icon: 'premade-weapons/sprites/Bow-unloaded.png',
        weaponKind: 'bow',
        weaponDamage: 8,
        projectileDamage: 20,
        projectileKind: 'arrow',
        spinSpeed: 2.8,
        shootInterval: 1.15,
        arrowSpeed: 400,
        bowLength: 34,
        knockbackScale: 1.15,
        bio: 'Shoots arrows.',
        projectileDraw(ctx, arrow, h) {
            h.drawFlightArrow(ctx, arrow, h.scale, h.dpr);
        },
        behavior: {
            shootsProjectiles() {
                return true;
            },
            cutsWebs() {
                return false;
            },
            getHitSegments(ball) {
                // Melee from the radial nocked arrow (matches drawLongbow geometry).
                const cos = Math.cos(ball.weaponAngle);
                const sin = Math.sin(ball.weaponAngle);
                const stringR = ball.radius + 5;
                const tipR = stringR + 10 + ball.radius * 0.35;
                return [{
                    x1: ball.x + stringR * cos,
                    y1: ball.y + stringR * sin,
                    x2: ball.x + tipR * cos,
                    y2: ball.y + tipR * sin,
                    damage: ball.weaponDamage,
                }];
            },
            step(ball, dt) {
                spinAndShoot(ball, dt);
            },
            buildProjectile(owner) {
                return {
                    kind: 'arrow',
                    radius: 4.5,
                    bounceWalls: false,
                    spawnOffset: owner.radius + 12,
                    length: 36,
                    cutsWebs: true,
                };
            },
            draw(ctx, ball, h) {
                h.drawLongbow(ctx, ball, h.cx, h.cy, h.r, h.dpr);
            },
        },
    });
}());
