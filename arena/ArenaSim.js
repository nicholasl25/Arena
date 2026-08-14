/**
 * Square arena: balls move, bounce off walls and each other, deal damage on contact.
 * Depends: Ball
 */
class ArenaSim {
    /**
     * @param {object} opts
     * @param {number} opts.width arena width (world units)
     * @param {number} opts.height arena height
     * @param {number} [opts.restitution=0.92]
     * @param {number} [opts.wallInset=0] inner margin (world units) — balls bounce inside the border
     * @param {number} [opts.gravity=550] downward acceleration (world units/s²)
     * @param {number} [opts.maxSpeed=750] hard cap on ball speed (world units/s) — safety net against energy blowup
     * @param {number} [opts.minSpeed=185] floor on ball speed so energy loss cannot leave balls idle
     * @param {(a: Ball, b: Ball, impactSpeed: number) => void} [opts.onBallCollision]
     */
    constructor({ width, height, restitution = 0.92, wallInset = 0, gravity = 550, maxSpeed = 750, minSpeed = 185, onBallCollision }) {
        this.width = width;
        this.height = height;
        this.restitution = restitution;
        this.wallInset = wallInset;
        this.gravity = gravity;
        this.maxSpeed = maxSpeed;
        this.minSpeed = minSpeed;
        this.onBallCollision = onBallCollision || null;
        /** @type {Ball[]} */
        this.balls = [];
        this.finished = false;
        this.winner = null;
        this.winnerIsTeam = false;
        /** True only for intentional same-color teams (3+ balls with a shared color). */
        this.teamMode = false;
        this._simTime = 0;
        /** @type {Map<string, number>} pair key → sim time when game effects may run again */
        this._pairEffectReadyAt = new Map();
        this._pairEffectCooldown = 0.12;
        this._nextBallId = 0;
        /** @type {{ x: number, y: number, text: string, color: string, ttl: number, maxTtl: number, vy: number, amount: number, big: boolean }[]} */
        this.damagePopups = [];
    }

    /** @param {Ball} ball */
    addBall(ball) {
        if (ball._arenaId == null) {
            this._nextBallId += 1;
            ball._arenaId = this._nextBallId;
        }
        this.balls.push(ball);
        this.finished = false;
        this.winner = null;
        this.winnerIsTeam = false;
        this._refreshTeamMode();
    }

