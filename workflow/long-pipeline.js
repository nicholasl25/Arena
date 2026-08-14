/**
 * Long YouTube pipeline cells — the graph is a view of this registry.
 * Each cell's input is the validated JSON output of the previous cell.
 *
 * Flow:
 *   setup → TournamentSetup
 *   bracket → BracketState (+ recorded pre/post frames during compose from that JSON)
 *   powerup → PowerupSpinResult (optional; skipped when the node is off)
 *   record (Arena) → ArenaResult (winner) applied into BracketState
 *   compose (Voice Over) → MatchSegment
 *   (loop bracket←compose until champion)
 *   stitch → TournamentFinal → youtube
 */
(function (root) {
    'use strict';

    /** @type {readonly object[]} */
    const CELLS = Object.freeze([
        {
            id: 'setup',
            label: 'Make setup',
            input: null,
            output: 'TournamentSetup',
            produces: 'Roster + mode saved for the tournament',
        },
        {
            id: 'bracket',
            label: 'Bracket',
            input: 'TournamentSetup',
            output: 'BracketState',
            produces: 'Bracket tree JSON; frames recorded from this JSON (pre/post)',
        },
        {
            id: 'powerup',
            label: 'Powerup',
            input: 'ActiveMatch',
            output: 'PowerupSpinResult',
            optional: true,
            produces: 'Wheel result applied onto the current ActiveMatch (toggleable)',
        },
        {
            id: 'record',
            label: 'Arena',
            input: 'ActiveMatch',
            output: 'ArenaResult',
            produces: 'Winner/loser for the current matchup',
        },
        {
            id: 'compose',
            label: 'Voice Over',
            input: 'MatchSegmentRequest',
            output: 'MatchSegment',
            produces: 'Narrated pre|arena|post segment from BracketState + ArenaResult',
        },
        {
            id: 'youtube',
            label: 'YouTube',
            input: 'TournamentFinal',
            output: 'UploadResult',
            produces: 'Uploaded long video',
        },
    ]);

    function requireBracketState(state, label) {
        if (!state || typeof state !== 'object') {
            throw new Error(`${label}: BracketState object required`);
        }
        if (!Array.isArray(state.rounds) || state.rounds.length < 1) {
            throw new Error(`${label}: BracketState.rounds required`);
        }
        if (!Array.isArray(state.fighters) || state.fighters.length < 2) {
            throw new Error(`${label}: BracketState.fighters required`);
        }
        return state;
    }

    function requireMatchSegmentRequest(body) {
        if (!body || typeof body !== 'object') {
            throw new Error('MatchSegmentRequest required');
        }
        if (!body.matchKey || typeof body.matchKey !== 'string') {
            throw new Error('MatchSegmentRequest.matchKey required');
        }
        if (!body.script || typeof body.script !== 'string') {
            throw new Error('MatchSegmentRequest.script required');
        }
        if (!Array.isArray(body.matchup) || body.matchup.length !== 2) {
            throw new Error('MatchSegmentRequest.matchup must be exactly two fighters');
        }
        requireBracketState(body.bracketPre, 'MatchSegmentRequest.bracketPre');
        requireBracketState(body.bracketPost, 'MatchSegmentRequest.bracketPost');
        return body;
    }

    function requirePowerupSpinResult(body) {
        if (!body || typeof body !== 'object') {
            throw new Error('PowerupSpinResult required');
        }
        if (!body.matchKey || typeof body.matchKey !== 'string') {
            throw new Error('PowerupSpinResult.matchKey required');
        }
        if (!Array.isArray(body.fighters) || body.fighters.length !== 2) {
            throw new Error('PowerupSpinResult.fighters must be exactly two');
        }
        return body;
    }

    /** Deep-clone plain JSON (cell boundary: no shared mutable refs). */
    function cellJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    const api = {
        CELLS,
        requireBracketState,
        requireMatchSegmentRequest,
        requirePowerupSpinResult,
        cellJson,
        cellById(id) {
            return CELLS.find((cell) => cell.id === id) || null;
        },
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.LongPipeline = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
