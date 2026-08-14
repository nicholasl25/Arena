/**
 * Multiplier — splits into two on collision; each copy gets half the pre-split health and mass.
 * Depends: Ball, PremadeBallRegistry
 */
(function () {
    'use strict';

    class MultiplierBall extends Ball {
        constructor(opts) {
            super(opts);
            this.baseRadius = opts.baseRadius ?? this.radius;
            this.updateRadiusFromHealth();
        }

        /** Dies only when health is strictly below 1. */
        isAlive() {
            return this.health >= 1;
        }

        computeDamage(other) {
            return 10;
        }

        /** Same contender — pass through each other (no physics, damage, or split). */
        shouldCollideWith(other) {
            return !(other instanceof MultiplierBall);
        }

        onHealthChanged() {
            this.updateRadiusFromHealth();
        }

        updateRadiusFromHealth() {
            const frac = this.maxHealth > 0 ? Math.max(0, this.health / this.maxHealth) : 0;
            this.radius = this.baseRadius * Math.pow(frac, 0.125);
        }

        /**
         * @param {Ball} other
         * @param {number} impactSpeed
         * @param {ArenaSim} [sim]
         * @param {{ healthBeforeEffects?: number, massBeforeEffects?: number }} [ctx]
         */
        onCollision(other, impactSpeed, sim, ctx) {
            super.onCollision(other, impactSpeed, sim, ctx);
            if (!this.isAlive() || !sim) return;

            const healthForSplit = ctx?.healthBeforeEffects ?? this.health;
            const massForSplit = ctx?.massBeforeEffects ?? this.mass;
            const halfHealth = healthForSplit / 2;
            const halfMass = massForSplit / 2;
            if (halfHealth < 1) {
                this.health = 0;
                this.onHealthChanged();
                return;
            }

            this.health = halfHealth;
            this.mass = halfMass;
            this.onHealthChanged();
            const clone = this.spawnClone(halfHealth, halfMass);
            const posThis = sim.randomArenaPosition(this.radius, [this]);
            this.x = posThis.x;
            this.y = posThis.y;
            const posClone = sim.randomArenaPosition(clone.radius);
            clone.x = posClone.x;
            clone.y = posClone.y;
            sim.addBall(clone);
        }

        spawnClone(health, mass) {
            const ball = new MultiplierBall({
                x: this.x,
                y: this.y,
                vx: this.vx,
                vy: this.vy,
                baseRadius: this.baseRadius,
                radius: this.baseRadius,
                health,
                mass,
                maxHealth: this.maxHealth,
                color: this.color,
                name: this.name,
            });
            ball.collisionCount = this.collisionCount;
            ball.premadeId = this.premadeId;
            ball.bio = this.bio;
            ball.displayFont = this.displayFont;
            ball._slotIndex = this._slotIndex;
            return ball;
        }
    }

    window.MultiplierBall = MultiplierBall;

    PremadeBallRegistry.register('multiplier', 'MULTIPLIER', {
        name: 'Multiplier',
        color: '#22d3ee',
        Cls: MultiplierBall,
        radius: 45,
        health: 32,
        mass: 64,
        fontName: 'Orbitron',
        bio: 'On impact, splits into two — each copy gets half the ball\'s health after the hit.',
    });
}());
