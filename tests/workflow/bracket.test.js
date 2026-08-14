/**
 * Focused tests for workflow/bracket.js — run with:
 *   node tests/workflow/bracket.test.js
 */
'use strict';

const path = require('path');
const Bracket = require(path.join(__dirname, '../../workflow/bracket.js'));

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function fighters(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: `f${i}`,
        name: `Fighter ${i + 1}`,
        color: `#${((i + 1) * 40).toString(16).padStart(2, '0')}88ff`,
    }));
}

function testPowerOf2() {
    assert(Bracket.nextPowerOf2(2) === 2, '2→2');
    assert(Bracket.nextPowerOf2(3) === 4, '3→4');
    assert(Bracket.nextPowerOf2(5) === 8, '5→8');
    assert(Bracket.nextPowerOf2(6) === 8, '6→8');
}

function testBuildFour() {
    const state = Bracket.buildFromFighters(fighters(4));
    assert(state.size === 4, 'size 4');
    assert(state.rounds.length === 2, '2 rounds');
    assert(state.rounds[0].length === 2, '2 semis');
    assert(state.rounds[1].length === 1, '1 final');
    assert(Bracket.currentMatch(state), 'has current match');
    assert(!state.complete, 'not complete');
}

function testByesThree() {
    const state = Bracket.buildFromFighters(fighters(3));
    assert(state.size === 4, 'pads to 4');
    const byes = state.rounds[0].filter((m) => m.bye);
    assert(byes.length === 1, 'one bye match');
    assert(byes[0].decided && byes[0].winner, 'bye auto-advances');
    // Bye winner should already be in the final slot
    const final = state.rounds[1][0];
    assert(final.a || final.b, 'bye winner promoted to final');
}

function testAdvanceToChampion() {
    const state = Bracket.buildFromFighters(fighters(4));
    let guard = 0;
    while (!state.complete && guard++ < 20) {
        const before = Bracket.currentMatch(state);
        assert(before, 'expected a match');
        const { winner } = Bracket.applyDemoWinner(state);
        assert(winner, 'demo winner');
        assert(before.decided, 'match decided');
    }
    assert(state.complete, 'tournament complete');
    assert(state.champion, 'has champion');
    assert(state.fighters.some((f) => Bracket.fighterKey(f) === Bracket.fighterKey(state.champion)), 'champion from roster');
}

function testDemoWinnerStable() {
    const state = Bracket.buildFromFighters(fighters(2));
    const match = Bracket.currentMatch(state);
    const a = Bracket.pickDemoWinner(match);
    const b = Bracket.pickDemoWinner(match);
    assert(Bracket.fighterKey(a) === Bracket.fighterKey(b), 'deterministic winner');
}

function testApplyWinnerNameUsesArenaLabel() {
    const state = Bracket.buildFromFighters(fighters(2));
    const match = Bracket.currentMatch(state);
    const decided = Bracket.applyWinnerName(state, `${match.b.name} with Speed`);
    assert(Bracket.fighterKey(decided.winner) === Bracket.fighterKey(match.b), 'name maps to b');
    assert(decided.decided, 'match decided');
}

function testRejectBadWinner() {
    const state = Bracket.buildFromFighters(fighters(2));
    let threw = false;
    try {
        Bracket.applyWinner(state, { id: 'nope', name: 'Nope', color: '#000000', slotKey: 'x' });
    } catch {
        threw = true;
    }
    assert(threw, 'rejects outsider winner');
}

function testWinnerPromotesWithoutLoser() {
    const state = Bracket.buildFromFighters(fighters(4));
    const match = Bracket.currentMatch(state);
    const winner = match.b;
    const loser = match.a;
    Bracket.applyWinner(state, winner);

    const next = state.rounds[1][0];
    const promoted = match.index % 2 === 0 ? next.a : next.b;
    assert(Bracket.fighterKey(promoted) === Bracket.fighterKey(winner), 'winner promoted to next slot');
    assert(Bracket.fighterKey(next.a) !== Bracket.fighterKey(loser), 'loser absent from next slot a');
    assert(Bracket.fighterKey(next.b) !== Bracket.fighterKey(loser), 'loser absent from next slot b');
}

