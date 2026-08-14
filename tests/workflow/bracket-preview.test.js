const assert = require('assert');

global.window = global;
let now = 0;
let nextRaf = 1;
let rafs = new Map();
global.innerHeight = 800;
global.devicePixelRatio = 1;
global.performance = { now: () => now };
global.requestAnimationFrame = (callback) => {
    const id = nextRaf++;
    rafs.set(id, callback);
    return id;
};
global.cancelAnimationFrame = (id) => rafs.delete(id);

const noop = () => {};
const ctx = new Proxy({
    measureText: (text) => ({ width: String(text).length * 7 }),
}, {
    get(target, key) {
        return key in target ? target[key] : noop;
    },
    set(target, key, value) {
        target[key] = value;
        return true;
    },
});
const canvas = {
    hidden: false,
    parentElement: { clientWidth: 640 },
    clientWidth: 640,
    clientHeight: 360,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 360 }),
};

require('../../workflow/bracket.js');
require('../../workflow/powerup-wheel.js');
require('../../workflow/bracket-preview.js');

// Minimal powerup catalog so the wheel has weighted slices in Node tests.
global.window.PremadePowerups = {
    listWheelSlices() {
        return [
            { id: '', name: 'No powerup', icon: null, color: '#94a3b8', weight: 40 },
            { id: 'power-i', name: 'Power I', icon: null, color: '#dc2626', weight: 10 },
            { id: 'speed-i', name: 'Speed I', icon: null, color: '#2563eb', weight: 10 },
            { id: 'power-ii', name: 'Power II', icon: null, color: '#b91c1c', weight: 5 },
        ];
    },
    resolvePowerupId(id) {
        return id || '';
    },
};

function makeBracket() {
    return WorkflowBracket.buildFromFighters(['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, index) => ({
        id: name.toLowerCase(),
        name,
        color: `hsl(${index * 80} 70% 50%)`,
        arenaMatchup: { id: name.toLowerCase(), config: { name } },
    })));
}

function frame(milliseconds) {
    now += milliseconds;
    const pending = [...rafs.values()];
    rafs.clear();
    pending.forEach((callback) => callback(now));
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function resetClock() {
    WorkflowBracketPreview.stop();
    while (WorkflowBracketPreview.getDebugState().playbackRate !== 1) {
        WorkflowBracketPreview.cyclePlaybackRate();
    }
    now = 0;
    rafs.clear();
}

function setFourTimes() {
    WorkflowBracketPreview.cyclePlaybackRate();
    WorkflowBracketPreview.cyclePlaybackRate();
}

async function testFourTimesPhaseOrderAndStepBoundary() {
    resetClock();
    const phases = [];
    let composes = 0;
    let arenaPolls = 0;
    WorkflowBracketPreview.mount(canvas, {
        onPhaseChange: ({ phase }) => {
            if (phase) phases.push(phase);
        },
        onMatchCompose: () => {
            composes += 1;
        },
        getArenaResult: ({ match }) => {
            arenaPolls += 1;
            return arenaPolls >= 2 ? { winner: match.a } : null;
        },
    });
    WorkflowBracketPreview.start(makeBracket());
    setFourTimes();
    WorkflowBracketPreview.stepOneMatch();

    frame(400);
    frame(16);
    frame(16);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'compose');
    await flushPromises();
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'compose');
    frame(250);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-advance');
    frame(213);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-hold');
    frame(275);

    assert.deepStrictEqual(phases, [
        'bracket-intro',
        'arena',
        'compose',
        'bracket-advance',
        'bracket-hold',
        'bracket-intro',
    ]);
    assert.strictEqual(composes, 1);
    assert.strictEqual(WorkflowBracketPreview.isRunning(), false);
}

async function testStaleComposeCannotAdvanceRestartedPreview() {
    resetClock();
    let resolveCompose;
    WorkflowBracketPreview.mount(canvas, {
        onMatchCompose: () => new Promise((resolve) => {
            resolveCompose = resolve;
        }),
        getArenaResult: ({ match }) => ({ winner: match.a }),
    });
    WorkflowBracketPreview.start(makeBracket());
    setFourTimes();
    frame(400);
    frame(16);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'compose');
    await Promise.resolve();

    WorkflowBracketPreview.start(makeBracket());
    resolveCompose();
    await flushPromises();

    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-intro');
    assert.deepStrictEqual(WorkflowBracketPreview.getDebugState().phaseHistory, ['bracket-intro']);
}

