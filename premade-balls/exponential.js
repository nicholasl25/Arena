/**
 * Exponential — damage doubles after every ball–ball collision.
 * Depends: Ball, PremadeBallRegistry
 */
(function () {
    'use strict';

    class ExponentialBall extends Ball {
        constructor(opts) {
            super(opts);
            this.baseDamage = opts.baseDamage ?? 1;
            this.currentDamage = this.baseDamage;
        }

        computeDamage() {
            return this.currentDamage;
        }

        onCollision(other, impactSpeed, sim, ctx) {
            super.onCollision(other, impactSpeed, sim, ctx);
            this.currentDamage *= 2;
        }
    }

    window.ExponentialBall = ExponentialBall;

    PremadeBallRegistry.register('exponential', 'EXPONENTIAL', {
        name: 'Exponential',
        color: '#eab308',
        Cls: ExponentialBall,
        radius: 45,
        health: 10000,
        mass: 64,
        fontName: 'Bebas Neue',
        bio: 'Each collision doubles the damage it deals on the next hit.',
    });
}());
