/**
 * Witch — summons homing bats on a cooldown. Bats survive contact hits but die to melee.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;
    const MAX_BATS = 3;
    const BAT_HIT_COOLDOWN = 0.65;
    const BAT_SPEED = 200;
    const BAT_TURN = 6.5;

    function countOwnerBats(sim, ownerId) {
        if (!sim?.arrows) return 0;
        let n = 0;
        for (const a of sim.arrows) {
            if (a.kind === 'bat' && a.ownerId === ownerId && a.ttl > 0) n += 1;
        }
        return n;
    }

    PremadeWeaponRegistry.register('witch', 'WITCH', {
        name: 'Witch',
        weaponKind: 'witch',
        weaponDamage: 5,
        projectileDamage: 2,
        projectileKind: 'bat',
        spinSpeed: 2.5,
        swordLength: 35,
        shootInterval: 1.15,
        arrowSpeed: BAT_SPEED,
        knockbackScale: 0.7,
        bladeWidthScale: 0.8,
        bio: 'Summons bats.',
        projectileDraw(ctx, arrow, h) {
            h.drawBat?.(ctx, h.cx, h.cy, h.ballR, h.dpr, arrow.color, arrow.flap || 0, arrow.angle || 0);
        },
        behavior: {
            shootsProjectiles() {
                return true;
            },
            getHitSegments(ball) {
                const cos = Math.cos(ball.weaponAngle);
                const sin = Math.sin(ball.weaponAngle);
                const base = ball.radius + 2;
                const tip = base + (ball.swordLength || 36) * 0.55;
                return [{
                    x1: ball.x + base * cos,
                    y1: ball.y + base * sin,
                    x2: ball.x + tip * cos,
                    y2: ball.y + tip * sin,
                    damage: ball.weaponDamage,
                }];
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
                if (countOwnerBats(sim, ball._arenaId) >= MAX_BATS) {
                    ball._pendingShot = false;
                }
            },
            buildProjectile(owner) {
                return {
                    kind: 'bat',
                    radius: 7,
                    bounceWalls: true,
                    spawnOffset: owner.radius + 14,
                    ttl: 7.5,
                    flap: Math.random() * Math.PI * 2,
                    spawnAngleJitter: (Math.random() - 0.5) * 0.9,
                    continuousCollision: true,
                    cutsWebs: false,
                };
            },
            consumeProjectileOnHit() {
                return false;
            },
            getProjectileHitCooldown() {
                return BAT_HIT_COOLDOWN;
            },
            skipsProjectileStrikeSlow() {
                return true;
            },
            stepProjectile(arrow, dt, _sim, alive) {
                if (!arrow._steeringInit) {
                    arrow._steeringInit = true;
                    if (arrow.spawnAngleJitter) {
                        const a = (arrow.angle || 0) + arrow.spawnAngleJitter;
                        const sp = Math.hypot(arrow.vx, arrow.vy) || BAT_SPEED;
                        arrow.vx = Math.cos(a) * sp;
                        arrow.vy = Math.sin(a) * sp;
                        arrow.angle = a;
                    }
                }

                arrow.flap = (arrow.flap || 0) + dt * 18;

                let target = null;
                let best = Infinity;
                for (const b of alive) {
                    if (!b.isAlive() || (_sim?.isProjectileAlly?.(b, arrow)
                        ?? (b._arenaId === arrow.ownerId))) continue;
                    const d = Math.hypot(b.x - arrow.x, b.y - arrow.y);
                    if (d < best) {
                        best = d;
                        target = b;
                    }
                }
                if (!target) return;

                const dx = target.x - arrow.x;
                const dy = target.y - arrow.y;
                const dist = Math.hypot(dx, dy) || 1;
                const wantVx = (dx / dist) * BAT_SPEED;
                const wantVy = (dy / dist) * BAT_SPEED;
                const turn = 1 - Math.exp(-BAT_TURN * dt);
                arrow.vx += (wantVx - arrow.vx) * turn;
                arrow.vy += (wantVy - arrow.vy) * turn;

                const speed = Math.hypot(arrow.vx, arrow.vy) || 1;
                const flutter = Math.sin(arrow.flap) * 35;
                const nx = -arrow.vy / speed;
                const ny = arrow.vx / speed;
                arrow.vx += nx * flutter * dt;
                arrow.vy += ny * flutter * dt;
                arrow.angle = Math.atan2(arrow.vy, arrow.vx);
            },
            draw(ctx, ball, h) {
                if (!ball.getSwordSegment) return;
                const seg = ball.getSwordSegment();
                const broomScale = 1.5;
                h.drawWitchBroom?.(
                    ctx,
                    h.toX(seg.x1),
                    h.toY(seg.y1),
                    h.toX(seg.x1 + (seg.x2 - seg.x1) * broomScale),
                    h.toY(seg.y1 + (seg.y2 - seg.y1) * broomScale),
                    h.scale,
                    h.dpr,
                    ball.color,
                );
            },
        },
    });
}());
