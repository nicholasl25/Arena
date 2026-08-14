/**
 * node tests/workflow/powerup-wheel.test.js
 */
'use strict';

const assert = require('assert');

global.window = global;
require('../../workflow/powerup-wheel.js');

window.PremadePowerups = {
    listWheelSlices() {
        // Relative powerup weights only — Nothing is always pinned to 40% by buildSlices.
        return [
            { id: '', name: 'No powerup', icon: null, color: '#94a3b8', weight: 1 },
            { id: 'power-i', name: 'Power I', icon: 'premade-powerups/sprites/Power.png', color: '#dc2626', weight: 10 },
            { id: 'speed-i', name: 'Speed I', icon: 'premade-powerups/sprites/Speed.png', color: '#2563eb', weight: 10 },
            { id: 'size-i', name: 'Size I', icon: 'premade-powerups/sprites/Size.webp', color: '#d946ef', weight: 10 },
            { id: 'thorns-i', name: 'Thorns I', icon: 'premade-powerups/sprites/Thorns.png', color: '#16a34a', weight: 10 },
            { id: 'protection-i', name: 'Protection I', icon: 'premade-powerups/sprites/Protection.png', color: '#64748b', weight: 10 },
            { id: 'power-ii', name: 'Power II', icon: 'premade-powerups/sprites/Power.png', color: '#b91c1c', weight: 5 },
            { id: 'speed-ii', name: 'Speed II', icon: 'premade-powerups/sprites/Speed.png', color: '#1d4ed8', weight: 5 },
            { id: 'size-ii', name: 'Size II', icon: 'premade-powerups/sprites/Size.webp', color: '#c026d3', weight: 5 },
            { id: 'thorns-ii', name: 'Thorns II', icon: 'premade-powerups/sprites/Thorns.png', color: '#15803d', weight: 5 },
            { id: 'protection-ii', name: 'Protection II', icon: 'premade-powerups/sprites/Protection.png', color: '#475569', weight: 5 },
        ];
    },
    resolvePowerupId(id) {
        return id || '';
    },
};

function testSliceWeightsAndAngles() {
    const slices = PowerupWheel.buildSlices();
    assert.strictEqual(slices.length, 11);
    const nothing = slices[0];
    assert.strictEqual(nothing.id, '');
    assert.ok(Math.abs(nothing.weight - 0.4) < 1e-9, `nothing weight ${nothing.weight}`);
    assert.ok(Math.abs(nothing.span - Math.PI * 2 * 0.4) < 1e-9);
    const poweredSum = slices.slice(1).reduce((sum, s) => sum + s.weight, 0);
    assert.ok(Math.abs(poweredSum - 0.6) < 1e-9, `powered pool ${poweredSum}`);
    assert.ok(nothing.span > slices.find((s) => s.id === 'power-i').span);
    assert.ok(slices.find((s) => s.id === 'power-i').span > slices.find((s) => s.id === 'power-ii').span);
    const total = slices.reduce((sum, s) => sum + s.span, 0);
    assert.ok(Math.abs(total - Math.PI * 2) < 1e-9);
}