function testSixFighters() {
    const state = Bracket.buildFromFighters(fighters(6));
    assert(state.size === 8, 'pads to 8');
    assert(state.rounds.length === 3, '3 rounds');
    let guard = 0;
    while (!state.complete && guard++ < 40) {
        Bracket.applyDemoWinner(state);
    }
    assert(state.complete && state.champion, '6-fighter bracket finishes');
}

function testWeaponAndSkinIdsPreserved() {
    const roster = [
        { id: '_weapon', name: 'Sword', color: '#ef4444', weaponId: 'sword', skinId: null },
        { id: 'aragorn', name: 'Aragorn', color: '#22c55e', weaponId: 'bow', skinId: 'aragorn' },
        { id: '_weapon', name: 'Hammer', color: '#3b82f6', weaponId: 'hammer' },
        { id: 'legolas', name: 'Legolas', color: '#a855f7', weaponId: 'dagger', skinId: 'legolas' },
    ];
    const state = Bracket.buildFromFighters(roster);
    assert(state.fighters.length === 4, '4 fighters');
    assert(state.fighters[0].weaponId === 'sword', 'weapon 0');
    assert(state.fighters[0].skinId == null, 'no skin 0');
    assert(state.fighters[1].weaponId === 'bow', 'weapon 1');
    assert(state.fighters[1].skinId === 'aragorn', 'skin 1');
    assert(state.fighters[1].id === 'aragorn', 'id is skin');
    assert(state.fighters[2].weaponId === 'hammer', 'weapon 2');
    assert(state.fighters[3].skinId === 'legolas', 'skin 3');
}

function testWeaponIconStampedWhenCatalogPresent() {
    const prev = global.window;
    global.window = global;
    window.PremadeWeapons = {
        iconUrl(id) {
            return id === 'sword' || id === 'dagger' ? 'premade-weapons/sprites/Sword.png' : null;
        },
    };
    try {
        const state = Bracket.buildFromFighters([
            { id: '_weapon', name: 'Sword', color: '#ef4444', weaponId: 'sword' },
            { id: '_weapon', name: 'Dagger', color: '#3b82f6', weaponId: 'dagger' },
        ]);
        assert(state.fighters[0].weaponIcon === 'premade-weapons/sprites/Sword.png', 'sword icon');
        assert(state.fighters[1].weaponIcon === 'premade-weapons/sprites/Sword.png', 'dagger shares sword png');
    } finally {
        delete window.PremadeWeapons;
        if (prev === undefined) delete global.window;
        else global.window = prev;
    }
}

function testArenaMatchupCopiesPowerupId() {
    const fighter = {
        id: 'a',
        name: 'A',
        powerupId: 'speed-i',
        arenaMatchup: { id: 'a', config: { name: 'A', weaponId: 'hammer' } },
    };
    const slot = Bracket.fighterArenaMatchup(fighter);
    assert(slot.config.powerupId === 'speed-i', 'copies fighter powerup onto arena config');
    assert(slot.config.weaponId === 'hammer', 'keeps other config');
    fighter.powerupId = null;
    const cleared = Bracket.fighterArenaMatchup(fighter);
    assert(cleared.config.powerupId === undefined, 'clears stale powerup when fighter has none');
}

function testMatchComposeKey() {
    const state = Bracket.buildFromFighters(fighters(2));
    const match = Bracket.currentMatch(state);
    const key = Bracket.matchComposeKey(match);
    assert(key.startsWith(`${match.id}|`), 'prefix');
    assert(key.includes(Bracket.fighterKey(match.a)), 'fighter a');
    assert(key.includes(Bracket.fighterKey(match.b)), 'fighter b');
}

