/**
 * Weapon arena — balls bounce but damage only from rotating swords.
 * Depends: ArenaSim, WeaponBall
 */

/** Closest point on segment AB to point P. */
function closestPointOnSegment(ax, ay, bx, by, px, py) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    let t = abLenSq > 1e-8 ? (apx * abx + apy * aby) / abLenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return {
        x: ax + t * abx,
        y: ay + t * aby,
    };
}

/** Circle vs segment — returns penetration info or null when separated. */
function segmentCirclePenetration(seg, cx, cy, radius) {
    const contact = closestPointOnSegment(seg.x1, seg.y1, seg.x2, seg.y2, cx, cy);
    const dx = cx - contact.x;
    const dy = cy - contact.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= radius) return null;

    let nx;
    let ny;
    if (dist < 1e-6) {
        const bladeDx = seg.x2 - seg.x1;
        const bladeDy = seg.y2 - seg.y1;
        const bladeLen = Math.hypot(bladeDx, bladeDy);
        if (bladeLen < 1e-6) return null;
        nx = -bladeDy / bladeLen;
        ny = bladeDx / bladeLen;
        const side = nx * dx + ny * dy;
        if (side < 0) {
            nx = -nx;
            ny = -ny;
        }
    } else {
        nx = dx / dist;
        ny = dy / dist;
    }

    return {
        contact,
        nx,
        ny,
        penetration: radius - dist,
    };
}

/** True when segments AB and CD properly intersect (or nearly touch). */
function segmentsClash(a, b, slack = 2.5) {
    const ax = a.x1;
    const ay = a.y1;
    const bx = a.x2;
    const by = a.y2;
    const cx = b.x1;
    const cy = b.y1;
    const dx = b.x2;
    const dy = b.y2;

    const abx = bx - ax;
    const aby = by - ay;
    const cdx = dx - cx;
    const cdy = dy - cy;
    const acx = cx - ax;
    const acy = cy - ay;
    const denom = abx * cdy - aby * cdx;

    if (Math.abs(denom) > 1e-8) {
        const t = (acx * cdy - acy * cdx) / denom;
        const u = (acx * aby - acy * abx) / denom;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }

    // Near-miss: endpoint within slack of the other segment (spikes / parallel blades).
    const pts = [
        closestPointOnSegment(ax, ay, bx, by, cx, cy),
        closestPointOnSegment(ax, ay, bx, by, dx, dy),
        closestPointOnSegment(cx, cy, dx, dy, ax, ay),
        closestPointOnSegment(cx, cy, dx, dy, bx, by),
    ];
    const refs = [
        { x: cx, y: cy },
        { x: dx, y: dy },
        { x: ax, y: ay },
        { x: bx, y: by },
    ];
    for (let i = 0; i < 4; i++) {
        if (Math.hypot(pts[i].x - refs[i].x, pts[i].y - refs[i].y) <= slack) return true;
    }
    return false;
}

class WeaponArenaSim extends ArenaSim {
    /**
     * @param {object} opts
     * @param {(attacker: WeaponBall, defender: Ball, damage: number) => void} [opts.onWeaponHit]
     * @param {(a: WeaponBall, b: WeaponBall) => void} [opts.onWeaponClash]
     * @param {(shield: WeaponBall, striker: WeaponBall, damage: number) => void} [opts.onShieldReflect]
     * @param {(melee: WeaponBall, projectile: object) => void} [opts.onProjectileDeflect]
     * @param {(x: number, y: number, radius: number) => void} [opts.onExplosion]
     */
    constructor(opts = {}) {
        super(opts);
        this.onWeaponHit = opts.onWeaponHit || null;
        this.onWeaponClash = opts.onWeaponClash || null;
        this.onShieldReflect = opts.onShieldReflect || null;
        this.onWebCut = opts.onWebCut || null;
        this.onExplosion = opts.onExplosion || null;
        this.isWeaponArena = true;
        /** @type {Map<string, number>} attacker→defender → sim time when damage may apply again */
        this._weaponHitReadyAt = new Map();
        this._weaponHitCooldown = 0.38;
        /** @type {Map<string, number>} unordered pair → sim time when clash SFX may fire again */
        this._weaponClashReadyAt = new Map();
        this._weaponClashCooldown = 0.22;
        this.strikeSlowRemaining = 0;
        this.strikeSlowDuration = 0.55;
        this.strikeSlowScale = 0.25;
        this.strikeSlowCurrentScale = 1;
        this.webSegments = [];
        this._lastWebAnchor = new Map();
        /** @type {Map<number, Set<string>>} owner → walls touched last frame */
        this._webWallContacts = new Map();
        /** @type {Set<number>} owners that hit a ball since their last wall touch */
        this._webChainBroken = new Set();
        this._previousBallPositions = new Map();
        /** @type {{ x: number, y: number, vx: number, vy: number, angle: number, radius: number, ownerId: number, damage: number, knockbackScale: number, length: number, ttl: number, color: string }[]} */
        this.arrows = [];
        /** @type {{ x: number, y: number, vx: number, vy: number, r: number, ttl: number, maxTtl: number, color: string }[]} */
        this.projectileShreds = [];
        /** @type {{ x1: number, y1: number, x2: number, y2: number, color: string, ttl: number, maxTtl: number, seed: number }[]} */
        this.lightningBolts = [];
        /** @type {{ x: number, y: number, radius: number, color: string, ttl: number, maxTtl: number, seed: number }[]} */
        this.lightningImpacts = [];
        /** @type {{ x: number, y: number, radius: number, color: string, ttl: number, maxTtl: number }[]} */
        this.explosions = [];
        /** @param {(melee: WeaponBall, projectile: object) => void} */
        this.onProjectileDeflect = opts.onProjectileDeflect || null;
    }