function testAppleSharePinnedWhenPowerupsDrop() {
    const prev = {
        list: window.PremadePowerups.listWheelSlices,
        fits: window.PremadePowerups.powerupFitsWeapon,
        apple: window.PremadePowerups.isApplePowerup,
    };
    window.PremadePowerups.isApplePowerup = (id) => id === 'apple-i' || id === 'apple-ii';
    window.PremadePowerups.listWheelSlices = () => [
        { id: '', name: 'No powerup', weight: 1, color: '#94a3b8' },
        { id: 'power-i', name: 'Power I', weight: 10, color: '#dc2626' },
        { id: 'speed-i', name: 'Speed I', weight: 10, color: '#2563eb' },
        { id: 'size-i', name: 'Size I', weight: 10, color: '#d946ef' },
        { id: 'thorns-i', name: 'Thorns I', weight: 10, color: '#16a34a' },
        { id: 'protection-i', name: 'Protection I', weight: 10, color: '#64748b' },
        { id: 'apple-i', name: 'Golden Apple', weight: 10, color: '#fbbf24' },
        { id: 'power-ii', name: 'Power II', weight: 5, color: '#b91c1c' },
        { id: 'speed-ii', name: 'Speed II', weight: 5, color: '#1d4ed8' },
        { id: 'size-ii', name: 'Size II', weight: 5, color: '#c026d3' },
        { id: 'thorns-ii', name: 'Thorns II', weight: 5, color: '#15803d' },
        { id: 'protection-ii', name: 'Protection II', weight: 5, color: '#475569' },
        { id: 'apple-ii', name: 'Enchanted Apple', weight: 5, color: '#a855f7' },
    ];
    const appleShare = (id, slices) => slices.find((s) => s.id === id).weight;
    const full = PowerupWheel.buildSlices();
    assert.ok(Math.abs(full.find((s) => !s.id).weight - 0.4) < 1e-9);
    // Catalog apples are 15/90 of the 60% pool → 10% of the rim, 2:1 gold:enchanted.
    assert.ok(Math.abs(appleShare('apple-i', full) - (10 / 15) * 0.1) < 1e-9);
    assert.ok(Math.abs(appleShare('apple-ii', full) - (5 / 15) * 0.1) < 1e-9);

    window.PremadePowerups.powerupFitsWeapon = (id) => !String(id).startsWith('size-')
        && !String(id).startsWith('speed-');
    const filtered = PowerupWheel.buildSlices({ fighter: { weaponId: 'webs' } });
    window.PremadePowerups.listWheelSlices = prev.list;
    window.PremadePowerups.powerupFitsWeapon = prev.fits;
    window.PremadePowerups.isApplePowerup = prev.apple;

    assert.strictEqual(filtered.some((s) => String(s.id).startsWith('size-')), false);
    assert.strictEqual(filtered.some((s) => String(s.id).startsWith('speed-')), false);
    assert.ok(filtered.some((s) => s.id === 'power-i'));
    assert.ok(Math.abs(filtered.find((s) => !s.id).weight - 0.4) < 1e-9);
    assert.ok(Math.abs(appleShare('apple-i', filtered) - (10 / 15) * 0.1) < 1e-9);
    assert.ok(Math.abs(appleShare('apple-ii', filtered) - (5 / 15) * 0.1) < 1e-9);
    const rest = filtered.filter((s) => s.id && !String(s.id).startsWith('apple-'));
    assert.ok(Math.abs(rest.reduce((sum, s) => sum + s.weight, 0) - 0.5) < 1e-9);
}

function testNothingStaysFortyWithExtraPowerups() {
    const base = window.PremadePowerups.listWheelSlices;
    window.PremadePowerups.listWheelSlices = () => [
        { id: '', name: 'No powerup', weight: 1, color: '#94a3b8' },
        { id: 'a', name: 'A', weight: 10, color: '#f00' },
        { id: 'b', name: 'B', weight: 10, color: '#0f0' },
        { id: 'c', name: 'C', weight: 10, color: '#00f' },
        { id: 'd', name: 'D', weight: 10, color: '#ff0' },
        { id: 'e', name: 'E', weight: 10, color: '#0ff' },
        { id: 'f', name: 'F', weight: 10, color: '#f0f' },
        { id: 'g', name: 'G', weight: 5, color: '#abc' },
        { id: 'h', name: 'H', weight: 5, color: '#cba' },
    ];
    const slices = PowerupWheel.buildSlices();
    window.PremadePowerups.listWheelSlices = base;
    const nothing = slices.find((s) => !s.id);
    assert.ok(Math.abs(nothing.weight - 0.4) < 1e-9);
    const powered = slices.filter((s) => s.id);
    assert.strictEqual(powered.length, 8);
    assert.ok(Math.abs(powered.reduce((sum, s) => sum + s.weight, 0) - 0.6) < 1e-9);
    // Equal weights share the 60% pool evenly among the 10+10… group — a is 10/70 of 0.6
    const a = powered.find((s) => s.id === 'a');
    assert.ok(Math.abs(a.weight - (10 / 70) * 0.6) < 1e-9);
}