    /** Team KO only when the opening roster actually has same-color teammates. */
    _refreshTeamMode() {
        const balls = this.balls.filter((b) => typeof b.isAlive !== 'function' || b.isAlive());
        if (balls.length <= 2) {
            this.teamMode = false;
            return;
        }
        const counts = new Map();
        for (const ball of balls) {
            const key = this.colorKey(ball.color);
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        this.teamMode = [...counts.values()].some((n) => n > 1);
    }

    _pairKey(a, b) {
        const idA = a._arenaId;
        const idB = b._arenaId;
        return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
    }

    _clearPairEffectCooldown(a, b) {
        this._pairEffectReadyAt.delete(this._pairKey(a, b));
    }

    _canApplyPairEffects(a, b) {
        const readyAt = this._pairEffectReadyAt.get(this._pairKey(a, b));
        return readyAt == null || this._simTime >= readyAt;
    }

    _markPairEffectsApplied(a, b) {
        this._pairEffectReadyAt.set(
            this._pairKey(a, b),
            this._simTime + this._pairEffectCooldown,
        );
    }

    clear() {
        this.balls = [];
        this.finished = false;
        this.winner = null;
        this.winnerIsTeam = false;
        this.teamMode = false;
        this.damagePopups = [];
        this._pairEffectReadyAt.clear();
    }

    /** @param {number} _dt @param {Ball[]} _alive — override in subclasses */
    _onPreCollisions(_dt, _alive) {}

    /** @param {number} dt @param {Ball[]} _alive */
    _onPostCollisions(dt, _alive) {
        this.updateHitFeedback(dt);
    }

    spawnDamagePopup(x, y, damage, color) {
        const shown = Math.max(1, Math.round(Number(damage) || 0));
        const big = shown >= 12;
        const ttl = big ? 1.0 : 0.9;
        this.damagePopups.push({
            x,
            y,
            text: `-${shown}`,
            color: color || '#dc2626',
            ttl,
            maxTtl: ttl,
            vy: big ? -68 : -58,
            amount: shown,
            big,
        });
    }

    /** @param {number} dt */
    updateHitFeedback(dt) {
        for (const pop of this.damagePopups) {
            pop.ttl -= dt;
            pop.y += pop.vy * dt;
            pop.vy *= 0.96;
        }
        this.damagePopups = this.damagePopups.filter((p) => p.ttl > 0);

        for (const ball of this.balls) {
            if (ball.hitFlash > 0) {
                ball.hitFlash = Math.max(0, ball.hitFlash - dt);
            }
        }
    }

    /** @deprecated use updateHitFeedback */
    updateDamagePopups(dt) {
        this.updateHitFeedback(dt);
    }

    getAliveBalls() {
        return this.balls.filter((b) => b.isAlive());
    }

    /** Normalize ball/theme color for team matching. */
    colorKey(color) {
        return String(color || '').trim().toLowerCase();
    }

    /** Same non-empty color ⇒ same team. */
    sameTeam(a, b) {
        const ca = this.colorKey(a?.color);
        const cb = this.colorKey(b?.color);
        return Boolean(ca && cb && ca === cb);
    }

    /** Owner or same-color teammate of a projectile / web. */
    isProjectileAlly(ball, projectile) {
        if (!ball || !projectile) return false;
        if (ball._arenaId != null && ball._arenaId === projectile.ownerId) return true;
        return this.sameTeam(ball, projectile);
    }

    /** @param {Ball[]} alive */
    _onlyMultipliersLeft(alive) {
        return alive.length > 0 && alive.every((b) => b.premadeId === 'multiplier');
    }

    /** Fight over when only one intentional team (shared color) remains. */
    _allSameTeam(alive) {
        if (!this.teamMode || !alive || alive.length < 2) return false;
        const key = this.colorKey(alive[0]?.color);
        if (!key) return false;
        return alive.every((b) => this.colorKey(b.color) === key);
    }

    /** @param {Ball[]} alive */
    _updateFinishedState(alive) {
        if (alive.length === 0) {
            this.finished = true;
            this.winner = null;
            this.winnerIsTeam = false;
            return;
        }
        if (alive.length === 1) {
            this.finished = true;
            this.winner = alive[0];
            this.winnerIsTeam = false;
            return;
        }
        if (this._onlyMultipliersLeft(alive) || this._allSameTeam(alive)) {
            this.finished = true;
            this.winner = alive[0];
            this.winnerIsTeam = this._allSameTeam(alive);
            return;
        }
        this.winnerIsTeam = false;
    }

    /**
     * Random position inside the arena, clear of walls and other balls.
     * @param {number} radius
     * @param {Ball[]} [ignore] balls to skip when checking overlap
     * @returns {{ x: number, y: number }}
     */
    randomArenaPosition(radius, ignore = []) {
        const inset = this.wallInset;
        const margin = inset + radius + 6;
        const minX = margin;
        const maxX = this.width - margin;
        const minY = margin;
        const maxY = this.height - margin;
        const others = this.getAliveBalls().filter((b) => !ignore.includes(b));

        for (let attempt = 0; attempt < 80; attempt++) {
            const x = minX + Math.random() * (maxX - minX);
            const y = minY + Math.random() * (maxY - minY);
            if (!this._overlapsAnyBall(x, y, radius, others)) {
                return { x, y };
            }
        }

        return {
            x: minX + Math.random() * (maxX - minX),
            y: minY + Math.random() * (maxY - minY),
        };
    }

    _overlapsAnyBall(x, y, radius, balls) {
        for (const ball of balls) {
            const dx = x - ball.x;
            const dy = y - ball.y;
            const minDist = radius + ball.radius + 4;
            if (dx * dx + dy * dy < minDist * minDist) return true;
        }
        return false;
    }

    /** @param {number} dt seconds */
    step(dt) {
        if (this.finished) return;
        this._simTime += dt;

        const alive = this.getAliveBalls();
        if (alive.length <= 1 || this._onlyMultipliersLeft(alive) || this._allSameTeam(alive)) {
            this._updateFinishedState(alive);
            return;
        }

        for (const ball of alive) {
            ball.vy += this.gravity * dt;
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
        }

        this._onPreCollisions(dt, alive);

        for (const ball of alive) {
            this.resolveWallCollision(ball);
        }

        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                this.resolveBallCollision(alive[i], alive[j]);
            }
        }

        this._onPostCollisions(dt, alive);

        for (const ball of alive) {
            this.clampSpeed(ball);
            this.enforceMinSpeed(ball);
        }

