/**
 * Boomerang — curved throw that hits on the way out and back, then returns to hand.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;
    const OUTBOUND_TIME = 0.5;
    const CATCH_MIN_AGE = 0.65;

    PremadeWeaponRegistry.register('boomerang', 'BOOMERANG', {
        name: 'Boomerang',
        weaponKind: 'boomerang',
        weaponDamage: 6,
        projectileDamage: 15,
        projectileKind: 'boomerang',
        spinSpeed: 3.6,
        shootInterval: 1.25,
        arrowSpeed: 400,
        knockbackScale: 1.05,
        bio: 'Throws and returns.',
        projectileDraw(ctx, arrow, h) {
            h.drawBoomerang?.(ctx, h.cx, h.cy, h.ballR, h.dpr, arrow.color, arrow.spin || arrow.angle || 0);
        },
        behavior: {
            shootsProjectiles() {
                return true;
            },
            getHitSegments() {
                return [];
            },
            step(ball, dt) {
                spinWeapon(ball, dt);
                ball._shootTimer = (ball._shootTimer || 0) + dt;
                if (ball._shootTimer >= ball.shootInterval) {
                    ball._shootTimer -= ball.shootInterval;
                    ball._pendingShot = true;
                }
            },
            update(ball, sim) {
                const inflight = !!sim.arrows?.some(
                    (a) => a.ownerId === ball._arenaId && a.kind === 'boomerang' && a.ttl > 0,
                );
                ball._boomerangInflight = inflight;
                if (inflight) ball._pendingShot = false;
            },
            buildProjectile(owner) {
                return {
                    kind: 'boomerang',
                    radius: 9,
                    bounceWalls: true,
                    spawnOffset: owner.radius + 12,
                    ttl: 8,
                    age: 0,
                    returning: false,
                    spin: owner.weaponAngle,
                    curveSign: Math.random() < 0.5 ? -1 : 1,
                    cutsWebs: true,
                };
            },
            consumeProjectileOnHit() {
                return false;
            },
            stepProjectile(arrow, dt, _sim, _alive, owner) {
                arrow.age = (arrow.age || 0) + dt;
                arrow.spin = (arrow.spin || 0) + dt * 16;

                if (!arrow.returning && arrow.age >= OUTBOUND_TIME) {
                    arrow.returning = true;
                }

                if (arrow.returning && owner?.isAlive?.()) {
                    const dx = owner.x - arrow.x;
                    const dy = owner.y - arrow.y;
                    const dist = Math.hypot(dx, dy) || 1;
                    if (dist < owner.radius + arrow.radius + 6 && arrow.age >= CATCH_MIN_AGE) {
                        arrow.ttl = 0;
                        return;
                    }
                    const speed = Math.max(280, Math.hypot(arrow.vx, arrow.vy));
                    const wantVx = (dx / dist) * speed;
                    const wantVy = (dy / dist) * speed;
                    const turn = 1 - Math.exp(-5.2 * dt);
                    arrow.vx += (wantVx - arrow.vx) * turn;
                    arrow.vy += (wantVy - arrow.vy) * turn;
                } else {
                    const ang = 2.1 * dt * (arrow.curveSign || 1);
                    const c = Math.cos(ang);
                    const s = Math.sin(ang);
                    const vx = arrow.vx * c - arrow.vy * s;
                    const vy = arrow.vx * s + arrow.vy * c;
                    arrow.vx = vx;
                    arrow.vy = vy;
                }
                arrow.angle = Math.atan2(arrow.vy, arrow.vx);
            },
            draw(ctx, ball, h) {
                h.drawBoomerangHeld?.(ctx, ball, h.cx, h.cy, h.r, h.dpr, !ball._boomerangInflight);
            },
        },
    });
}());