    clear() {
        super.clear();
        this.arrows = [];
        this.projectileShreds = [];
        this.lightningBolts = [];
        this.lightningImpacts = [];
        this.explosions = [];
        this._weaponHitReadyAt.clear();
        this._weaponClashReadyAt.clear();
        this.strikeSlowRemaining = 0;
        this.strikeSlowCurrentScale = 1;
        this.webSegments = [];
        this._lastWebAnchor.clear();
        this._webWallContacts.clear();
        this._webChainBroken.clear();
        this._previousBallPositions.clear();
    }

    /**
     * Real-time dt scale for strike slow-mo (1 = normal, 0.25 = quarter speed).
     * @param {number} realDt unscaled frame delta (seconds)
     */
    getSimDtScale(realDt) {
        if (this.strikeSlowRemaining <= 0) return 1;
        this.strikeSlowRemaining = Math.max(0, this.strikeSlowRemaining - realDt);
        const scale = this.strikeSlowCurrentScale;
        if (this.strikeSlowRemaining <= 0) this.strikeSlowCurrentScale = 1;
        return scale;
    }

    _triggerStrikeSlow(duration = this.strikeSlowDuration, scale = this.strikeSlowScale) {
        if (this.strikeSlowRemaining <= 0) this.strikeSlowCurrentScale = scale;
        else this.strikeSlowCurrentScale = Math.min(this.strikeSlowCurrentScale, scale);
        this.strikeSlowRemaining = Math.max(this.strikeSlowRemaining, duration);
    }

    _weaponHitKey(attacker, defender) {
        return `${attacker._arenaId}:${defender._arenaId}`;
    }

    _canWeaponHit(attacker, defender) {
        const readyAt = this._weaponHitReadyAt.get(this._weaponHitKey(attacker, defender));
        return readyAt == null || this._simTime >= readyAt;
    }

    _markWeaponHit(attacker, defender) {
        const cooldown = attacker.weaponBehavior?.getHitCooldown?.(attacker)
            ?? this._weaponHitCooldown;
        const scale = Number(attacker.hitCooldownScale);
        const scaled = cooldown * (Number.isFinite(scale) && scale > 0 ? scale : 1);
        this._weaponHitReadyAt.set(
            this._weaponHitKey(attacker, defender),
            this._simTime + scaled,
        );
    }

    /**
     * Apply damage with protection + optional thorns reflect.
     * @param {Ball|null} attacker
     * @param {Ball} defender
     * @param {number} damage
     * @param {{ thorns?: boolean }} [opts]
     * @returns {number} damage applied to defender
     */
    applyCombatDamage(attacker, defender, damage, opts = {}) {
        if (!(damage > 0) || !defender?.isAlive?.()) return 0;
        const applied = defender.takeDamage(damage);
        if (applied > 0) {
            this.spawnDamagePopup(
                defender.x,
                defender.y - defender.radius,
                applied,
                defender.color,
            );
        }
        if (opts.thorns === false || !attacker?.isAlive?.()) return applied;

        const reflectMult = Number(defender.thornsReflectMult);
        if (!(reflectMult > 0)) return applied;

        const reflected = applied * reflectMult;
        if (!(reflected > 0)) return applied;

        const thornsApplied = attacker.takeDamage(reflected);
        if (thornsApplied > 0) {
            this.spawnDamagePopup(
                attacker.x,
                attacker.y - attacker.radius,
                thornsApplied,
                defender.powerupColor || defender.color,
            );
        }
        return applied;
    }

