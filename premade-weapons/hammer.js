/**
 * Hammer — slow swing; damage and spin ramp up with every successful hit.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;

    PremadeWeaponRegistry.register('hammer', 'HAMMER', {
        name: 'Hammer',
        icon: 'premade-weapons/sprites/Stone_Hammer.png',
        weaponKind: 'hammer',
        weaponDamage: 10,
        damageMax: 30,
        damageRampHits: 10,
        spinSpeed: 2.4,
        spinSpeedMax: 8,
        swordLength: 66,
        knockbackScale: 1.65,
        bladeWidthScale: 1.5,
        bio: 'Hits harder as it swings.',
        behavior: {
            apply(ball) {
                ball._damageCharge = 0;
                ball.spinSpeed = ball.baseSpinSpeed;
            },
            step(ball, dt) {
                spinWeapon(ball, dt);
            },
            getDamage(ball) {
                if (!(ball.damageRampHits > 0)) return ball.weaponDamage;
                const t = Math.min(1, ball._damageCharge / ball.damageRampHits);
                const max = ball.damageMax ?? ball.weaponDamage;
                return Math.round(ball.weaponDamage + (max - ball.weaponDamage) * t);
            },
            getChargeFraction(ball) {
                if (!(ball.damageRampHits > 0)) return 1;
                return Math.min(1, ball._damageCharge / ball.damageRampHits);
            },
            registerHit(ball) {
                if (!(ball.damageRampHits > 0)) return;
                ball._damageCharge += 1;
                const t = Math.min(1, ball._damageCharge / ball.damageRampHits);
                const base = ball.baseSpinSpeed ?? ball.spinSpeed;
                const max = ball.spinSpeedMax ?? base;
                ball.spinSpeed = base + (max - base) * t;
            },
            draw(ctx, ball, h) {
                if (!ball.getSwordSegment) return;
                const seg = ball.getSwordSegment();
                const charge = ball.getDamageChargeFraction ? ball.getDamageChargeFraction() : 1;
                h.drawHammer(
                    ctx,
                    h.toX(seg.x1),
                    h.toY(seg.y1),
                    h.toX(seg.x2),
                    h.toY(seg.y2),
                    h.scale,
                    h.dpr,
                    ball.bladeWidthScale ?? 1,
                    charge,
                );
            },
        },
    });
}());
