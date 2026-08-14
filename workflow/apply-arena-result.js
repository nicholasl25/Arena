#!/usr/bin/env node
/**
 * Apply an offline-arena winner name onto a pre-match bracket.
 * stdin: { bracketPre, winnerName }
 * stdout: { bracketPost, lastWinner, lastLoser, winnerName, loserName }
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, 'bracket.js'));

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!input?.bracketPre || !input.winnerName) {
    throw new Error('apply-arena-result: bracketPre and winnerName required');
}

const state = global.WorkflowBracket.clone(input.bracketPre);
const decided = global.WorkflowBracket.applyWinnerName(state, input.winnerName);
const winner = decided.winner;
const loser = global.WorkflowBracket.fighterKey(decided.a)
    === global.WorkflowBracket.fighterKey(winner)
    ? decided.b
    : decided.a;

process.stdout.write(JSON.stringify({
    bracketPost: state,
    lastWinner: winner,
    lastLoser: loser,
    winnerName: winner?.name || String(input.winnerName),
    loserName: loser?.name || null,
    complete: Boolean(state.complete),
    champion: state.champion || null,
}));