    /** @param {number} dt @param {Ball[]} alive */
    _onPreCollisions(dt, alive) {
        for (const ball of alive) {
            if (ball.stepWeapon) ball.stepWeapon(dt);
            if (ball._pendingShot) {
                this.spawnArrow(ball);
                ball._pendingShot = false;
            }
            ball.weaponBehavior?.update?.(ball, this, alive);
        }
        this.stepArrows(dt, alive);
        this.stepProjectileShreds(dt);
        this.stepLightningBolts(dt);
        this.stepLightningImpacts(dt);
        this.stepExplosions(dt);
        this.resolveWeaponClashes(alive);
        this.resolveWeaponHits(alive);
        this.resolveWebCuts(alive);
        this.resolveWebHits(alive);
    }

    _onPostCollisions(dt, alive) {
        super._onPostCollisions(dt, alive);
        this._previousBallPositions.clear();
        for (const ball of alive) {
            this._previousBallPositions.set(ball._arenaId, { x: ball.x, y: ball.y });
        }
    }

    resolveWallCollision(ball) {
        super.resolveWallCollision(ball);
        ball.weaponBehavior?.onWallCollision?.(ball, this);
    }

    resolveBallCollision(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const touching = a.shouldCollideWith(b) && b.shouldCollideWith(a)
            && dx * dx + dy * dy < (a.radius + b.radius) ** 2;
        super.resolveBallCollision(a, b);
        if (!touching) return;
        a.weaponBehavior?.onBallCollision?.(a, b, this);
        b.weaponBehavior?.onBallCollision?.(b, a, this);
    }

    anchorWeb(owner, point) {
        const previous = this._lastWebAnchor.get(owner._arenaId);
        this._lastWebAnchor.set(owner._arenaId, point);
        if (this._webChainBroken.delete(owner._arenaId)) return;
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 4) return;
        // No axis-aligned strands (e.g. two touches along the same wall).
        if (Math.abs(point.x - previous.x) < 2 || Math.abs(point.y - previous.y) < 2) return;