function tournamentSequence(n) {
    const roster = fighters(n).map((fighter, i) => ({
        ...fighter,
        slotKey: `slot-${i}:${fighter.id}`,
        weaponId: `weapon-${i}`,
        skinId: i % 2 ? `skin-${i}` : null,
        arenaMatchup: {
            id: i % 2 ? `skin-${i}` : '_weapon',
            config: {
                weaponId: `weapon-${i}`,
                name: fighter.name,
                color: fighter.color,
                radius: 40 + i,
                displayFont: `Font ${i}`,
            },
        },
    }));
    const state = Bracket.buildFromFighters(roster);
    const matches = [];
    while (!state.complete) {
        const match = Bracket.currentMatch(state);
        assert(match, `pending match for ${n}`);
        const pair = Bracket.matchArenaMatchup(match);
        assert(pair.length === 2, `${match.id} has exactly 2 Arena entrants`);
        assert(pair[0].config.weaponId === match.a.weaponId, `${match.id} preserves A weapon`);
        assert(pair[1].config.weaponId === match.b.weaponId, `${match.id} preserves B weapon`);
        assert(pair[0].config.displayFont, `${match.id} preserves A font`);
        assert(pair[1].config.displayFont, `${match.id} preserves B font`);
        matches.push({
            id: match.id,
            round: match.round,
            pair: [Bracket.fighterKey(match.a), Bracket.fighterKey(match.b)],
        });
        Bracket.applyWinner(state, Bracket.pickDemoWinner(match));
    }
    assert(state.champion, `${n} entrants produce champion`);
    return { state, matches };
}

function testFourEntrantsRunSequentialPairs() {
    const { matches } = tournamentSequence(4);
    assert(matches.length === 3, `4 entrants require 3 matches, got ${matches.length}`);
    assert(matches.map((m) => m.id).join(',') === 'r0m0,r0m1,r1m0', '4-player match order');
    assert(matches.map((m) => m.round).join(',') === '0,0,1', '4-player round order');
}

function testEightEntrantsRunSequentialPairs() {
    const { matches } = tournamentSequence(8);
    assert(matches.length === 7, `8 entrants require 7 matches, got ${matches.length}`);
    assert(
        matches.map((m) => m.id).join(',') === 'r0m0,r0m1,r0m2,r0m3,r1m0,r1m1,r2m0',
        '8-player match order'
    );
    assert(matches.every((m) => m.pair.length === 2), 'every Arena matchup is a pair');
}

function testTournamentCellProgressFourAndEight() {
    const four = Bracket.buildFromFighters(fighters(4));
    let p = Bracket.tournamentCellProgress({ state: four, composeCount: 0, phase: 'bracket-intro' });
    assert(p.total === 3, '4 entrants → 3 matches');
    assert(p.bracket === 1 && p.arena === 0 && p.compose === 0, `fresh 4: ${JSON.stringify(p)}`);

    Bracket.applyDemoWinner(four);
    p = Bracket.tournamentCellProgress({ state: four, composeCount: 1, phase: 'compose' });
    assert(p.bracket === 1 && p.arena === 1 && p.compose === 1, `after first decide: ${JSON.stringify(p)}`);

    p = Bracket.tournamentCellProgress({ state: four, composeCount: 1, phase: 'bracket-intro' });
    assert(p.bracket === 2 && p.arena === 1 && p.compose === 1, `second pre-match: ${JSON.stringify(p)}`);

    p = Bracket.tournamentCellProgress({ state: four, composeCount: 1, phase: 'powerup-spin' });
    assert(p.bracket === 2 && p.powerup === 2 && p.arena === 1 && p.compose === 1, `second spin: ${JSON.stringify(p)}`);

    p = Bracket.tournamentCellProgress({ state: four, composeCount: 1, phase: 'arena' });
    assert(p.bracket === 2 && p.powerup === 2 && p.arena === 2 && p.compose === 1, `second arena: ${JSON.stringify(p)}`);

    // Example-like: 8 entrants / 7 matches, fourth matchup at pre-match Bracket.
    const eight = Bracket.buildFromFighters(fighters(8));
    assert(Bracket.fightMatchTotal(eight) === 7, '8 → 7');
    for (let i = 0; i < 3; i++) Bracket.applyDemoWinner(eight);
    p = Bracket.tournamentCellProgress({ state: eight, composeCount: 3, phase: 'bracket-intro' });
    assert(p.total === 7, 'total 7');
    assert(p.bracket === 4 && p.arena === 3 && p.compose === 3, `4/7 vs 3/7: ${JSON.stringify(p)}`);

    // Byes: 7 entrants → 6 decisive fights (not 7 padded slots).
    const seven = Bracket.buildFromFighters(fighters(7));
    assert(Bracket.fightMatchTotal(seven) === 6, '7 entrants → 6 fights');
    assert(Bracket.decidedFightCount(seven) === 0, 'bye auto-advances do not count as fights');

    // Champion completion.
    while (!eight.complete) Bracket.applyDemoWinner(eight);
    p = Bracket.tournamentCellProgress({ state: eight, composeCount: 7, phase: 'champion' });
    assert(p.bracket === 7 && p.arena === 7 && p.compose === 7, `champion: ${JSON.stringify(p)}`);
}

