/**
 * Shield — crescent plate that bashes, reflects most projectiles, and catches arrows.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;

    PremadeWeaponRegistry.register('shield', 'SHIELD', {
        name: 'Shield',
        weaponKind: 'shield',
        weaponDamage: 6,
        spinSpeed: 2.8,
        swordLength: 10,
        knockbackScale: 1.25,
        bladeWidthScale: 1,
        bio: 'Blocks and bashes.',
        behavior: {
            blocksMelee() {
                return true;
            },
            onProjectileContact(_melee, arrow) {
                if (arrow?.kind === 'arrow') return 'stick';
                return 'reflect';
            },
            apply(ball) {
                ball._stuckProjectiles = [];
            },
            step(ball, dt) {
                spinWeapon(ball, dt);
            },
            getHitSegments(ball) {
                const thickness = ball.swordLength || 10;
                const innerR = ball.radius + 2;
                const midR = innerR + thickness * 0.55;
                const halfSpan = Math.PI / 4;
                const steps = 4;
                const segments = [];
                for (let i = 0; i < steps; i++) {
                    const t0 = -halfSpan + (i / steps) * halfSpan * 2;
                    const t1 = -halfSpan + ((i + 1) / steps) * halfSpan * 2;
                    const a0 = ball.weaponAngle + t0;
                    const a1 = ball.weaponAngle + t1;
                    segments.push({
                        x1: ball.x + midR * Math.cos(a0),
                        y1: ball.y + midR * Math.sin(a0),
                        x2: ball.x + midR * Math.cos(a1),
                        y2: ball.y + midR * Math.sin(a1),
                    });
                }
                return segments;
            },
            draw(ctx, ball, h) {
                h.drawShield(ctx, ball, h.cx, h.cy, h.r, h.dpr);
                const stuck = ball._stuckProjectiles;
                if (!stuck?.length || !h.drawFlightArrow) return;
                for (const s of stuck) {
                    const ang = ball.weaponAngle + s.localAngle;
                    const dist = s.localDist;
                    h.drawFlightArrow(ctx, {
                        x: ball.x + dist * Math.cos(ang),
                        y: ball.y + dist * Math.sin(ang),
                        angle: ball.weaponAngle + s.embedAngle,
                        length: s.length || 28,
                        color: s.color,
                        vx: 0,
                        vy: 0,
                    }, h.scale, h.dpr);
                }
            },
        },
    });
}());