function testWeightedPickDistribution() {
    const slices = PowerupWheel.buildSlices();
    const counts = Object.fromEntries(slices.map((s) => [s.id || 'nothing', 0]));
    const n = 20000;
    let i = 0;
    const rng = () => {
        i += 1;
        // Deterministic low-discrepancy-ish sequence in [0,1)
        return ((i * 9973) % 100000) / 100000;
    };
    for (let k = 0; k < n; k += 1) {
        const idx = PowerupWheel.pickSliceIndex(slices, rng);
        const key = slices[idx].id || 'nothing';
        counts[key] += 1;
    }
    const nothingShare = counts.nothing / n;
    const powerIShare = counts['power-i'] / n;
    const powerIIShare = counts['power-ii'] / n;
    // power-i: 10/75 of 60% = 8%; power-ii: 5/75 of 60% = 4%
    assert.ok(nothingShare > 0.36 && nothingShare < 0.44, `nothing ~40%, got ${nothingShare}`);
    assert.ok(powerIShare > 0.06 && powerIShare < 0.10, `power-i ~8%, got ${powerIShare}`);
    assert.ok(powerIIShare > 0.03 && powerIIShare < 0.055, `power-ii ~4%, got ${powerIIShare}`);
}

function testSpinCompletesAndApplies() {
    const spinA = PowerupWheel.createSpin({
        fighter: { name: 'A', color: '#f00', arenaMatchup: { id: 'a', config: {} } },
        delayMs: 0,
        random: () => 0.01,
    });
    const spinB = PowerupWheel.createSpin({
        fighter: { name: 'B', color: '#0f0', arenaMatchup: { id: 'b', config: {} } },
        delayMs: 450,
        random: () => 0.5,
    });
    assert.strictEqual(PowerupWheel.isPairDone(spinA, spinB, 100), false);
    assert.strictEqual(PowerupWheel.isPairDone(spinA, spinB, 5000), false);
    assert.strictEqual(
        PowerupWheel.isPairDone(spinA, spinB, PowerupWheel.spinDurationMs(spinA, spinB)),
        true,
    );

    const fighter = { name: 'A', arenaMatchup: { id: 'a', config: {} } };
    PowerupWheel.applyResultToFighter(fighter, 'speed-i');
    assert.strictEqual(fighter.powerupId, 'speed-i');
    assert.strictEqual(fighter.arenaMatchup.config.powerupId, 'speed-i');
    PowerupWheel.applyResultToFighter(fighter, '');
    assert.strictEqual(fighter.powerupId, null);
    assert.strictEqual(fighter.arenaMatchup.config.powerupId, undefined);
}

function testApplyWithoutRegistryKeepsId() {
    const prev = window.PremadePowerups;
    delete window.PremadePowerups;
    const fighter = { name: 'A', arenaMatchup: { id: 'a', config: {} } };
    PowerupWheel.applyResultToFighter(fighter, 'speed-i');
    assert.strictEqual(fighter.powerupId, 'speed-i');
    assert.strictEqual(fighter.arenaMatchup.config.powerupId, 'speed-i');
    window.PremadePowerups = prev;
}

