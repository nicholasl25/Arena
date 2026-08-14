/**
 * Focused tests for per-matchup voice-over compose identity + idempotency.
 *   node tests/workflow/match-compose.test.js
 */
'use strict';

const path = require('path');
const Bracket = require(path.join(__dirname, '../../workflow/bracket.js'));
const TournamentCompose = require(path.join(__dirname, '../../workflow/match-compose.js'));

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function fighters(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: `f${i}`,
        name: `Fighter ${i + 1}`,
        color: `#${((i + 1) * 40).toString(16).padStart(2, '0')}88ff`,
        slotKey: `slot-${i}:f${i}`,
    }));
}

function memoryStorage() {
    const map = new Map();
    return {
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
    };
}

function testMatchComposeKeyStableAcrossRebuild() {
    const roster = fighters(4);
    const a = Bracket.buildFromFighters(roster);
    const b = Bracket.buildFromFighters(roster);
    const ma = Bracket.currentMatch(a);
    const mb = Bracket.currentMatch(b);
    assert(Bracket.matchComposeKey(ma) === Bracket.matchComposeKey(mb), 'keys match across rebuild');
    assert(Bracket.matchComposeKey(ma).includes(ma.id), 'includes match id');
}

function testScriptIncludesResult() {
    const state = Bracket.buildFromFighters(fighters(2));
    const match = Bracket.currentMatch(state);
    const winner = Bracket.pickDemoWinner(match);
    const script = TournamentCompose.buildMatchScript({
        a: match.a,
        b: match.b,
        winner,
        mode: 'weapon',
    });
    assert(script.startsWith(`${match.a.name} vs. ${match.b.name}`), `opening: ${script}`);
    assert(!script.includes('who will win?'), 'no tease spoil');
    assert(script.includes(`${winner.name} wins`), 'winner line');
}

function testScriptIncludesPowerupClause() {
    const script = TournamentCompose.buildMatchScript({
        a: {
            name: 'Sword',
            arenaMatchup: { id: '_weapon', config: { weaponId: 'sword', powerupId: 'speed-i' } },
        },
        b: {
            name: 'Dagger',
            powerupId: 'power-i',
        },
        winner: { name: 'Dagger with Speed' },
        mode: 'weapon',
        spins: {
            a: { resultId: 'speed-i', resultName: 'Speed I' },
            b: { resultId: 'power-i', resultName: 'Power I' },
        },
    });
    assert(script.startsWith('Sword vs. Dagger'), `got: ${script}`);
    assert(!script.includes('who will win?'), 'no opening spoil');
    assert(!script.includes('with Speed'), 'no powerup clause in matchup');
    assert(script.includes('Sword gets Speed'), `spin A: ${script}`);
    assert(script.includes('Dagger gets Power'), `spin B: ${script}`);
    assert(script.includes('\n\nDagger wins'), `winner stays plain, got: ${script}`);
    assert(!script.includes('with Speed wins'), 'no powerup on winner line');
    assert(!/\bSpeed I\b/.test(script), 'no roman numeral on powerup');
}

function testNMatchupsProduceNComposes() {
    const storage = memoryStorage();
    const store = TournamentCompose.createStore({ storage });
    const state = Bracket.buildFromFighters(fighters(4));
    const keys = [];
    let guard = 0;
    while (!state.complete && guard++ < 20) {
        const match = Bracket.currentMatch(state);
        assert(match, 'open match');
        const key = Bracket.matchComposeKey(match);
        keys.push(key);
        const winner = Bracket.pickDemoWinner(match);
        const loser = Bracket.fighterKey(match.a) === Bracket.fighterKey(winner) ? match.b : match.a;
        const first = store.ensure({ matchKey: key, match, winner, loser, mode: 'collision' });
        assert(first.created, `created ${key}`);
        const again = store.ensure({ matchKey: key, match, winner, loser, mode: 'collision' });
        assert(!again.created, `idempotent ${key}`);
        Bracket.applyWinner(state, winner);
    }
    assert(keys.length === 3, `4-fighter bracket has 3 matches, got ${keys.length}`);
    assert(store.size === 3, `exactly 3 compose records, got ${store.size}`);
    assert(store.calls === 3, `exactly 3 compose calls, got ${store.calls}`);
    assert(new Set(keys).size === 3, 'unique keys');
}

function testReloadRecognizesCompleted() {
    const storage = memoryStorage();
    const storeA = TournamentCompose.createStore({ storage });
    const state = Bracket.buildFromFighters(fighters(2));
    const match = Bracket.currentMatch(state);
    const key = Bracket.matchComposeKey(match);
    const winner = Bracket.pickDemoWinner(match);
    storeA.ensure({ matchKey: key, match, winner, loser: match.a === winner ? match.b : match.a });
    assert(storeA.size === 1, 'stored one');

    const storeB = TournamentCompose.createStore({ storage });
    assert(storeB.size === 1, 'reloaded one');
    assert(storeB.has(key), 'key recognizable');
    const again = storeB.ensure({ matchKey: key, match, winner });
    assert(!again.created, 'reload resume is idempotent');
    assert(storeB.calls === 0, 'no new call after reload');
}

function testStepResumeDoesNotDuplicate() {
    const store = TournamentCompose.createStore({ storage: memoryStorage() });
    const state = Bracket.buildFromFighters(fighters(4));
    const match = Bracket.currentMatch(state);
    const key = Bracket.matchComposeKey(match);
    const winner = Bracket.pickDemoWinner(match);
    store.ensure({ matchKey: key, match, winner });
    // Simulate Step clicked again / view alternation / preview resume.
    for (let i = 0; i < 5; i++) {
        const result = store.ensure({ matchKey: key, match, winner });
        assert(!result.created, `resume ${i}`);
    }
    assert(store.size === 1 && store.calls === 1, 'still one compose');
}

function testRemoveAndComposedRefresh() {
    const store = TournamentCompose.createStore({ storage: memoryStorage() });
    const state = Bracket.buildFromFighters(fighters(2));
    const match = Bracket.currentMatch(state);
    const key = Bracket.matchComposeKey(match);
    const winner = Bracket.pickDemoWinner(match);
    const first = store.ensure({ matchKey: key, match, winner, order: 3 });
    assert(first.created, 'created');
    assert(first.record.order === 3, 'order persisted');
    assert(first.record.composed === null, 'no fake composed artifact');
    assert(first.record.status === 'pending', 'pending until media succeeds');
    const refreshed = store.ensure({
        matchKey: key,
        match,
        winner,
        composed: 'match-r0m0.mp4',
    });
    assert(!refreshed.created, 'still idempotent');
    assert(refreshed.record.composed === 'match-r0m0.mp4', 'composed filename refreshed');
    assert(store.remove(key), 'removed');
    assert(!store.has(key), 'gone');
    assert(store.size === 0, 'empty after remove');
    const again = store.ensure({ matchKey: key, match, winner, composed: 'match-r0m0.mp4' });
    assert(again.created, 'retry after remove creates again');
}

const tests = [
    testMatchComposeKeyStableAcrossRebuild,
    testScriptIncludesResult,
    testScriptIncludesPowerupClause,
    testNMatchupsProduceNComposes,
    testReloadRecognizesCompleted,
    testStepResumeDoesNotDuplicate,
    testRemoveAndComposedRefresh,
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