        this.webSegments.push({
            x1: previous.x,
            y1: previous.y,
            x2: point.x,
            y2: point.y,
            ownerId: owner._arenaId,
            damage: owner.weaponDamage,
            color: owner.color,
        });
    }

    /** Melee segments and cutting projectiles slice webs without dealing damage. @param {Ball[]} alive */
    resolveWebCuts(alive) {
        if (!this.webSegments.length) return;

        for (let i = this.webSegments.length - 1; i >= 0; i--) {
            const web = this.webSegments[i];
            let cutter = null;

            for (const ball of alive) {
                if (!ball.isAlive() || !ball.getWeaponHitSegments) continue;
                if (ball.weaponBehavior?.cutsWebs?.() === false) continue;
                const segments = ball.getWeaponHitSegments();
                if (!segments.length) continue;

                for (const seg of segments) {
                    if (segmentsClash(web, seg)) {
                        cutter = ball;
                        break;
                    }
                }
                if (cutter) break;
            }

            if (!cutter) {
                for (const arrow of this.arrows) {
                    if (!arrow.cutsWebs || arrow.ttl <= 0) continue;
                    const path = arrow._prevX != null
                        ? { x1: arrow._prevX, y1: arrow._prevY, x2: arrow.x, y2: arrow.y }
                        : null;
                    if (
                        segmentCirclePenetration(web, arrow.x, arrow.y, arrow.radius)
                        || (path && segmentsClash(web, path, arrow.radius))
                    ) {
                        cutter = alive.find((b) => b._arenaId === arrow.ownerId)
                            || { spinSpeed: Math.hypot(arrow.vx || 0, arrow.vy || 0) * 0.02 };
                        break;
                    }
                }
            }

            if (!cutter) continue;
            const midX = (web.x1 + web.x2) * 0.5;
            const midY = (web.y1 + web.y2) * 0.5;
            this.webSegments.splice(i, 1);
            if (this.onWebCut) this.onWebCut(cutter, web, midX, midY);
        }
    }

    resolveWebHits(alive) {
        for (let i = this.webSegments.length - 1; i >= 0; i--) {
            const web = this.webSegments[i];
            let defender = null;

            for (const ball of alive) {
                if (this.isProjectileAlly(ball, web) || !ball.isAlive()) continue;
                const previous = this._previousBallPositions.get(ball._arenaId);
                const path = previous
                    ? { x1: previous.x, y1: previous.y, x2: ball.x, y2: ball.y }
                    : null;
                if (
                    segmentCirclePenetration(web, ball.x, ball.y, ball.radius)
                    || (path && segmentsClash(web, path, ball.radius))
                ) {
                    defender = ball;
                    break;
                }
            }

            if (!defender) continue;
            const owner = this.balls.find((ball) => ball._arenaId === web.ownerId);
            const applied = this.applyCombatDamage(owner || null, defender, web.damage);
            if (owner && applied > 0 && this.onWeaponHit) {
                this.onWeaponHit(owner, defender, applied);
            }
            this._triggerStrikeSlow(0.22, 0.55);
            this.webSegments.splice(i, 1);
        }
    }

    _weaponClashKey(a, b) {
        const idA = a._arenaId;
        const idB = b._arenaId;
        return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
    }

    _canWeaponClash(a, b) {
        const readyAt = this._weaponClashReadyAt.get(this._weaponClashKey(a, b));
        return readyAt == null || this._simTime >= readyAt;
    }

    _markWeaponClash(a, b) {
        this._weaponClashReadyAt.set(
            this._weaponClashKey(a, b),
            this._simTime + this._weaponClashCooldown,
        );
    }

    /** True when two fighters' weapon hit-segments currently overlap. */
    weaponsClash(a, b) {
        if (!a.getWeaponHitSegments || !b.getWeaponHitSegments) return false;
        const segsA = a.getWeaponHitSegments();
        const segsB = b.getWeaponHitSegments();
        if (!segsA.length || !segsB.length) return false;
        for (const segA of segsA) {
            for (const segB of segsB) {
                if (segmentsClash(segA, segB)) return true;
            }
        }
        return false;
    }

    /**
     * Reflect striker's weapon damage onto themselves (shield block).
     * @param {WeaponBall} striker
     * @param {WeaponBall} shield
     * @returns {boolean} true when damage was applied
     */
    resolveShieldReflect(striker, shield) {
        if (!striker?.isAlive?.() || !shield?.isAlive?.()) return false;
        if (striker.weaponBehavior?.blocksMelee?.()) return false;
        if (!this._canWeaponHit(shield, striker)) return false;

        const dmg = striker.getWeaponDamage
            ? striker.getWeaponDamage()
            : striker.weaponDamage;
        if (!(dmg > 0)) return false;

        // Shield already reflects full strike damage — skip thorns stacking.
        const applied = this.applyCombatDamage(shield, striker, dmg, { thorns: false });
        if (!(applied > 0)) return false;
        if (this.onShieldReflect) this.onShieldReflect(shield, striker, applied);
        else if (this.onWeaponHit) this.onWeaponHit(shield, striker, applied);
        if (!striker.weaponBehavior?.skipsStrikeSlow?.()) this._triggerStrikeSlow();
        this._markWeaponHit(shield, striker);
        return true;
    }

    /** Blade–blade contact — SFX + strike slow-mo; shield reflects striker damage. */
    resolveWeaponClashes(alive) {
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i];
                const b = alive[j];
                if (this.sameTeam(a, b)) continue;
                if (!a.getWeaponHitSegments || !b.getWeaponHitSegments) continue;
                if (!a.isAlive() || !b.isAlive()) continue;
                if (!this._canWeaponClash(a, b)) continue;
                if (!this.weaponsClash(a, b)) continue;

                const aBlocks = !!a.weaponBehavior?.blocksMelee?.();
                const bBlocks = !!b.weaponBehavior?.blocksMelee?.();
                let reflected = false;
                if (aBlocks !== bBlocks) {
                    const shield = aBlocks ? a : b;
                    const striker = aBlocks ? b : a;
                    reflected = this.resolveShieldReflect(striker, shield);
                }

                // Shield parry has its own SFX — skip the generic metal clash.
                if (!reflected && this.onWeaponClash) this.onWeaponClash(a, b);
                const slow = a.weaponBehavior?.clashSlowMo?.(a, b)
                    || b.weaponBehavior?.clashSlowMo?.(a, b);
                if (slow) this._triggerStrikeSlow(slow.duration, slow.scale);
                else this._triggerStrikeSlow();
                this._markWeaponClash(a, b);
            }
        }
    }

    /** @param {WeaponBall} owner */
    spawnArrow(owner) {
        const cos = Math.cos(owner.weaponAngle);
        const sin = Math.sin(owner.weaponAngle);
        const built = owner.weaponBehavior?.buildProjectile?.(owner) || {};
        const spawnR = built.spawnOffset ?? owner.radius + 10;
        const speed = owner.arrowSpeed;
        this.arrows.push({
            ...built,
            x: owner.x + spawnR * cos,
            y: owner.y + spawnR * sin,
            vx: speed * cos,
            vy: speed * sin,
            angle: owner.weaponAngle,
            radius: built.radius ?? owner.projectileRadius ?? 7.5,
            ownerId: owner._arenaId,
            damage: built.damage != null ? built.damage : (owner.projectileDamage ?? owner.weaponDamage),
            knockbackScale: owner.knockbackScale ?? 1,
            length: built.length ?? 34,
            ttl: built.ttl ?? 20,
            bounceWalls: built.bounceWalls ?? true,
            cutsWebs: built.cutsWebs === true,
            kind: built.kind || owner.projectileKind || 'ball',
            color: owner.color || '#6b4423',
        });
    }

    /**
     * Brief jagged bolt for thunder-rod chain visuals.
     * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
     * @param {string} [color]
     */
    spawnLightningBolt(x1, y1, x2, y2, color) {
        this.lightningBolts.push({
            x1,
            y1,
            x2,
            y2,
            color: color || '#7dd3fc',
            ttl: 0.2,
            maxTtl: 0.2,
            seed: Math.random() * 1000,
        });
    }

    /** @param {number} dt */
    stepLightningBolts(dt) {
        for (const bolt of this.lightningBolts) bolt.ttl -= dt;
        this.lightningBolts = this.lightningBolts.filter((b) => b.ttl > 0);
    }

    /** Brief high-contrast zap frame centered on a struck fighter. */
    spawnLightningImpact(x, y, radius, color) {
        this.lightningImpacts.push({
            x,
            y,
            radius,
            color: color || '#facc15',
            ttl: 0.11,
            maxTtl: 0.11,
            seed: Math.random() * 1000,
        });
    }

    /** @param {number} dt */
    stepLightningImpacts(dt) {
        for (const impact of this.lightningImpacts) impact.ttl -= dt;
        this.lightningImpacts = this.lightningImpacts.filter((impact) => impact.ttl > 0);
    }

    /** Expanding blast ring (grenades, etc.). */
    spawnExplosion(x, y, radius, color) {
        const r = radius || 80;
        this.explosions.push({
            x,
            y,
            radius: r,
            color: color || '#f59e0b',
            ttl: 0.28,
            maxTtl: 0.28,
        });
        if (this.onExplosion) this.onExplosion(x, y, r);
    }

    /**
     * Shatter live projectiles (arrows, bats, …) inside a blast circle.
     * @param {number} cx
     * @param {number} cy
     * @param {number} radius
     * @param {object|null} [except] projectile to skip (the exploding one)
     * @param {Ball[]} [alive]
     */
    destroyProjectilesInRadius(cx, cy, radius, except = null, alive = null) {
        if (!this.arrows?.length || !(radius > 0)) return;
        const balls = alive || this.getAliveBalls?.() || this.balls;
        // Snapshot — nested grenade detonations may mutate arrows mid-loop.
        for (const proj of [...this.arrows]) {
            if (proj === except || proj.ttl <= 0 || proj._exploded) continue;
            const dist = Math.hypot(proj.x - cx, proj.y - cy);
            if (Math.max(0, dist - (proj.radius || 0)) >= radius) continue;

            const owner = balls.find((b) => b._arenaId === proj.ownerId) || null;
            owner?.weaponBehavior?.onProjectileShattered?.(proj, this, balls, owner);
            if (!proj._exploded) this.spawnProjectileShreds(proj);
            proj.ttl = 0;
        }
    }

    /**
     * Cut web strands that intersect a blast circle.
     * @param {number} cx
     * @param {number} cy
     * @param {number} radius
     * @param {object|null} [cutter] for SFX / callbacks
     */
    cutWebsInRadius(cx, cy, radius, cutter = null) {
        if (!this.webSegments?.length || !(radius > 0)) return;
        for (let i = this.webSegments.length - 1; i >= 0; i--) {
            const web = this.webSegments[i];
            if (!segmentCirclePenetration(web, cx, cy, radius)) continue;
            const midX = (web.x1 + web.x2) * 0.5;
            const midY = (web.y1 + web.y2) * 0.5;
            this.webSegments.splice(i, 1);
            if (this.onWebCut) {
                this.onWebCut(cutter || { spinSpeed: 6 }, web, midX, midY);
            }
        }
    }

    /** @param {number} dt */
    stepExplosions(dt) {
        for (const blast of this.explosions) blast.ttl -= dt;
        this.explosions = this.explosions.filter((blast) => blast.ttl > 0);
    }

    /** Elastic bounce — or despawn when bounceWalls is false (plasma). */
    resolveProjectileWallCollision(projectile) {
        const r = projectile.radius;
        const inset = this.wallInset;
        const minX = inset + r;
        const maxX = this.width - inset - r;
        const minY = inset + r;
        const maxY = this.height - inset - r;

        const out =
            projectile.x < minX
            || projectile.x > maxX
            || projectile.y < minY
            || projectile.y > maxY;

        if (projectile.bounceWalls === false) {
            if (out) projectile.ttl = 0;
            return;
        }

        if (projectile.x < minX) {
            projectile.x = minX;
            if (projectile.vx < 0) projectile.vx = -projectile.vx;
        } else if (projectile.x > maxX) {
            projectile.x = maxX;
            if (projectile.vx > 0) projectile.vx = -projectile.vx;
        }

        if (projectile.y < minY) {
            projectile.y = minY;
            if (projectile.vy < 0) projectile.vy = -projectile.vy;
        } else if (projectile.y > maxY) {
            projectile.y = maxY;
            if (projectile.vy > 0) projectile.vy = -projectile.vy;
        }

        projectile.angle = Math.atan2(projectile.vy, projectile.vx);
    }

    /** Shatter a projectile into flying chips. */
    spawnProjectileShreds(arrow) {
        const color = arrow.color || '#111';
        const count = 8;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
            const speed = 120 + Math.random() * 220;
            const ttl = 0.28 + Math.random() * 0.22;
            this.projectileShreds.push({
                x: arrow.x,
                y: arrow.y,
                vx: Math.cos(angle) * speed + (arrow.vx || 0) * 0.15,
                vy: Math.sin(angle) * speed + (arrow.vy || 0) * 0.15,
                r: 1.8 + Math.random() * 2.8,
                ttl,
                maxTtl: ttl,
                color,
            });
        }
    }

    /** @param {number} dt */
    stepProjectileShreds(dt) {
        for (const p of this.projectileShreds) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 420 * dt;
            p.vx *= 0.96;
            p.ttl -= dt;
        }
        this.projectileShreds = this.projectileShreds.filter((p) => p.ttl > 0);
    }

    /**
     * Melee weapons shatter projectiles; shields reverse them and steal ownership.
     * @param {object} arrow
     * @param {Ball[]} alive
     * @returns {boolean} true when the projectile was handled this frame
     */
    tryDeflectProjectile(arrow, alive) {
        for (const melee of alive) {
            if (!melee.isAlive() || this.isProjectileAlly(melee, arrow)) continue;
            if (!melee.getWeaponHitSegments) continue;
            const segments = melee.getWeaponHitSegments();
            if (!segments.length) continue;

            for (const seg of segments) {
                const hit = segmentCirclePenetration(seg, arrow.x, arrow.y, arrow.radius);
                if (!hit) continue;

                const contact = melee.weaponBehavior?.onProjectileContact;
                const action = contact ? contact(melee, arrow, this) : 'shatter';
                if (action == null) continue;
                if (action === 'stick') {
                    if (!melee._stuckProjectiles) melee._stuckProjectiles = [];
                    const dx = arrow.x - melee.x;
                    const dy = arrow.y - melee.y;
                    const dist = Math.hypot(dx, dy) || (melee.radius + 6);
                    const hitAngle = Math.atan2(dy, dx);
                    melee._stuckProjectiles.push({
                        kind: arrow.kind || 'arrow',
                        localAngle: hitAngle - melee.weaponAngle,
                        localDist: dist,
                        embedAngle: (arrow.angle ?? hitAngle) - melee.weaponAngle,
                        length: arrow.length ?? 28,
                        color: arrow.color,
                    });
                    if (melee._stuckProjectiles.length > 10) {
                        melee._stuckProjectiles.splice(0, melee._stuckProjectiles.length - 10);
                    }
                    arrow.ttl = 0;
                    if (this.onShieldReflect && melee.weaponBehavior?.blocksMelee?.()) {
                        this.onShieldReflect(melee, null, 0);
                    } else if (this.onProjectileDeflect) {
                        this.onProjectileDeflect(melee, arrow);
                    }
                    return true;
                }
                if (action === 'reflect') {
                    arrow.vx = -arrow.vx;
                    arrow.vy = -arrow.vy;
                    arrow.angle = Math.atan2(arrow.vy, arrow.vx);
                    arrow.ownerId = melee._arenaId;
                    arrow.color = melee.color || arrow.color;
                    const mag = Math.hypot(arrow.vx, arrow.vy);
                    if (mag > 1e-6) {
                        const push = arrow.radius + 3;
                        arrow.x += (arrow.vx / mag) * push;
                        arrow.y += (arrow.vy / mag) * push;
                    }
                    if (this.onShieldReflect && melee.weaponBehavior?.blocksMelee?.()) {
                        this.onShieldReflect(melee, null, 0);
                    } else if (this.onProjectileDeflect) {
                        this.onProjectileDeflect(melee, arrow);
                    }
                    return true;
                }
                if (action !== 'shatter') continue;

                const owner = alive.find((b) => b._arenaId === arrow.ownerId) || null;
                owner?.weaponBehavior?.onProjectileShattered?.(arrow, this, alive, owner);
                if (!arrow._exploded) this.spawnProjectileShreds(arrow);
                if (this.onProjectileDeflect) this.onProjectileDeflect(melee, arrow);
                arrow.ttl = 0;
                return true;
            }
        }
        return false;
    }

    /** @param {number} dt @param {Ball[]} alive */
    stepArrows(dt, alive) {
        for (const arrow of this.arrows) {
            const owner = alive.find((b) => b._arenaId === arrow.ownerId) || null;
            owner?.weaponBehavior?.stepProjectile?.(arrow, dt, this, alive, owner);
            if (arrow.ttl <= 0) continue;

            // Refresh pierce hit locks after cooldown.
            if (arrow._hitCooldown?.size) {
                for (const [id, left] of [...arrow._hitCooldown.entries()]) {
                    const next = left - dt;
                    if (next <= 0) {
                        arrow._hitCooldown.delete(id);
                        arrow._hitIds?.delete?.(id);
                    } else {
                        arrow._hitCooldown.set(id, next);
                    }
                }
            }

            arrow._prevX = arrow.x;
            arrow._prevY = arrow.y;
            arrow.x += arrow.vx * dt;
            arrow.y += arrow.vy * dt;
            arrow.ttl -= dt;

            this.resolveProjectileWallCollision(arrow);
            if (arrow.ttl <= 0) continue;

            if (this.tryDeflectProjectile(arrow, alive)) continue;

            const projR = arrow.radius;
            for (const defender of alive) {
                if (!defender.isAlive() || this.isProjectileAlly(defender, arrow)) continue;
                if (arrow._hitIds?.has?.(defender._arenaId)) continue;

                const dx = defender.x - arrow.x;
                const dy = defender.y - arrow.y;
                const dist = Math.hypot(dx, dy);
                const minDist = defender.radius + projR;
                const sweptHit = arrow.continuousCollision && dist >= minDist
                    ? segmentCirclePenetration({
                        x1: arrow._prevX,
                        y1: arrow._prevY,
                        x2: arrow.x,
                        y2: arrow.y,
                    }, defender.x, defender.y, minDist)
                    : null;
                if (dist >= minDist && !sweptHit) continue;

                let nx;
                let ny;
                let penetration;
                if (sweptHit) {
                    const speed = Math.hypot(arrow.vx, arrow.vy) || 1;
                    nx = arrow.vx / speed;
                    ny = arrow.vy / speed;
                    penetration = 0;
                } else if (dist < 1e-6) {
                    nx = Math.cos(arrow.angle);
                    ny = Math.sin(arrow.angle);
                    penetration = minDist;
                } else {
                    nx = dx / dist;
                    ny = dy / dist;
                    penetration = minDist - dist;
                }

                if (owner?.weaponBehavior?.skipsProjectileHitResolve?.(arrow) !== true) {
                    this.resolveArrowHit(arrow, owner, defender, {
                        nx,
                        ny,
                        penetration,
                    });
                }
                if (!arrow._hitIds) arrow._hitIds = new Set();
                arrow._hitIds.add(defender._arenaId);
                const consume = owner?.weaponBehavior?.consumeProjectileOnHit?.(arrow, defender, this);
                if (consume !== false) {
                    arrow.ttl = 0;
                } else {
                    // Pierce: allow re-hit after a short cooldown (bats, etc.).
                    const rehit = owner?.weaponBehavior?.getProjectileHitCooldown?.(arrow, defender);
                    if (rehit > 0) {
                        if (!arrow._hitCooldown) arrow._hitCooldown = new Map();
                        arrow._hitCooldown.set(defender._arenaId, rehit);
                    }
                }
                break;
            }
        }

        this.arrows = this.arrows.filter((a) => a.ttl > 0);
    }

    /**
     * @param {{ damage: number, knockbackScale: number, color: string }} arrow
     * @param {WeaponBall|null} owner
     * @param {Ball} defender
     * @param {{ nx: number, ny: number, penetration: number }} hit
     */
    resolveArrowHit(arrow, owner, defender, hit) {
        const { nx, ny, penetration } = hit;
        defender.x += nx * penetration;

        const knockback = arrow.knockbackScale ?? 1;
        const push = 140 * knockback;
        defender.vx += nx * push;
        defender.vy += ny * push;

        const applied = this.applyCombatDamage(owner || null, defender, arrow.damage);
        if (this.onWeaponHit && owner && applied > 0) {
            this.onWeaponHit(owner, defender, applied);
        }
        if (owner?.weaponBehavior?.skipsProjectileStrikeSlow?.(arrow) !== true) {
            this._triggerStrikeSlow();
        }
    }

    /**
     * Push and deflect defender off the blade — mirrors ball–ball collision bounce.
     * @param {WeaponBall} attacker
     * @param {Ball} defender
     * @param {{ contact: { x: number, y: number }, nx: number, ny: number, penetration: number }} hit
     * @returns {boolean} true when blades are penetrating the defender
     */
    resolveWeaponDeflection(attacker, defender, hit) {
        const { contact, nx, ny, penetration } = hit;

        defender.x += nx * penetration;
        defender.y += ny * penetration;

        const rcx = contact.x - attacker.x;
        const rcy = contact.y - attacker.y;
        const spin = attacker.spinSpeed || 0;
        const weaponVx = attacker.vx - spin * rcy;
        const weaponVy = attacker.vy + spin * rcx;

        const e = this.restitution;
        const waN = weaponVx * nx + weaponVy * ny;
        const vbN = defender.vx * nx + defender.vy * ny;

        if (waN > 0 && attacker.weaponBehavior?.appliesRecoil?.() !== false) {
            attacker.vx -= (1 + e) * waN * nx;
            attacker.vy -= (1 + e) * waN * ny;
        }
        if (vbN < 0) {
            const knockback = attacker.knockbackScale ?? 1;
            defender.vx -= (1 + e) * vbN * nx * knockback;
            defender.vy -= (1 + e) * vbN * ny * knockback;
        }

        return true;
    }

    /** @param {Ball[]} alive */
    resolveWeaponHits(alive) {
        for (let i = 0; i < alive.length; i++) {
            for (let j = 0; j < alive.length; j++) {
                if (i === j) continue;
                const attacker = alive[i];
                const defender = alive[j];
                if (this.sameTeam(attacker, defender)) continue;
                if (!attacker.getWeaponHitSegments || !attacker.isAlive() || !defender.isAlive()) continue;
                if (attacker.weaponBehavior?.canDealMeleeDamage?.() === false) continue;

                const segments = attacker.getWeaponHitSegments();
                let hit = null;
                let hitSeg = null;
                for (const seg of segments) {
                    const segHit = segmentCirclePenetration(seg, defender.x, defender.y, defender.radius);
                    if (segHit && (!hit || segHit.penetration > hit.penetration)) {
                        hit = segHit;
                        hitSeg = seg;
                    }
                }

                if (!hit) {
                    this._clearPairEffectCooldown(attacker, defender);
                    continue;
                }

                this.resolveWeaponDeflection(attacker, defender, hit);

                if (defender.weaponBehavior?.blocksMelee?.() && this.weaponsClash(attacker, defender)) {
                    this.resolveShieldReflect(attacker, defender);
                    continue;
                }

                if (!this._canWeaponHit(attacker, defender)) continue;

                const dmg = hitSeg?.damage
                    ?? (attacker.getWeaponDamage ? attacker.getWeaponDamage() : attacker.weaponDamage);
                if (!(dmg > 0)) {
                    this._markWeaponHit(attacker, defender);
                    continue;
                }
                const applied = this.applyCombatDamage(attacker, defender, dmg);
                if (attacker.registerWeaponHit) attacker.registerWeaponHit();
                if (applied > 0 && this.onWeaponHit) this.onWeaponHit(attacker, defender, applied);
                attacker.weaponBehavior?.onMeleeHit?.(attacker, defender, this);
                this._markWeaponHit(attacker, defender);
            }
        }
    }
}