function testSliceLabelsAreRadial() {
    const slices = PowerupWheel.buildSlices();
    const nothing = PowerupWheel.sliceLabelLayout(slices[0], 280);
    const thin = PowerupWheel.sliceLabelLayout(slices.find((s) => s.id === 'power-ii'), 280);
    assert.strictEqual(nothing.mode, 'radial');
    assert.strictEqual(thin.mode, 'radial');
    assert.strictEqual(nothing.anchor, 'outer');
    assert.strictEqual(thin.anchor, 'outer');
    assert.ok(nothing.outer > nothing.inner);
    assert.ok(nothing.outer <= 280 * 0.72, 'names sit inside the outer icon ring');
    assert.strictEqual(nothing.label, 'No Powerup');
    assert.ok(nothing.fontSize >= 10);
    assert.ok(thin.fontSize > 0);
    for (const slice of slices) {
        const layout = PowerupWheel.sliceLabelLayout(slice, 280);
        assert.ok(layout.label, `missing name for ${slice.id || 'nothing'}`);
        assert.ok(layout.fontSize > 0, `hidden name for ${layout.label}`);
    }
}

function testTickTimesCrossSectors() {
    const spin = PowerupWheel.createSpin({ delayMs: 0, random: () => 0.2 });
    const times = PowerupWheel.tickTimesMs(spin);
    assert.ok(times.length >= 20, `expected many sector ticks, got ${times.length}`);
    assert.ok(times[0] > 0);
    assert.ok(times[times.length - 1] <= spin.durationMs);
    const events = PowerupWheel.collectTickEvents(spin, null);
    assert.strictEqual(events.length, times.length);
    assert.ok(events.every((ev) => ev.tMs >= 0 && ev.intensity >= 0));
}

function testNextSpinIsSequential() {
    const spinA = PowerupWheel.createSpin({ delayMs: 0, random: () => 0.2 });
    const delayB = PowerupWheel.nextSpinDelayMs(spinA);
    assert.strictEqual(
        delayB,
        PowerupWheel.SPIN_MS + PowerupWheel.REVEAL_MS + PowerupWheel.SEQUENCE_GAP_MS,
    );
    const spinB = PowerupWheel.createSpin({ delayMs: delayB, random: () => 0.4 });
    assert.strictEqual(PowerupWheel.spinProgress(spinB, delayB - 1).spinning, false);
    assert.strictEqual(PowerupWheel.spinProgress(spinA, delayB - 1).done, true);
}

function testSerializeRoundTrip() {
    const spin = PowerupWheel.createSpin({
        fighter: { name: 'Hammer', color: '#111111' },
        delayMs: 450,
        random: () => 0.2,
    });
    const json = JSON.parse(JSON.stringify(PowerupWheel.serializeSpin(spin)));
    assert.strictEqual(json.resultId, spin.resultId);
    assert.ok(json.slices.length > 0);
    assert.ok(json.slices.some((s) => s.id && s.icon));
    assert.strictEqual(json.slices.find((s) => !s.id).name, 'No Powerup');
    assert.strictEqual(
        PowerupWheel.spinDurationMs(json, json),
        PowerupWheel.SPIN_MS + PowerupWheel.REVEAL_MS + 450,
    );
}

testSliceWeightsAndAngles();
console.log('ok  testSliceWeightsAndAngles');
testAppleSharePinnedWhenPowerupsDrop();
console.log('ok  testAppleSharePinnedWhenPowerupsDrop');
testNothingStaysFortyWithExtraPowerups();
console.log('ok  testNothingStaysFortyWithExtraPowerups');
testWeightedPickDistribution();
console.log('ok  testWeightedPickDistribution');
testSpinCompletesAndApplies();
console.log('ok  testSpinCompletesAndApplies');
testApplyWithoutRegistryKeepsId();
console.log('ok  testApplyWithoutRegistryKeepsId');
testSliceLabelsAreRadial();
console.log('ok  testSliceLabelsAreRadial');
testTickTimesCrossSectors();
console.log('ok  testTickTimesCrossSectors');
testNextSpinIsSequential();
console.log('ok  testNextSpinIsSequential');
testSerializeRoundTrip();
console.log('ok  testSerializeRoundTrip');
console.log('\n10 passed');