function testTournamentProgressReloadIdempotent() {
    const state = Bracket.buildFromFighters(fighters(4));
    Bracket.applyDemoWinner(state);
    Bracket.applyDemoWinner(state);
    const snap = Bracket.clone(state);
    const a = Bracket.tournamentCellProgress({ state: snap, composeCount: 2, phase: 'bracket-intro' });
    const b = Bracket.tournamentCellProgress({ state: Bracket.clone(snap), composeCount: 2, phase: 'bracket-intro' });
    assert(JSON.stringify(a) === JSON.stringify(b), 'reload snapshot stable');
    assert(a.bracket === 3 && a.arena === 2 && a.compose === 2, `reload at final pre-match: ${JSON.stringify(a)}`);
}

function testTournamentCompleteUnlockPredicate() {
    const state = Bracket.buildFromFighters(fighters(4));
    assert(!Bracket.isTournamentComplete(state, 0), 'fresh locked');
    assert(!Bracket.isTournamentComplete(state, 3), 'compose alone not enough');

    Bracket.applyDemoWinner(state);
    Bracket.applyDemoWinner(state);
    // Final match decided → champion, but VO still pending.
    Bracket.applyDemoWinner(state);
    assert(state.complete && state.champion, 'champion exists after final decide');
    assert(!Bracket.isTournamentComplete(state, 2), 'final match with pending VO stays locked');
    assert(Bracket.isTournamentComplete(state, 3), 'champion + all compose unlocks');

    const eight = Bracket.buildFromFighters(fighters(8));
    while (!eight.complete) Bracket.applyDemoWinner(eight);
    assert(!Bracket.isTournamentComplete(eight, 6), '8-entrant missing VO locked');
    assert(Bracket.isTournamentComplete(eight, 7), '8-entrant full VO unlocks');

    // Byes: 3 entrants → 2 fights.
    const three = Bracket.buildFromFighters(fighters(3));
    while (!three.complete) Bracket.applyDemoWinner(three);
    assert(Bracket.fightMatchTotal(three) === 2, '3 entrants → 2 fights');
    assert(!Bracket.isTournamentComplete(three, 1), 'bye bracket pending VO locked');
    assert(Bracket.isTournamentComplete(three, 2), 'bye bracket complete unlocks');
}

const tests = [
    testPowerOf2,
    testBuildFour,
    testByesThree,
    testAdvanceToChampion,
    testDemoWinnerStable,
    testApplyWinnerNameUsesArenaLabel,
    testRejectBadWinner,
    testWinnerPromotesWithoutLoser,
    testSixFighters,
    testWeaponAndSkinIdsPreserved,
    testWeaponIconStampedWhenCatalogPresent,
    testArenaMatchupCopiesPowerupId,
    testMatchComposeKey,
    testFourEntrantsRunSequentialPairs,
    testEightEntrantsRunSequentialPairs,
    testTournamentCellProgressFourAndEight,
    testTournamentProgressReloadIdempotent,
    testTournamentCompleteUnlockPredicate,
];

let failed = 0;
for (const t of tests) {
    try {
        t();
        console.log(`ok  ${t.name}`);
    } catch (err) {
        failed += 1;
        console.error(`fail ${t.name}: ${err.message}`);
    }
}

if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
}
console.log(`\n${tests.length} passed`);
