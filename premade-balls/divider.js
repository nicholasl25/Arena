/**
 * Divider — halves the other ball's health on collision.
 * Depends: Ball, PremadeBallRegistry
 */
(function () {
    'use strict';

    class DividerBall extends Ball {
        computeDamage() {
            return 0;
        }

        applyCollisionEffect(other) {
            if (!other.isAlive()) return;
            other.health = other.health / 2;
            other.onHealthChanged();
        }
    }

    window.DividerBall = DividerBall;

    PremadeBallRegistry.register('divider', 'DIVIDER', {
        name: 'Divider',
        color: '#f472b6',
        Cls: DividerBall,
        radius: 45,
        health: 10000,
        mass: 64,
        fontName: 'Russo One',
        bio: 'On impact, cuts the other ball\'s health in half.',
    });
}());
