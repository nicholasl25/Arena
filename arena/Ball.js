/**
 * Fighting ball — simple base class for arena combat sims.
 * Subclass and override computeDamage() to define attack rules.
 */
class Ball {
    /** @param {number} value */
    static toHealthInt(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
    }

    /** @param {Ball} obj @param {'health'|'maxHealth'} key @param {number} initial */
    static _bindHealthProperty(obj, key, initial) {
        let value = Ball.toHealthInt(initial);
        Object.defineProperty(obj, key, {
            get() {
                return value;
            },
            set(v) {
                value = Ball.toHealthInt(v);
            },
            enumerable: true,
            configurable: true,
        });
    }

    /**
     * @param {object} opts
     * @param {number} opts.x
     * @param {number} opts.y
     * @param {number} [opts.vx=0]
     * @param {number} [opts.vy=0]
     * @param {number} [opts.radius=45]
     * @param {number} opts.health
     * @param {string} [opts.color='#22d3ee']
     * @param {string} [opts.name='Ball']
     * @param {number} [opts.mass] defaults to radius²
     */
    constructor({ x, y, vx = 0, vy = 0, radius = 45, health, maxHealth, color = '#22d3ee', name = 'Ball', mass }) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = radius;
        Ball._bindHealthProperty(this, 'health', health);
        Ball._bindHealthProperty(this, 'maxHealth', maxHealth != null ? maxHealth : health);
        this.collisionCount = 0;
        this.color = color;
        this.name = name;
        this.mass = mass != null ? mass : radius * radius;
    }

  /**
   * How much damage this ball deals to other on impact.
   * @param {Ball} other
   * @param {number} impactSpeed relative closing speed along the collision normal
   * @returns {number}
   */
    computeDamage(other, impactSpeed) {
        return Math.max(1, impactSpeed * 0.4);
    }

    /**
     * @param {number} amount
     * @returns {number} damage actually applied after damageTakenMult
     */
    takeDamage(amount) {
        if (!(amount > 0)) return 0;
        const scale = Number(this.damageTakenMult);
        if (Number.isFinite(scale) && scale >= 0 && scale !== 1) {
            amount *= scale;
        }
        if (!(amount > 0)) return 0;
        this.health = Math.max(0, this.health - amount);
        const flash = amount >= 12 ? 0.14 : 0.09;
        this.hitFlash = Math.max(this.hitFlash || 0, flash);
        this.onHealthChanged();
        return amount;
    }

    /** Called after health changes (damage, effects, etc.). */
    onHealthChanged() {}

    isAlive() {
        return this.health > 0;
    }

    /**
     * Whether this ball participates in collisions with other.
     * @param {Ball} other
     * @returns {boolean}
     */
    shouldCollideWith(other) {
        return true;
    }

    /**
     * Skip damage/effects/split when true — physical bounce still runs.
     * @param {Ball} other
     * @returns {boolean}
     */
    skipGameCollisionEffects(other) {
        return false;
    }

    /**
     * Special effect on the other ball after impact damage, before onCollision.
     * @param {Ball} other
     */
    applyCollisionEffect(other) {}

    /**
     * Called after a ball–ball collision is resolved (damage already applied).
     * @param {Ball} other
     * @param {number} impactSpeed
     * @param {ArenaSim} [sim]
     * @param {{ healthBeforeEffects?: number, massBeforeEffects?: number }} [ctx]
     */
    onCollision(other, impactSpeed, sim, ctx) {
        this.collisionCount += 1;
    }

    healthFraction() {
        return this.maxHealth > 0 ? this.health / this.maxHealth : 0;
    }
}
