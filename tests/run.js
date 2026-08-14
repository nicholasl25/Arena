#!/usr/bin/env node
/**
 * Run every *.test.js under tests/, then every *.test.py.
 *   node tests/run.js
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function collect(dir, suffix, out = []) {
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) collect(full, suffix, out);
        else if (name.endsWith(suffix) && name !== 'run.js') out.push(full);
    }
    return out;
}

function runAll(files, cmd, argsPrefix) {
    let failed = 0;
    for (const file of files) {
        const rel = path.relative(path.join(ROOT, '..'), file);
        process.stdout.write(`\n▶ ${rel}\n`);
        const result = spawnSync(cmd, [...argsPrefix, file], { stdio: 'inherit' });
        if (result.status !== 0) failed += 1;
    }
    return failed;
}

const jsFiles = collect(ROOT, '.test.js');
const pyFiles = collect(ROOT, '.test.py');
let failed = runAll(jsFiles, process.execPath, []);
failed += runAll(pyFiles, process.env.PYTHON || 'python3', []);

const total = jsFiles.length + pyFiles.length;
if (failed) {
    console.error(`\n${failed}/${total} files failed`);
    process.exit(1);
}
console.log(`\n${total} test files passed`);
