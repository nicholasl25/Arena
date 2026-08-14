/**
 * Lightning Bolt — Zeus-style bolt that chains through two foes, then returns.
 * Stable id remains "thunderrod" so saved matchups continue to load.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;
    const MAX_TARGETS = 2;
    const FLIGHT_SPEED = 360;
    const TURN_SPEED = 9;

    function nearestUnhitTarget(arrow, alive, sim) {
        let target = null;
        let bestDist = Infinity;
        for (const ball of alive) {
            if (!ball.isAlive() || (sim?.isProjectileAlly?.(ball, arrow)
                ?? (ball._arenaId === arrow.ownerId))) continue;
            if (arrow._hitIds?.has?.(ball._arenaId)) continue;
            const dist = Math.hypot(ball.x - arrow.x, ball.y - arrow.y);
            if (dist < bestDist) {
                bestDist = dist;
                target = ball;
            }
        }
        return target;
    }

    PremadeWeaponRegistry.register('thunderrod', 'THUNDERROD', {
        name: 'Lightning Bolt',
        weaponKind: 'lightningbolt',
        weaponDamage: 3,
        projectileDamage: 12,
        projectileKind: 'lightning-bolt',
        spinSpeed: 3.4,
        swordLength: 38,
        shootInterval: 2.4,
        arrowSpeed: FLIGHT_SPEED,
        knockbackScale: 0.9,
        bladeWidthScale: 1,
        bio: 'Throws a piercing bolt.',
        projectileDraw(ctx, arrow, h) {
            h.drawLightningBolt?.(
                ctx,
                h.cx,
                h.cy,
                Math.max(h.ballR, 7 * h.dpr),
                h.dpr,
                arrow.angle || 0,
                arrow.color,
            );
        },
        behavior: {
            shootsProjectiles() {
                return true;
            },
            getHitSegments(ball) {
                if (ball._lightningBoltInflight || !ball.getSwordSegment) return [];
                return [ball.getSwordSegment()];
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
                    (arrow) => arrow.ownerId === ball._arenaId
                        && arrow.kind === 'lightning-bolt'
                        && arrow.ttl > 0,
                );
                ball._lightningBoltInflight = inflight;
                if (inflight) ball._pendingShot = false;
            },
            buildProjectile(owner) {
                return {
                    kind: 'lightning-bolt',
                    radius: 8,
                    length: 34,
                    bounceWalls: true,
                    spawnOffset: owner.radius + (owner.swordLength || 44),
                    ttl: 9,
                    returning: false,
                    targetId: null,
                    hitCount: 0,
                    continuousCollision: true,
                    cutsWebs: true,
                };
            },
            consumeProjectileOnHit(arrow, defender, sim) {
                arrow.hitCount = (arrow.hitCount || 0) + 1;
                sim.spawnLightningBolt?.(
                    arrow._prevX ?? arrow.x,
                    arrow._prevY ?? arrow.y,
                    defender.x,
                    defender.y,
                    arrow.color,
                );
                sim.spawnLightningImpact?.(
                    defender.x,
                    defender.y,
                    defender.radius,
                    arrow.color,
                );
                sim._triggerStrikeSlow(0.14, 0.08);

                const next = arrow.hitCount < MAX_TARGETS
                    ? nearestUnhitTarget(arrow, sim.getAliveBalls(), sim)
                    : null;
                arrow.targetId = next?._arenaId ?? null;
                arrow.returning = !next;
                return false;
            },
            skipsProjectileStrikeSlow() {
                return true;
            },
            stepProjectile(arrow, dt, _sim, alive, owner) {
                arrow._trailTimer = (arrow._trailTimer || 0) + dt;
                if (arrow._trailX == null) {
                    arrow._trailX = arrow.x;
                    arrow._trailY = arrow.y;
                } else if (arrow._trailTimer >= 0.035) {
                    _sim.spawnLightningBolt?.(
                        arrow._trailX,
                        arrow._trailY,
                        arrow.x,
                        arrow.y,
                        arrow.color,
                    );
                    arrow._trailX = arrow.x;
                    arrow._trailY = arrow.y;
                    arrow._trailTimer = 0;
                }

                let target = null;
                if (!arrow.returning) {
                    target = alive.find((ball) => ball._arenaId === arrow.targetId && ball.isAlive())
                        || nearestUnhitTarget(arrow, alive, _sim);
                    arrow.targetId = target?._arenaId ?? null;
                    if (!target) arrow.returning = true;
                }

                if (arrow.returning) {
                    if (!owner?.isAlive?.()) {
                        arrow.ttl = 0;
                        return;
                    }
                    target = owner;
                    const catchDist = owner.radius + arrow.radius + 7;
                    if (Math.hypot(owner.x - arrow.x, owner.y - arrow.y) <= catchDist) {
                        arrow.ttl = 0;
                        return;
                    }
                }

                if (!target) return;
                const dx = target.x - arrow.x;
                const dy = target.y - arrow.y;
                const dist = Math.hypot(dx, dy) || 1;
                const wantVx = (dx / dist) * FLIGHT_SPEED;
                const wantVy = (dy / dist) * FLIGHT_SPEED;
                const turn = 1 - Math.exp(-TURN_SPEED * dt);
                arrow.vx += (wantVx - arrow.vx) * turn;
                arrow.vy += (wantVy - arrow.vy) * turn;
                arrow.angle = Math.atan2(arrow.vy, arrow.vx);
            },
            draw(ctx, ball, h) {
                if (ball._lightningBoltInflight) return;
                const angle = ball.weaponAngle || 0;
                const distance = h.r + (ball.swordLength || 44) * h.scale * 0.55;
                h.drawLightningBolt?.(
                    ctx,
                    h.cx + Math.cos(angle) * distance,
                    h.cy + Math.sin(angle) * distance,
                    Math.max(8 * h.dpr, (ball.swordLength || 44) * h.scale * 0.34),
                    h.dpr,
                    angle,
                    ball.color,
                );
            },
        },
    });
}());
