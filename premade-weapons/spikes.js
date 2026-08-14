/**
 * Spikes — short protrusions all around the ball.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;

    PremadeWeaponRegistry.register('spikes', 'SPIKES', {
        name: 'Spikes',
        weaponKind: 'spikes',
        weaponDamage: 5,
        spinSpeed: 2,
        spikeCount: 8,
        spikeLength: 10,
        knockbackScale: 1.0,
        bio: 'Spikes all around.',
        behavior: {
            cutsWebs() {
                return false;
            },
            onProjectileContact() {
                return null;
            },
            step(ball, dt) {
                spinWeapon(ball, dt);
            },
            getHitSegments(ball) {
                const count = ball.spikeCount || 10;
                const spikeLen = ball.spikeLength || 12;
                const baseR = ball.radius + 2;
                const segments = [];
                for (let i = 0; i < count; i++) {
                    const angle = ball.weaponAngle + (i / count) * Math.PI * 2;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const tipR = baseR + spikeLen;
                    segments.push({
                        x1: ball.x + baseR * cos,
                        y1: ball.y + baseR * sin,
                        x2: ball.x + tipR * cos,
                        y2: ball.y + tipR * sin,
                    });
                }
                return segments;
            },
            draw(ctx, ball, h) {
                h.drawSpikes(ctx, ball, h.cx, h.cy, h.r, h.dpr);
            },
        },
    });
}());
