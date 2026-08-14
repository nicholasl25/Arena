/**
 * Premade ball catalog — loads after individual ball files register themselves.
 * Exposes: window.PremadeBalls
 *
 * To add a fighter:
 *   1. Add premade-balls/your-ball.js (class + PremadeBallRegistry.register)
 *   2. Include the script in pages/index.html after registry.js
 *   3. Add its id to DEFAULT_MATCHUP below (or pass ids to createMatchupRoster)
 */
(function () {
    'use strict';

    const registry = window.PremadeBallRegistry;
    if (!registry) {
        throw new Error('PremadeBalls: missing PremadeBallRegistry (load registry.js first)');
    }

    const PremadeBallId = registry.getPremadeBallId();
    const PREMADE_BALLS = registry.getPremadeBalls();

    const DEFAULT_MATCHUP = [PremadeBallId.EXPONENTIAL, PremadeBallId.DIVIDER];

    function getPremadeBall(id) {
        return registry.getPremadeBall(id);
    }

    function createPremadeBall(id, spawn, overrides = {}) {
        const spec = getPremadeBall(id);
        if (!spec) {
            throw new Error(`Unknown premade ball: ${id}`);
        }
        const ball = new spec.Cls({
            x: spawn.x,
            y: spawn.y,
            vx: spawn.vx ?? 0,
            vy: spawn.vy ?? 0,
            radius: spec.radius,
            health: spec.health,
            mass: spec.mass,
            color: spec.color,
            name: spec.name,
            ...overrides,
        });
        ball.premadeId = id;
        ball.bio = spec.bio;
        ball.displayFont = spec.fontName || 'Bebas Neue';
        return ball;
    }

    function createMatchupRoster(ids, spawnFn) {
        return ids.map((id) => {
            const spec = getPremadeBall(id);
            if (!spec) {
                throw new Error(`Unknown premade ball: ${id}`);
            }
            return createPremadeBall(id, spawnFn(spec));
        });
    }

    window.PremadeBalls = {
        PremadeBallId,
        PREMADE_BALLS,
        DEFAULT_MATCHUP,
        MultiplierBall: window.MultiplierBall,
        DividerBall: window.DividerBall,
        ExponentialBall: window.ExponentialBall,
        getPremadeBall,
        createPremadeBall,
        createMatchupRoster,
    };
}());
