/**
 * Headless fight batch runner — no frames, no audio, winner stats only.
 * Exposes: window.FightSim
 *
 * Depends: ArenaApp
 *
 * Example:
 *   await FightSim.simulate({
 *     mode: 'weapon',
 *     matchup: [
 *       { id: '_weapon', config: { weaponId: 'sword' } },
 *       { id: '_weapon', config: { weaponId: 'laser' } },
 *     ],
 *     trials: 100,
 *   });
 */
(function () {
    'use strict';

    function fighterKey(fighter) {
        if (!fighter) return 'unknown';
        const parts = [fighter.id || fighter.name || `slot${fighter.slotIndex}`];
        if (fighter.weaponId) parts.push(fighter.weaponId);
        return parts.join(':');
    }

    function labelFor(fighter) {
        if (!fighter) return 'unknown';
        if (fighter.name) return fighter.name;
        if (fighter.weaponId && fighter.id === '_weapon') return fighter.weaponId;
        return fighter.id || `slot${fighter.slotIndex}`;
    }

    /**
     * @param {object} payload
     * @param {'collision'|'weapon'} [payload.mode]
     * @param {object[]} payload.matchup
     * @param {number} [payload.trials=1]
     * @param {number} [payload.maxSeconds=90]
     * @param {number} [payload.dt=1/30]
     */
    async function simulate(payload) {
        const app = window.ArenaApp;
        if (!app?.simulateFight) {
            throw new Error('FightSim: ArenaApp.simulateFight not loaded');
        }
        await app.whenReady();

        const mode = payload?.mode === 'weapon' ? 'weapon' : 'collision';
        const matchup = Array.isArray(payload?.matchup) ? payload.matchup : null;
        if (!matchup || matchup.length < 2) {
            throw new Error('FightSim: matchup needs at least 2 fighters');
        }

        const trials = Math.max(1, Math.floor(Number(payload?.trials) || 1));
        const maxSeconds = Number(payload?.maxSeconds) > 0 ? Number(payload.maxSeconds) : 90;
        const dt = Number(payload?.dt) > 0 ? Number(payload.dt) : 1 / 30;

        const t0 = performance.now();
        /** @type {object[]} */
        const fights = [];
        /** @type {Record<string, { key: string, label: string, wins: number }>} */
        const winCounts = {};
        let draws = 0;
        let timeouts = 0;

        for (let i = 0; i < trials; i++) {
            const result = app.simulateFight({ mode, matchup, maxSeconds, dt });
            fights.push(result);
            if (result.timedOut) {
                timeouts += 1;
                continue;
            }
            if (result.draw || !result.winner) {
                draws += 1;
                continue;
            }
            const key = fighterKey(result.winner);
            if (!winCounts[key]) {
                winCounts[key] = { key, label: labelFor(result.winner), wins: 0 };
            }
            winCounts[key].wins += 1;
        }

        const elapsedMs = performance.now() - t0;
        const standings = Object.values(winCounts)
            .map((row) => ({
                ...row,
                rate: row.wins / trials,
            }))
            .sort((a, b) => b.wins - a.wins);

        return {
            mode,
            trials,
            maxSeconds,
            dt,
            draws,
            timeouts,
            elapsedMs: Math.round(elapsedMs),
            fightsPerSec: elapsedMs > 0 ? Math.round((trials / elapsedMs) * 1000) : trials,
            standings,
            /** Last fight detail (handy for trials=1). */
            last: fights[fights.length - 1] || null,
            /** Per-trial results — omit when large batches unless requested. */
            fights: trials <= 50 || payload?.includeFights ? fights : undefined,
        };
    }

    window.FightSim = { simulate };
}());