async function testStandaloneBracketSkipsComposeOnly() {
    resetClock();
    let composes = 0;
    WorkflowBracketPreview.mount(canvas, {
        onMatchCompose: () => {
            composes += 1;
        },
    });
    WorkflowBracketPreview.start(makeBracket(), { bracketOnly: true });
    setFourTimes();
    assert.strictEqual(WorkflowBracketPreview.applyMatchResult(), true);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-advance');
    frame(213);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-hold');
    frame(275);

    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-intro');
    assert.strictEqual(composes, 0);
}

async function testPowerupSpinPhaseBeforeArena() {
    resetClock();
    const phases = [];
    let arenaPolls = 0;
    let composePayload = null;
    WorkflowBracketPreview.mount(canvas, {
        onPhaseChange: ({ phase }) => {
            if (phase) phases.push(phase);
        },
        onMatchCompose: (body) => {
            composePayload = body;
        },
        getArenaResult: ({ match }) => {
            arenaPolls += 1;
            return arenaPolls >= 1 ? { winner: match.a } : null;
        },
    });
    WorkflowBracketPreview.start(makeBracket(), { powerupSpin: true });
    setFourTimes();
    WorkflowBracketPreview.stepOneMatch();

    frame(400);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'powerup-spin');
    // Sequential wheels ≈ 2×(7000+2200)+280 ≈ 18680ms; at 4× ≈ 4670ms real.
    frame(5600);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'arena');
    frame(16);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'compose');
    await flushPromises();
    frame(250);

    assert.ok(phases.includes('powerup-spin'), 'includes powerup-spin');
    assert.ok(phases.indexOf('powerup-spin') < phases.indexOf('arena'), 'spin before arena');
    assert.ok(composePayload?.powerupSpins?.a?.slices?.length, 'compose gets spin A');
    assert.ok(composePayload?.powerupSpins?.b?.slices?.length, 'compose gets spin B');
    assert.ok('resultId' in composePayload.powerupSpins.a);
    const pair = WorkflowBracket.matchArenaMatchup(composePayload.match);
    const idA = composePayload.powerupSpins.a.resultId;
    if (idA) assert.strictEqual(pair[0].config.powerupId, idA);
    else assert.strictEqual(pair[0].config.powerupId, undefined);
}

async function testAutorunFalseStaysOnIntro() {
    resetClock();
    WorkflowBracketPreview.mount(canvas, { onMatchCompose: () => {} });
    WorkflowBracketPreview.start(makeBracket(), { autorun: false });
    assert.strictEqual(WorkflowBracketPreview.isRunning(), false);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-intro');
    frame(400);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-intro');
    assert.strictEqual(WorkflowBracketPreview.resume(), true);
    assert.strictEqual(WorkflowBracketPreview.isRunning(), true);
    frame(1600);
    assert.notStrictEqual(WorkflowBracketPreview.getDebugState().phase, 'bracket-intro');
}

function testPaintSnapshotAdvanceUsesElapsed() {
    resetClock();
    const state = makeBracket();
    const first = WorkflowBracket.applyDemoWinner(state);
    assert(first && first.match && first.winner, 'demo winner');
    WorkflowBracketPreview.paintSnapshot(canvas, {
        state,
        phase: 'bracket-advance',
        elapsedMs: 400,
        width: 640,
        height: 360,
        activeMatch: first.match,
        lastWinner: first.winner,
        lastLoser: first.match.a === first.winner ? first.match.b : first.match.a,
        advanceFrom: first.match,
    });
    WorkflowBracketPreview.paintSnapshot(canvas, {
        state,
        phase: 'champion',
        elapsedMs: 0,
        width: 640,
        height: 360,
        lastWinner: state.champion,
    });
}

async function testPowerupToggleSkipsSpin() {
    resetClock();
    WorkflowBracketPreview.mount(canvas, {
        onMatchCompose: () => {},
        getArenaResult: ({ match }) => ({ winner: match.a }),
    });
    WorkflowBracketPreview.start(makeBracket(), { powerupSpin: true });
    setFourTimes();
    frame(400);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'powerup-spin');
    WorkflowBracketPreview.setPowerupSpinEnabled(false);
    assert.strictEqual(WorkflowBracketPreview.isPowerupSpinEnabled(), false);
    assert.strictEqual(WorkflowBracketPreview.getDebugState().phase, 'arena');
}

async function run() {
    const tests = [
        testFourTimesPhaseOrderAndStepBoundary,
        testStaleComposeCannotAdvanceRestartedPreview,
        testStandaloneBracketSkipsComposeOnly,
        testPowerupSpinPhaseBeforeArena,
        testPowerupToggleSkipsSpin,
        testAutorunFalseStaysOnIntro,
        testPaintSnapshotAdvanceUsesElapsed,
    ];
    for (const test of tests) {
        await test();
        console.log(`ok  ${test.name}`);
    }
    console.log(`\n${tests.length} passed`);
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