        const stillAlive = this.getAliveBalls();
        if (stillAlive.length <= 1 || this._onlyMultipliersLeft(stillAlive) || this._allSameTeam(stillAlive)) {
            this._updateFinishedState(stillAlive);
        }
    }

    /** Clamp a ball's speed to maxSpeed without changing its direction. */
    clampSpeed(ball) {
        const max = this.maxSpeed;
        if (!(max > 0)) return;
        const speedSq = ball.vx * ball.vx + ball.vy * ball.vy;
        if (speedSq <= max * max) return;
        const scale = max / Math.sqrt(speedSq);
        ball.vx *= scale;
        ball.vy *= scale;
    }

    _isOnFloor(ball) {
        const floorY = this.height - this.wallInset - ball.radius;
        return ball.y >= floorY - 4;
    }

    /** Minimum upward speed leaving the floor — ~25% arena hop so balls don't skitter. */
    _minFloorBounceUp() {
        const hop = Math.min(this.height * 0.25, 110);
        return Math.sqrt(Math.max(0, 2 * this.gravity * hop));
    }

    /** Scale sub-minimum speed along current direction; floor gets a real upward kick. */
    enforceMinSpeed(ball) {
        const min = this.minSpeed;
        if (!(min > 0)) return;

        const minUp = this._minFloorBounceUp();
        if (this._isOnFloor(ball) && ball.vy > -minUp) {
            ball.vy = -minUp;
        }

        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed < min && speed > 1e-4) {
            const scale = min / speed;
            ball.vx *= scale;
            ball.vy *= scale;
        }
    }

    resolveWallCollision(ball) {
        const r = ball.radius;
        const inset = this.wallInset;
        const minX = inset + r;
        const maxX = this.width - inset - r;
        const minY = inset + r;
        const maxY = this.height - inset - r;

        if (ball.x < minX) {
            ball.x = minX;
            if (ball.vx < 0) ball.vx = Math.abs(ball.vx);
        } else if (ball.x > maxX) {
            ball.x = maxX;
            if (ball.vx > 0) ball.vx = -Math.abs(ball.vx);
        }

        if (ball.y < minY) {
            ball.y = minY;
            if (ball.vy < 0) ball.vy = Math.abs(ball.vy);
        } else if (ball.y > maxY) {
            ball.y = maxY;
            if (ball.vy > 0) {
                const minUp = this._minFloorBounceUp();
                ball.vy = -Math.max(Math.abs(ball.vy), minUp);
            }
        }
    }

    resolveBallCollision(a, b) {
        if (!a.shouldCollideWith(b) || !b.shouldCollideWith(a)) return;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius;
        if (dist >= minDist) {
            this._clearPairEffectCooldown(a, b);
            return;
        }

        let nx;
        let ny;
        if (dist < 1e-6) {
            const angle = Math.random() * Math.PI * 2;
            nx = Math.cos(angle);
            ny = Math.sin(angle);
            dist = minDist;
        } else {
            nx = dx / dist;
            ny = dy / dist;
        }

        const overlap = minDist - dist;
        const totalMass = a.mass + b.mass;
        a.x -= nx * overlap * (b.mass / totalMass);
        a.y -= ny * overlap * (b.mass / totalMass);
        b.x += nx * overlap * (a.mass / totalMass);
        b.y += ny * overlap * (a.mass / totalMass);

        const dvx = a.vx - b.vx;
        const dvy = a.vy - b.vy;
        const relVelNorm = dvx * nx + dvy * ny;
        const impactSpeed = Math.abs(relVelNorm);
        const relSpeed = Math.hypot(dvx, dvy);

        // Elastic bounce: reverse the normal velocity component so balls fly apart.
        const e = this.restitution;
        const va_n = a.vx * nx + a.vy * ny;
        const vb_n = b.vx * nx + b.vy * ny;
        if (va_n > 0) {
            a.vx -= (1 + e) * va_n * nx;
            a.vy -= (1 + e) * va_n * ny;
        }
        if (vb_n < 0) {
            b.vx -= (1 + e) * vb_n * nx;
            b.vy -= (1 + e) * vb_n * ny;
        }

        const skipGameEffects = a.skipGameCollisionEffects?.(b) || b.skipGameCollisionEffects?.(a)
            || this.sameTeam(a, b);

        if (!skipGameEffects && a.isAlive() && b.isAlive() && this._canApplyPairEffects(a, b)) {
            if (this.onBallCollision && relSpeed > 8) {
                this.onBallCollision(a, b, Math.max(impactSpeed, relSpeed));
            }
            const dmgToB = a.computeDamage(b, impactSpeed);
            const dmgToA = b.computeDamage(a, impactSpeed);
            const appliedB = b.takeDamage(dmgToB);
            const appliedA = a.takeDamage(dmgToA);
            if (appliedB > 0) {
                this.spawnDamagePopup(b.x, b.y - b.radius, appliedB, b.color);
            }
            if (appliedA > 0) {
                this.spawnDamagePopup(a.x, a.y - a.radius, appliedA, a.color);
            }
            const aHealthBeforeEffects = a.health;
            const bHealthBeforeEffects = b.health;
            const aMassBeforeEffects = a.mass;
            const bMassBeforeEffects = b.mass;
            a.applyCollisionEffect(b);
            b.applyCollisionEffect(a);
            a.onCollision(b, impactSpeed, this, {
                healthBeforeEffects: aHealthBeforeEffects,
                massBeforeEffects: aMassBeforeEffects,
            });
            b.onCollision(a, impactSpeed, this, {
                healthBeforeEffects: bHealthBeforeEffects,
                massBeforeEffects: bMassBeforeEffects,
            });
            this._markPairEffectsApplied(a, b);
        }
    }
}
