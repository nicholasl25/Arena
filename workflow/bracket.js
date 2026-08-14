/**
 * Tournament bracket state for Long YouTube workflow.
 * Pure logic — no DOM. Works in browser and Node tests.
 */
(function (root) {
    'use strict';

    function nextPowerOf2(n) {
        let p = 1;
        while (p < n) p *= 2;
        return p;
    }

    function hashSeed(str) {
        let h = 2166136261;
        const s = String(str || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function fighterKey(f) {
        if (!f) return '';
        return f.slotKey || `${f.id}:${f.name || ''}`;
    }

    /**
     * Stable identity for one tournament matchup (round slot + fighters).
     * Survives preview rebuilds that recreate the same bracket from the same roster.
     */
    function matchComposeKey(match) {
        if (!match?.id) return '';
        const a = fighterKey(match.a);
        const b = fighterKey(match.b);
        if (!a || !b) return '';
        return `${match.id}|${a}|${b}`;
    }

    function normalizeFighter(entry, index) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('WorkflowBracket: fighter entry required');
        }
        const id = entry.id;
        if (!id) throw new Error('WorkflowBracket: each fighter needs an id');
        const name = (typeof entry.name === 'string' && entry.name.trim())
            ? entry.name.trim()
            : String(id);
        const color = (typeof entry.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.color))
            ? entry.color
            : '#888888';
        const weaponId = entry.weaponId || entry.arenaMatchup?.config?.weaponId || null;
        const weaponIcon = entry.weaponIcon
            || (typeof window !== 'undefined' ? window.PremadeWeapons?.iconUrl?.(weaponId) : null)
            || null;
        return {
            id,
            name,
            color,
            slotIndex: Number.isInteger(entry.slotIndex) ? entry.slotIndex : index,
            slotKey: entry.slotKey || `slot-${index}:${id}`,
            weaponId,
            weaponIcon,
            skinId: entry.skinId || (id !== '_weapon' ? id : null),
            powerupId: entry.powerupId
                || entry.arenaMatchup?.config?.powerupId
                || null,
            arenaMatchup: entry.arenaMatchup
                ? {
                    id: entry.arenaMatchup.id,
                    config: { ...(entry.arenaMatchup.config || {}) },
                }
                : null,
        };
    }

    function fighterArenaMatchup(fighter) {
        if (!fighter) return null;
        if (fighter.arenaMatchup?.id) {
            const config = { ...(fighter.arenaMatchup.config || {}) };
            if (fighter.powerupId) config.powerupId = fighter.powerupId;
            else delete config.powerupId;
            return {
                id: fighter.arenaMatchup.id,
                config,
            };
        }
        // Migration fallback for brackets saved before arenaMatchup was persisted.
        const config = {};
        if (fighter.weaponId) config.weaponId = fighter.weaponId;
        if (fighter.name) config.name = fighter.name;
        if (fighter.color) config.color = fighter.color;
        if (fighter.powerupId) config.powerupId = fighter.powerupId;
        return {
            id: fighter.skinId || fighter.id,
            config,
        };
    }

    function matchArenaMatchup(match) {
        if (!match?.a || !match?.b) {
            throw new Error('WorkflowBracket: active match requires exactly two fighters');
        }
        return [fighterArenaMatchup(match.a), fighterArenaMatchup(match.b)];
    }

    /**
     * Build a single-elimination bracket. Pads with byes to next power of 2.
     * @param {object[]} fighters
     * @returns {{ size: number, rounds: object[][], fighters: object[], complete: boolean, champion: object|null }}
     */
    function buildFromFighters(fighters) {
        if (!Array.isArray(fighters) || fighters.length < 2) {
            throw new Error('WorkflowBracket: need at least 2 fighters');
        }
        const roster = fighters.map(normalizeFighter);
        const size = nextPowerOf2(roster.length);
        const seeds = roster.slice();
        while (seeds.length < size) seeds.push(null);

        const rounds = [];
        const round0 = [];
        for (let i = 0; i < size; i += 2) {
            const a = seeds[i];
            const b = seeds[i + 1];
            const bye = !a || !b;
            let winner = null;
            if (a && !b) winner = a;
            else if (b && !a) winner = b;
            round0.push({
                id: `r0m${i / 2}`,
                round: 0,
                index: i / 2,
                a,
                b,
                winner,
                bye,
                decided: bye,
            });
        }
        rounds.push(round0);

        let prev = round0;
        let round = 1;
        while (prev.length > 1) {
            const next = [];
            for (let i = 0; i < prev.length; i += 2) {
                next.push({
                    id: `r${round}m${i / 2}`,
                    round,
                    index: i / 2,
                    a: null,
                    b: null,
                    winner: null,
                    bye: false,
                    decided: false,
                    from: [prev[i].id, prev[i + 1].id],
                });
            }
            rounds.push(next);
            prev = next;
            round += 1;
        }

        const state = {
            size,
            rounds,
            fighters: roster,
            complete: false,
            champion: null,
        };
        settleByes(state);
        return state;
    }

    function settleByes(state) {
        let changed = true;
        while (changed) {
            changed = false;
            for (let r = 0; r < state.rounds.length; r++) {
                for (const match of state.rounds[r]) {
                    if (match.decided && match.winner) {
                        if (promote(state, match)) changed = true;
                    }
                }
            }
        }
        refreshStatus(state);
    }

    function promote(state, match) {
        if (!match.winner || match.round >= state.rounds.length - 1) return false;
        const nextRound = state.rounds[match.round + 1];
        const nextMatch = nextRound[Math.floor(match.index / 2)];
        if (!nextMatch) return false;
        const slot = match.index % 2 === 0 ? 'a' : 'b';
        if (nextMatch[slot] && fighterKey(nextMatch[slot]) === fighterKey(match.winner)) {
            return false;
        }
        nextMatch[slot] = match.winner;
        if (nextMatch.a && nextMatch.b) {
            nextMatch.bye = false;
        } else if (nextMatch.a || nextMatch.b) {
            // Wait for the other feeder unless both feeders already decided with one bye path.
            const feeders = (nextMatch.from || []).map((id) => findMatch(state, id));
            const bothDecided = feeders.every((m) => m?.decided);
            if (bothDecided && (nextMatch.a || nextMatch.b) && !(nextMatch.a && nextMatch.b)) {
                nextMatch.winner = nextMatch.a || nextMatch.b;
                nextMatch.bye = true;
                nextMatch.decided = true;
            }
        }
        return true;
    }

    function findMatch(state, id) {
        for (const round of state.rounds) {
            for (const match of round) {
                if (match.id === id) return match;
            }
        }
        return null;
    }

    function refreshStatus(state) {
        const final = state.rounds[state.rounds.length - 1]?.[0];
        if (final?.decided && final.winner) {
            state.complete = true;
            state.champion = final.winner;
        } else {
            state.complete = false;
            state.champion = null;
        }
    }

    /** Next undecided match that has both sides filled (or a live 1v1). */
    function currentMatch(state) {
        if (!state || state.complete) return null;
        for (const round of state.rounds) {
            for (const match of round) {
                if (match.decided) continue;
                if (match.a && match.b) return match;
            }
        }
        return null;
    }

    function listPendingMatches(state) {
        const out = [];
        for (const round of state.rounds) {
            for (const match of round) {
                if (!match.decided && match.a && match.b) out.push(match);
            }
        }
        return out;
    }

    /** Actual fights needed: N entrants require N-1 decisive matches (byes excluded). */
    function fightMatchTotal(state) {
        const n = state?.fighters?.length || 0;
        return Math.max(0, n - 1);
    }

    /** Decisive (non-bye) matches already decided in bracket state. */
    function decidedFightCount(state) {
        if (!state?.rounds) return 0;
        let count = 0;
        for (const round of state.rounds) {
            for (const match of round) {
                if (match.decided && !match.bye) count += 1;
            }
        }
        return count;
    }

    /**
     * Per-cell tournament progress for Bracket / Powerup / Arena / Voice Over.
     *
     * Semantics (monotonic, phase-aware):
     * - total = fighters.length - 1 (bye auto-advances never inflate the denominator)
     * - Bracket counts a matchup once its pre-match bracket phase is presented
     *   (decided + 1 while a pending match is shown; equals decided during
     *   compose / result-advance for that same matchup)
     * - Arena counts matchups that have entered Arena (decided, plus +1 while
     *   phase === 'arena' before the winner is applied)
     * - composeCount is the Voice Over total (idempotent store size)
     */
    function tournamentCellProgress({ state, composeCount = 0, phase = null } = {}) {
        const total = fightMatchTotal(state);
        if (!total) {
            return { total: 0, bracket: 0, powerup: 0, arena: 0, compose: 0 };
        }
        const decided = decidedFightCount(state);
        const compose = Math.min(total, Math.max(0, Number(composeCount) || 0));

        if (state.complete || phase === 'champion') {
            return {
                total,
                bracket: total,
                powerup: total,
                arena: total,
                compose: Math.min(total, Math.max(compose, total)),
            };
        }

        const inResultPipeline = phase === 'compose' || phase === 'bracket-advance';
        let bracket;
        let powerup;
        let arena;
        if (inResultPipeline) {
            // Winner already applied: still this matchup's cycle, not the next intro.
            bracket = decided;
            powerup = decided;
            arena = decided;
        } else if (phase === 'arena') {
            bracket = decided + 1;
            powerup = decided + 1;
            arena = decided + 1;
        } else if (phase === 'powerup-spin') {
            bracket = decided + 1;
            powerup = decided + 1;
            arena = decided;
        } else {
            // bracket-intro / idle: presenting the next pending matchup picture.
            const hasPending = Boolean(currentMatch(state));
            bracket = decided + (hasPending ? 1 : 0);
            powerup = decided;
            arena = decided;
        }

        return {
            total,
            bracket: Math.min(total, Math.max(0, bracket)),
            powerup: Math.min(total, Math.max(0, powerup)),
            arena: Math.min(total, Math.max(0, arena)),
            compose,
        };
    }

    /**
     * Authoritative end-of-tournament gate for unlocking Post YouTube.
     * Requires champion, every decisive match decided, and one compose per fight.
     * Callers should prefer persisted bracket state (written only after the final
     * VO + bracket-advance finish) so the final Arena/VO/advance stay locked.
     */
    function isTournamentComplete(state, composeCount = 0) {
        const total = fightMatchTotal(state);
        if (!total || !state?.complete || !state.champion) return false;
        if (decidedFightCount(state) < total) return false;
        const compose = Math.max(0, Number(composeCount) || 0);
        return compose >= total;
    }

    /**
     * Pick a deterministic demo winner for a match (stable across reloads).
     */
    function pickDemoWinner(match) {
        if (!match?.a || !match?.b) {
            return match?.a || match?.b || null;
        }
        const seed = hashSeed(`${fighterKey(match.a)}|${fighterKey(match.b)}|${match.id}`);
        return seed % 2 === 0 ? match.a : match.b;
    }

    function normalizeWinnerName(value) {
        return String(value || '')
            .replace(/\s+with\s+[A-Za-z][\w'-]*$/i, '')
            .trim()
            .toLowerCase();
    }

    function matchFighterByWinnerName(match, winnerName) {
        const want = normalizeWinnerName(winnerName);
        if (!match || !want) return null;
        const aName = normalizeWinnerName(match.a?.name);
        const bName = normalizeWinnerName(match.b?.name);
        if (want === aName) return match.a;
        if (want === bName) return match.b;
        if (aName && want.includes(aName)) return match.a;
        if (bName && want.includes(bName)) return match.b;
        return null;
    }

    function applyWinnerName(state, winnerName) {
        const match = currentMatch(state);
        if (!match) throw new Error('WorkflowBracket: no open match');
        const fighter = matchFighterByWinnerName(match, winnerName);
        if (!fighter) {
            throw new Error(`WorkflowBracket: winner "${winnerName}" is not in this match`);
        }
        return applyWinner(state, fighter);
    }

    function applyWinner(state, winner) {
        if (!state) throw new Error('WorkflowBracket: state required');
        const match = currentMatch(state);
        if (!match) throw new Error('WorkflowBracket: no open match');
        const key = fighterKey(winner);
        const aKey = fighterKey(match.a);
        const bKey = fighterKey(match.b);
        if (key !== aKey && key !== bKey) {
            throw new Error('WorkflowBracket: winner must be one of the match fighters');
        }
        match.winner = key === aKey ? match.a : match.b;
        match.decided = true;
        match.bye = false;
        settleByes(state);
        return match;
    }

    function applyDemoWinner(state) {
        const match = currentMatch(state);
        if (!match) return null;
        const winner = pickDemoWinner(match);
        applyWinner(state, winner);
        return { match, winner };
    }

    function clone(state) {
        return JSON.parse(JSON.stringify(state));
    }

    function roundLabel(roundIndex, totalRounds) {
        const fromEnd = totalRounds - 1 - roundIndex;
        if (fromEnd === 0) return 'Final';
        if (fromEnd === 1) return 'Semifinals';
        if (fromEnd === 2) return 'Quarterfinals';
        // First round size = 2^(totalRounds-1); this round has 2^(fromEnd) matches → 2*matches players.
        const playersHere = 2 ** (fromEnd + 1);
        if (playersHere >= 16) return `Round of ${playersHere}`;
        return `Round ${roundIndex + 1}`;
    }

    const api = {
        nextPowerOf2,
        buildFromFighters,
        currentMatch,
        listPendingMatches,
        fightMatchTotal,
        decidedFightCount,
        tournamentCellProgress,
        isTournamentComplete,
        pickDemoWinner,
        applyWinner,
        applyWinnerName,
        matchFighterByWinnerName,
        applyDemoWinner,
        clone,
        roundLabel,
        fighterKey,
        fighterArenaMatchup,
        matchArenaMatchup,
        matchComposeKey,
        settleByes,
    };

    root.WorkflowBracket = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
