/**
 * node tests/workflow/long-pipeline.test.js
 */
'use strict';

const assert = require('assert');
const LongPipeline = require('../../workflow/long-pipeline.js');

function throws(fn, needle) {
    let err;
    try {
        fn();
    } catch (caught) {
        err = caught;
    }
    assert.ok(err, 'expected throw');
    assert.ok(String(err.message).includes(needle), `expected "${needle}" in "${err.message}"`);
}

function testCellRegistry() {
    const ids = LongPipeline.CELLS.map((cell) => cell.id);
    assert.deepStrictEqual(ids, ['setup', 'bracket', 'powerup', 'record', 'compose', 'youtube']);
    assert.strictEqual(LongPipeline.cellById('powerup').optional, true);
    assert.strictEqual(LongPipeline.cellById('powerup').output, 'PowerupSpinResult');
    assert.strictEqual(LongPipeline.cellById('missing'), null);
}

function testRequireBracketState() {
    const ok = { rounds: [[{ id: 'r0m0' }]], fighters: [{ id: 'a' }, { id: 'b' }] };
    assert.strictEqual(LongPipeline.requireBracketState(ok, 'pre'), ok);
    throws(() => LongPipeline.requireBracketState(null, 'pre'), 'object required');
    throws(() => LongPipeline.requireBracketState({ fighters: [1, 2] }, 'pre'), 'rounds');
    throws(() => LongPipeline.requireBracketState({ rounds: [[]], fighters: [{}] }, 'pre'), 'fighters');
}

function testRequireMatchSegmentRequest() {
    const body = {
        matchKey: 'r0m0|a|b',
        script: 'A vs. B',
        matchup: [{ id: 'a' }, { id: 'b' }],
        bracketPre: { rounds: [[{ id: 'r0m0' }]], fighters: [{ id: 'a' }, { id: 'b' }] },
        bracketPost: { rounds: [[{ id: 'r0m0' }]], fighters: [{ id: 'a' }, { id: 'b' }] },
    };
    assert.strictEqual(LongPipeline.requireMatchSegmentRequest(body), body);
    throws(() => LongPipeline.requireMatchSegmentRequest({}), 'matchKey');
    throws(() => LongPipeline.requireMatchSegmentRequest({
        matchKey: 'k',
        script: 's',
        matchup: [{ id: 'a' }],
    }), 'exactly two');
}

function testRequirePowerupSpinResult() {
    const body = {
        matchKey: 'r0m0|a|b',
        fighters: [{ id: 'a', powerupId: 'speed-i' }, { id: 'b', powerupId: '' }],
    };
    assert.strictEqual(LongPipeline.requirePowerupSpinResult(body), body);
    throws(() => LongPipeline.requirePowerupSpinResult(null), 'required');
    throws(() => LongPipeline.requirePowerupSpinResult({ fighters: [{}, {}] }), 'matchKey');
    throws(() => LongPipeline.requirePowerupSpinResult({ matchKey: 'k', fighters: [{}] }), 'exactly two');
}

function testCellJsonClones() {
    const src = { a: { b: 1 } };
    const copy = LongPipeline.cellJson(src);
    assert.deepStrictEqual(copy, src);
    copy.a.b = 2;
    assert.strictEqual(src.a.b, 1);
}

const tests = [
    testCellRegistry,
    testRequireBracketState,
    testRequireMatchSegmentRequest,
    testRequirePowerupSpinResult,
    testCellJsonClones,
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
