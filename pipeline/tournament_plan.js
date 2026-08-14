#!/usr/bin/env node
/**
 * Roster-driven tournament planner (Long YouTube).
 *
 *   node pipeline/tournament_plan.js init <state.json> <roster.json>
 *   node pipeline/tournament_plan.js next <state.json> <match.json>
 *   node pipeline/tournament_plan.js apply <state.json> <winnerName>
 *   node pipeline/tournament_plan.js options <state.json> <opts.json>
 *
 * opts.json:
 *   { powerupSpin?, weaponSpin?, weaponPool?: [{id,name,icon?,color?}] }
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ARENA = path.join(__dirname, '..');
const STARTED = Date.now();

function log(kind, msg) {
    const elapsed = ((Date.now() - STARTED) / 1000).toFixed(1);
    console.error(`${new Date().toISOString()}  +${elapsed}s  ${kind}  ${msg}`);
}

global.window = global;
require(path.join(ARENA, 'premade-weapons/registry.js'));
for (const file of [
    'sword.js', 'dagger.js', 'spikes.js', 'slingshot.js', 'bow.js', 'basketball.js',
    'hammer.js', 'fists.js', 'laser.js', 'staff.js', 'shield.js', 'webs.js',
    'boomerang.js', 'grenade.js', 'thunderrod.js', 'witch.js',
]) {
    require(path.join(ARENA, 'premade-weapons', file));
}
require(path.join(ARENA, 'premade-weapons/index.js'));
require(path.join(ARENA, 'premade-powerups/registry.js'));
require(path.join(ARENA, 'premade-powerups/power.js'));
require(path.join(ARENA, 'premade-powerups/speed.js'));
require(path.join(ARENA, 'premade-powerups/size.js'));
require(path.join(ARENA, 'premade-powerups/thorns.js'));
require(path.join(ARENA, 'premade-powerups/protection.js'));
require(path.join(ARENA, 'premade-powerups/apple.js'));
require(path.join(ARENA, 'premade-powerups/index.js'));
require(path.join(ARENA, 'workflow/bracket.js'));
require(path.join(ARENA, 'workflow/match-compose.js'));
require(path.join(ARENA, 'workflow/powerup-wheel.js'));

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data));
}

function makeWeaponPairSpins(match, pool) {
    const slices = PowerupWheel.buildSlicesFromEntries(pool);
    if (!slices.length) throw new Error('weaponSpin requires a non-empty weaponPool');
    const spinA = PowerupWheel.createSpin({
        fighter: match.a,
        delayMs: 0,
        slices,
    });
    const spinB = PowerupWheel.createSpin({
        fighter: match.b,
        delayMs: PowerupWheel.nextSpinDelayMs(spinA),
        slices,
    });
    PowerupWheel.applyWeaponResultToFighter(match.a, spinA.resultId);
    PowerupWheel.applyWeaponResultToFighter(match.b, spinB.resultId);
    return {
        a: PowerupWheel.serializeSpin(spinA),
        b: PowerupWheel.serializeSpin(spinB),
        summary: `${match.a.name}=${spinA.resultName} | ${match.b.name}=${spinB.resultName}`,
    };
}

function makePowerupPairSpins(match) {
    const spinA = PowerupWheel.createSpin({ fighter: match.a, delayMs: 0 });
    const spinB = PowerupWheel.createSpin({
        fighter: match.b,
        delayMs: PowerupWheel.nextSpinDelayMs(spinA),
    });
    PowerupWheel.applyResultToFighter(match.a, spinA.resultId);
    PowerupWheel.applyResultToFighter(match.b, spinB.resultId);
    return {
        a: PowerupWheel.serializeSpin(spinA),
        b: PowerupWheel.serializeSpin(spinB),
        summary: `${match.a.name}=${spinA.resultName || 'No powerup'} | ${match.b.name}=${spinB.resultName || 'No powerup'}`,
    };
}

function buildMatchRequest(state, order, bag) {
    const match = WorkflowBracket.currentMatch(state);
    if (!match) throw new Error('no open match');
    const bracketPre = WorkflowBracket.clone(state);
    const weaponSpin = bag.weaponSpin === true;
    const powerupSpin = bag.powerupSpin !== false;
    const pool = Array.isArray(bag.weaponPool) ? bag.weaponPool : [];

    let weaponSpins = null;
    let powerupSpins = null;
    const summaryBits = [];

    if (weaponSpin) {
        const made = makeWeaponPairSpins(match, pool);
        weaponSpins = { a: made.a, b: made.b };
        summaryBits.push(`weapons ${made.summary}`);
    }
    if (powerupSpin) {
        const made = makePowerupPairSpins(match);
        powerupSpins = { a: made.a, b: made.b };
        summaryBits.push(`powerups ${made.summary}`);
    }

    const script = TournamentCompose.buildMatchScript({
        a: match.a,
        b: match.b,
        winner: null,
        mode: 'weapon',
        weaponSpins,
        spins: powerupSpins,
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
        weaponSpins,
        powerupSpins,
        syntheticArena: false,
        spinSummary: summaryBits.join(' · ') || 'no spins',
    };
}

function cmdInit(statePath, rosterPath) {
    const roster = readJson(rosterPath);
    if (!Array.isArray(roster) || roster.length < 2) {
        throw new Error('roster needs at least 2 fighters');
    }
    const state = WorkflowBracket.buildFromFighters(roster);
    writeJson(statePath, {
        state,
        order: 0,
        matchKeys: [],
        championName: null,
        powerupSpin: true,
        weaponSpin: false,
        weaponPool: [],
        rosterNames: roster.map((f) => f.name),
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
    const req = buildMatchRequest(state, bag.order, bag);
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

function cmdSetOptions(statePath, optsPath) {
    const bag = readJson(statePath);
    const opts = readJson(optsPath);
    if (typeof opts.powerupSpin === 'boolean') {
        bag.powerupSpin = opts.powerupSpin;
    }
    if (typeof opts.weaponSpin === 'boolean') {
        bag.weaponSpin = opts.weaponSpin;
    }
    if (Array.isArray(opts.weaponPool)) {
        bag.weaponPool = opts.weaponPool;
    }
    writeJson(statePath, bag);
    log(
        'STEP',
        `options powerupSpin=${bag.powerupSpin !== false} `
            + `weaponSpin=${bag.weaponSpin === true} `
            + `weapons=${(bag.weaponPool || []).length}`,
    );
}

const cmd = process.argv[2] || 'init';
try {
    if (cmd === 'init') {
        cmdInit(
            process.argv[3] || path.join(ARENA, 'tests/_full_video_state.json'),
            process.argv[4] || path.join(ARENA, 'tests/_full_video_roster.json'),
        );
    } else if (cmd === 'next') {
        cmdNext(
            process.argv[3] || path.join(ARENA, 'tests/_full_video_state.json'),
            process.argv[4] || path.join(ARENA, 'tests/_full_video_match.json'),
        );
    } else if (cmd === 'apply') {
        cmdApply(
            process.argv[3] || path.join(ARENA, 'tests/_full_video_state.json'),
            process.argv.slice(4).join(' '),
        );
    } else if (cmd === 'options') {
        cmdSetOptions(
            process.argv[3] || path.join(ARENA, 'tests/_full_video_state.json'),
            process.argv[4] || path.join(ARENA, 'tests/_full_video_opts.json'),
        );
    } else {
        throw new Error(`unknown command ${cmd}`);
    }
} catch (err) {
    log('ERROR', err.message || String(err));
    process.exit(1);
}
