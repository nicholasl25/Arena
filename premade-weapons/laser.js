/**
 * Laser — infinite rotating beam; blocked by the first ball it hits (like light).
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;

    function rayWallExit(ox, oy, dx, dy, minX, maxX, minY, maxY) {
        let tMax = Infinity;
        if (dx > 1e-8) tMax = Math.min(tMax, (maxX - ox) / dx);
        else if (dx < -1e-8) tMax = Math.min(tMax, (minX - ox) / dx);
        if (dy > 1e-8) tMax = Math.min(tMax, (maxY - oy) / dy);
        else if (dy < -1e-8) tMax = Math.min(tMax, (minY - oy) / dy);
        return tMax;
    }

    function rayCircleEntry(ox, oy, dx, dy, cx, cy, radius) {
        const fx = ox - cx;
        const fy = oy - cy;
        const b = fx * dx + fy * dy;
        const c = fx * fx + fy * fy - radius * radius;
        const disc = b * b - c;
        if (disc < 0) return null;
        const s = Math.sqrt(disc);
        const t1 = -b - s;
        const t2 = -b + s;
        if (t1 > 1e-4) return t1;
        if (t2 > 1e-4) return t2;
        return null;
    }

    PremadeWeaponRegistry.register('laser', 'LASER', {
        name: 'Laser',
        weaponKind: 'laser',
        weaponDamage: 8,
        spinSpeed: 2.4,
        swordLength: 0,
        knockbackScale: 0.0,
        bladeWidthScale: 0.55,
        bio: 'Fires a beam.',
        behavior: {
            appliesRecoil() {
                return false;
            },
            skipsStrikeSlow() {
                return true;
            },
            cutsWebs() {
                return false;
            },
            getHitCooldown() {
                return 0.55;
            },
            clashSlowMo() {
                return { duration: 0.14, scale: 0.7 };
            },
            step(ball, dt) {
                if (ball._laserCooldown > 0) {
                    ball._laserCooldown = Math.max(0, ball._laserCooldown - dt);
                }
                spinWeapon(ball, dt);
            },
            update(ball, sim, alive) {
                if (ball._laserCooldown > 0) {
                    ball._laserBeam = null;
                    return;
                }
                const inset = sim.wallInset;
                const minX = inset;
                const maxX = sim.width - inset;
                const minY = inset;
                const maxY = sim.height - inset;
                const cos = Math.cos(ball.weaponAngle);
                const sin = Math.sin(ball.weaponAngle);
                const baseR = ball.radius + 2;
                const x1 = ball.x + baseR * cos;
                const y1 = ball.y + baseR * sin;

                let bestT = rayWallExit(x1, y1, cos, sin, minX, maxX, minY, maxY);
                let hitBall = null;
                for (const other of alive) {
                    if (other === ball || !other.isAlive()) continue;
                    if (sim.sameTeam?.(ball, other)) continue;
                    const t = rayCircleEntry(x1, y1, cos, sin, other.x, other.y, other.radius);
                    if (t != null && t < bestT) {
                        bestT = t;
                        hitBall = other;
                    }
                }
                if (!Number.isFinite(bestT) || bestT < 1) bestT = 1;

                const drawT = bestT;
                const hitT = hitBall ? bestT + 2 : bestT;
                ball._laserBeam = {
                    x1,
                    y1,
                    x2: x1 + cos * hitT,
                    y2: y1 + sin * hitT,
                    drawX2: x1 + cos * drawT,
                    drawY2: y1 + sin * drawT,
                    hitBall,
                };
            },
            getHitSegments(ball) {
                if (ball._laserCooldown > 0 || !ball._laserBeam) return [];
                const beam = ball._laserBeam;
                return [{
                    x1: beam.x1,
                    y1: beam.y1,
                    x2: beam.x2,
                    y2: beam.y2,
                }];
            },
            onMeleeHit(attacker) {
                attacker._laserCooldown = Math.max(attacker._laserCooldown || 0, 0.45);
                attacker._laserBeam = null;
            },
            draw(ctx, ball, h) {
                const beam = ball._laserBeam;
                if (!beam) return;
                h.drawLaser(
                    ctx,
                    h.toX(beam.x1),
                    h.toY(beam.y1),
                    h.toX(beam.drawX2 ?? beam.x2),
                    h.toY(beam.drawY2 ?? beam.y2),
                    h.scale,
                    h.dpr,
                    ball.bladeWidthScale ?? 1,
                    ball.color,
                );
            },
        },
    });
}());
