/**
 * node tests/workflow/graph.test.js
 */
'use strict';

const assert = require('assert');

global.window = global;
require('../../workflow/graph.js');

function testLongGraphHasPowerupStepAndLoop() {
    assert.ok(WorkflowGraph.setWorkflow('long'));
    assert.strictEqual(WorkflowGraph.activeWorkflowId, 'long');
    assert.ok(WorkflowGraph.nodeById.has('powerup'));
    assert.ok(WorkflowGraph.nodeById.has('bracket'));
    assert.ok(WorkflowGraph.nodeById.has('record'));
    const edges = WorkflowGraph.GRAPH.edges.map((e) => `${e.from}->${e.to}`);
    assert.ok(edges.includes('setup->bracket'));
    assert.ok(edges.includes('bracket->powerup'));
    assert.ok(edges.includes('powerup->record'));
    assert.ok(edges.includes('record->compose'));
    assert.ok(edges.includes('compose->youtube'));
    const loop = WorkflowGraph.GRAPH.edges.find((e) => e.from === 'compose' && e.to === 'bracket');
    assert.strictEqual(loop.route, 'loop-below');
    const group = WorkflowGraph.GRAPH.groups.find((g) => g.id === 'tournament');
    assert.ok(group);
    assert.ok(group.actions.some((a) => a.action === 'preview-step'));
    assert.ok(group.actions.some((a) => a.action === 'preview-fast-forward'));
    const toggle = WorkflowGraph.nodeById.get('powerup').actions.find((a) => a.action === 'toggle-powerup');
    assert.strictEqual(toggle.toggle, true);
}

function testShortsGraphHasNoPowerupNode() {
    assert.ok(WorkflowGraph.setWorkflow('shorts'));
    assert.strictEqual(WorkflowGraph.nodeById.has('powerup'), false);
    assert.ok(WorkflowGraph.nodeById.has('intro'));
    assert.strictEqual(WorkflowGraph.setWorkflow('nope'), false);
    assert.strictEqual(WorkflowGraph.activeWorkflowId, 'shorts');
}

function testWorkflowMetadata() {
    WorkflowGraph.setWorkflow('long');
    const wf = WorkflowGraph.getWorkflow();
    assert.strictEqual(wf.arenaView, 'computer');
    assert.ok(wf.subtitle.includes('Powerup'));
    WorkflowGraph.setWorkflow('shorts');
    assert.strictEqual(WorkflowGraph.getWorkflow().arenaView, 'phone');
}

const tests = [
    testLongGraphHasPowerupStepAndLoop,
    testShortsGraphHasNoPowerupNode,
    testWorkflowMetadata,
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
