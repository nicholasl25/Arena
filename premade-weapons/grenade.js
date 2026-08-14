/**
 * Grenade — lobbed fuse bomb. Blast damages enemies only; closer = more damage.
 * Also shreds projectiles/bats and cuts webs in the blast.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;
    const FUSE = 1.1;
    const BLAST_RADIUS = 100;
    const GRAVITY = 520;

    function explodeGrenade(arrow, sim, alive) {
        if (arrow._exploded) return;
        arrow._exploded = true;
        arrow.ttl = 0;

        const maxDmg = arrow.blastDamage ?? 20;
        const radius = arrow.blastRadius ?? BLAST_RADIUS;
        const balls = alive || sim.getAliveBalls?.() || [];
        const owner = sim.balls?.find?.((b) => b._arenaId === arrow.ownerId) || null;

        sim.spawnExplosion?.(arrow.x, arrow.y, radius, arrow.color);
        sim.spawnProjectileShreds?.(arrow);
        sim.destroyProjectilesInRadius?.(arrow.x, arrow.y, radius, arrow, balls);
        sim.cutWebsInRadius?.(arrow.x, arrow.y, radius, owner);

        let hitAnyone = false;
        for (const ball of balls) {
            if (!ball.isAlive?.() || sim.isProjectileAlly?.(ball, arrow)
                || (!sim.isProjectileAlly && ball._arenaId === arrow.ownerId)) continue;
            const dx = ball.x - arrow.x;
            const dy = ball.y - arrow.y;
            const dist = Math.hypot(dx, dy);
            const edgeDist = Math.max(0, dist - (ball.radius || 0));
            if (edgeDist >= radius) continue;

            const t = 1 - edgeDist / radius;
            const falloff = t * t;
            const dmg = Math.max(1, Math.round(maxDmg * falloff));
            if (sim.applyCombatDamage) {
                sim.applyCombatDamage(owner, ball, dmg);
            } else {
                const applied = ball.takeDamage(dmg);
                if (applied > 0) {
                    sim.spawnDamagePopup?.(ball.x, ball.y - ball.radius, applied, ball.color);
                }
            }

            const nx = dist > 1e-6 ? dx / dist : 1;
            const ny = dist > 1e-6 ? dy / dist : 0;
            const push = 240 * falloff * (arrow.knockbackScale ?? 1);
            ball.vx += nx * push;
            ball.vy += ny * push;
            hitAnyone = true;
        }

        // Boom SFX comes from spawnExplosion → onExplosion (not metal weaponHit).
        if (hitAnyone) sim._triggerStrikeSlow?.(0.16, 0.22);
    }

    function drawGrenadeBody(ctx, cx, cy, r, dpr, color, spin = 0) {
        const body = color || '#3f6b3a';
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.4, 1.8 * dpr);
        ctx.stroke();

        // Equator band
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.92, r * 0.28, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1, 1.2 * dpr);
        ctx.stroke();

        // Fuse stem
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.75);
        ctx.lineTo(0, -r * 1.25);
        ctx.strokeStyle = '#5c4030';
        ctx.lineWidth = Math.max(1.5, 2 * dpr);
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -r * 1.28, Math.max(1.5, r * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = '#e8a84a';
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(-r * 0.28, -r * 0.28, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    PremadeWeaponRegistry.register('grenade', 'GRENADE', {
        name: 'Grenade',
        icon: 'premade-weapons/sprites/Grenade.png',
        weaponKind: 'grenade',
        weaponDamage: 0,
        projectileDamage: 20,
        projectileKind: 'grenade',
        spinSpeed: 3.0,
        shootInterval: 2.25,
        arrowSpeed: 300,
        knockbackScale: 1.1,
        bio: 'Lobs Bombs.',
        projectileDraw(ctx, arrow, h) {
            const spin = (arrow.spin || 0);
            if (h.drawGrenade) {
                h.drawGrenade(ctx, h.cx, h.cy, h.ballR, h.dpr, '#3f6b3a', spin);
            } else {
                drawGrenadeBody(ctx, h.cx, h.cy, h.ballR, h.dpr, '#3f6b3a', spin);
            }
        },
        behavior: {
            canDealMeleeDamage() {
                return false;
            },
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
            buildProjectile(owner) {
                return {
                    kind: 'grenade',
                    radius: 12,
                    bounceWalls: true,
                    spawnOffset: owner.radius + 18,
                    ttl: 8,
                    age: 0,
                    spin: 0,
                    damage: 0,
                    blastDamage: owner.projectileDamage ?? 20,
                    blastRadius: BLAST_RADIUS,
                    fuse: FUSE,
                };
            },
            skipsProjectileHitResolve() {
                return true;
            },
            consumeProjectileOnHit(arrow, _defender, sim) {
                explodeGrenade(arrow, sim, sim.getAliveBalls?.());
                return true;
            },
            onProjectileShattered(arrow, sim, alive) {
                explodeGrenade(arrow, sim, alive);
            },
            stepProjectile(arrow, dt, sim, alive) {
                if (arrow._exploded) return;
                arrow.age = (arrow.age || 0) + dt;
                arrow.spin = (arrow.spin || 0) + dt * 10;
                arrow.vy += GRAVITY * dt;
                arrow.angle = Math.atan2(arrow.vy, arrow.vx);

                if (arrow.age >= (arrow.fuse ?? FUSE)) {
                    explodeGrenade(arrow, sim, alive);
                }
            },
            draw(ctx, ball, h) {
                const ang = ball.weaponAngle || 0;
                const dist = h.r + 12 * (h.r / Math.max(ball.radius, 1));
                const gx = h.cx + Math.cos(ang) * dist;
                const gy = h.cy + Math.sin(ang) * dist;
                const gr = Math.max(8, 10 * h.dpr);
                if (h.drawGrenade) {
                    h.drawGrenade(ctx, gx, gy, gr, h.dpr, '#3f6b3a', ang);
                } else {
                    drawGrenadeBody(ctx, gx, gy, gr, h.dpr, '#3f6b3a', ang);
                }
            },
        },
    });
}());
