#!/usr/bin/env node
/**
 * Plan helpers for the 4-fighter long-video smoke.
 *
 *   node tests/generate_full_video.js init <state.json>
 *   node tests/generate_full_video.js next <state.json> <match.json>
 *   node tests/generate_full_video.js apply <state.json> <winnerName>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FUN = path.join(__dirname, '..');
const STARTED = Date.now();

function log(kind, msg) {
    const elapsed = ((Date.now() - STARTED) / 1000).toFixed(1);
    console.error(`${new Date().toISOString()}  +${elapsed}s  ${kind}  ${msg}`);
}

global.window = global;
require(path.join(FUN, 'premade-powerups/registry.js'));
require(path.join(FUN, 'premade-powerups/power.js'));
require(path.join(FUN, 'premade-powerups/speed.js'));
require(path.join(FUN, 'premade-powerups/size.js'));
require(path.join(FUN, 'premade-powerups/thorns.js'));
require(path.join(FUN, 'premade-powerups/protection.js'));
require(path.join(FUN, 'premade-powerups/apple.js'));
require(path.join(FUN, 'premade-powerups/index.js'));
require(path.join(FUN, 'workflow/bracket.js'));
require(path.join(FUN, 'workflow/match-compose.js'));
require(path.join(FUN, 'workflow/powerup-wheel.js'));

const roster = [
    { weaponId: 'hammer', name: 'Hammer', color: '#f97316' },
    { weaponId: 'dagger', name: 'Dagger', color: '#3b82f6' },
    { weaponId: 'sword', name: 'Sword', color: '#ef4444' },
    { weaponId: 'spikes', name: 'Spikes', color: '#a855f7' },
].map((row, index) => ({
    id: '_weapon',
    name: row.name,
    color: row.color,
    weaponId: row.weaponId,
    slotKey: `slot-${index}:_weapon:${row.weaponId}`,
    slotIndex: index,
    arenaMatchup: {
        id: '_weapon',
        config: {
            weaponId: row.weaponId,
            name: row.name,
            color: row.color,
        },
    },
}));

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data));
}

function buildMatchRequest(state, order) {
    const match = WorkflowBracket.currentMatch(state);
    if (!match) throw new Error('no open match');
    const bracketPre = WorkflowBracket.clone(state);
    const spinA = PowerupWheel.createSpin({ fighter: match.a, delayMs: 0 });
    const spinB = PowerupWheel.createSpin({
        fighter: match.b,
        delayMs: PowerupWheel.nextSpinDelayMs(spinA),
    });
    PowerupWheel.applyResultToFighter(match.a, spinA.resultId);
    PowerupWheel.applyResultToFighter(match.b, spinB.resultId);
    const spins = {
        a: PowerupWheel.serializeSpin(spinA),
        b: PowerupWheel.serializeSpin(spinB),
    };
    const script = TournamentCompose.buildMatchScript({
        a: match.a,
        b: match.b,
        winner: null,
        mode: 'weapon',
        spins,
    });
    return {
        matchKey: WorkflowBracket.matchComposeKey(match),
        script,
        order,
        mode: 'weapon',
        matchup: WorkflowBracket.matchArenaMatchup(match),
        aName: TournamentCompose.plainFighterName(match.a),
        bName: TournamentCompose.plainFighterName(match.b),
        winnerName: null,
        loserName: null,
        bracketPre,
        bracketPost: null,
        activeMatch: match,
        lastWinner: null,
        lastLoser: null,
        powerupSpins: spins,
        syntheticArena: false,
        spinSummary: `${match.a.name}=${spinA.resultName || 'No powerup'} | ${match.b.name}=${spinB.resultName || 'No powerup'}`,
    };
}

function cmdInit(statePath) {
    const state = WorkflowBracket.buildFromFighters(roster);
    writeJson(statePath, {
        state,
        order: 0,
        matchKeys: [],
        championName: null,
    });
    log('STEP', `init ${roster.map((f) => f.name).join(', ')}`);
}

function cmdNext(statePath, matchPath) {
    const bag = readJson(statePath);
    const state = bag.state;
    if (state.complete && state.champion) {
        bag.championName = state.champion.name;
        writeJson(statePath, bag);
        log('STEP', `bracket complete · champion ${state.champion.name}`);
        process.exit(2);
    }
    const req = buildMatchRequest(state, bag.order);
    writeJson(matchPath, req);
    log('STEP', `next ${bag.order + 1} ${req.aName} vs ${req.bName} · ${req.spinSummary}`);
}

function cmdApply(statePath, winnerName) {
    const bag = readJson(statePath);
    const decided = WorkflowBracket.applyWinnerName(bag.state, winnerName);
    bag.order += 1;
    bag.matchKeys = bag.matchKeys || [];
    const key = WorkflowBracket.matchComposeKey(decided);
    if (key) bag.matchKeys.push(key);
    if (bag.state.complete && bag.state.champion) {
        bag.championName = bag.state.champion.name;
    }
    writeJson(statePath, bag);
    log('STEP', `apply ${winnerName} → ${decided.winner?.name}`);
}

const cmd = process.argv[2] || 'init';
try {
    if (cmd === 'init') {
        cmdInit(process.argv[3] || path.join(__dirname, '_full_video_state.json'));
    } else if (cmd === 'next') {
        cmdNext(
            process.argv[3] || path.join(__dirname, '_full_video_state.json'),
            process.argv[4] || path.join(__dirname, '_full_video_match.json'),
        );
    } else if (cmd === 'apply') {
        cmdApply(
            process.argv[3] || path.join(__dirname, '_full_video_state.json'),
            process.argv.slice(4).join(' '),
        );
    } else {
        throw new Error(`unknown command ${cmd}`);
    }
} catch (err) {
    log('ERROR', err.message || String(err));
    process.exit(1);
}
