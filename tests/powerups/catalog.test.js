/**
 * node tests/powerups/catalog.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const ARENA = path.join(__dirname, '../..');

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

function meleeBall(extra = {}) {
    return {
        weaponDamage: 10,
        spinSpeed: 100,
        baseSpinSpeed: 100,
        hitCooldownScale: 1,
        damageTakenMult: 1,
        thornsReflectMult: 0,
        weaponBehavior: {
            canDealMeleeDamage: () => true,
            getHitSegments: () => [{}],
            shootsProjectiles: () => false,
        },
        ...extra,
    };
}

function hybridBall() {
    return meleeBall({
        projectileDamage: 8,
        shootInterval: 1000,
        weaponBehavior: {
            canDealMeleeDamage: () => true,
            getHitSegments: () => [{}],
            shootsProjectiles: () => true,
        },
    });
}

function testResolveKnownAndUnknown() {
    assert.strictEqual(PremadePowerups.resolvePowerupId('speed-i'), 'speed-i');
    assert.strictEqual(PremadePowerups.resolvePowerupId('nope'), '');
    assert.strictEqual(PremadePowerups.resolvePowerupId(''), '');
    assert.strictEqual(PremadePowerups.resolvePowerupId(null), '');
}

function testWheelSlicesPinNothingFirst() {
    const slices = PremadePowerups.listWheelSlices();
    assert.strictEqual(slices[0].id, '');
    assert.strictEqual(slices[0].name, 'No Powerup');
    assert.strictEqual(slices[0].icon, 'premade-powerups/sprites/EmptyBottle.webp');
    assert.strictEqual(slices[0].icon, PremadePowerups.EMPTY_POWERUP_ICON);
    const speed = slices.find((s) => s.id === 'speed-i');
    assert.strictEqual(speed.weight, 10);
    const speed2 = slices.find((s) => s.id === 'speed-ii');
    assert.strictEqual(speed2.weight, 5);
    const apple = slices.find((s) => s.id === 'apple-i');
    assert.strictEqual(apple.name, 'Golden Apple');
    assert.strictEqual(apple.icon, 'premade-powerups/sprites/GoldenApple.webp');
    const enchanted = slices.find((s) => s.id === 'apple-ii');
    assert.strictEqual(enchanted.name, 'Enchanted Apple');
    assert.strictEqual(enchanted.icon, 'premade-powerups/sprites/EnchantedApple.gif');
    assert.ok(slices.filter((s) => s.id).length >= 12);
}

function testSpeedMeleeVsHybrid() {
    const melee = PremadePowerups.applyPowerupToBall(meleeBall(), 'speed-i');
    assert.strictEqual(melee.spinSpeed, 175);
    assert.ok(Math.abs(melee.hitCooldownScale - (1 / 1.75)) < 1e-9);

    const hybrid = PremadePowerups.applyPowerupToBall(hybridBall(), 'speed-i');
    assert.strictEqual(hybrid.spinSpeed, 133);
    assert.ok(Math.abs(hybrid.shootInterval - (1000 / 1.33)) < 1e-6);
    assert.ok(Math.abs(hybrid.hitCooldownScale - (1 / 1.33)) < 1e-9);
}

function testPowerAndProtectionAndThorns() {
    const powered = PremadePowerups.applyPowerupToBall(meleeBall(), 'power-i');
    assert.strictEqual(powered.weaponDamage, 15);
    assert.strictEqual(powered.powerupName, 'Power I');

    const shielded = PremadePowerups.applyPowerupToBall(meleeBall(), 'protection-i');
    assert.ok(Math.abs(shielded.damageTakenMult - (2 / 3)) < 1e-9);

    const thorns = PremadePowerups.applyPowerupToBall(meleeBall(), 'thorns-i');
    assert.ok(Math.abs(thorns.thornsReflectMult - (1 / 3)) < 1e-9);
}

function testApplesStackAllRanks() {
    const gold = PremadePowerups.applyPowerupToBall(meleeBall({ swordLength: 40 }), 'apple-i');
    assert.strictEqual(gold.powerupName, 'Golden Apple');
    assert.strictEqual(gold.weaponDamage, 15);
    assert.strictEqual(gold.spinSpeed, 175);
    assert.strictEqual(gold.swordLength, 54);
    assert.ok(Math.abs(gold.damageTakenMult - (2 / 3)) < 1e-9);
    assert.ok(Math.abs(gold.thornsReflectMult - (1 / 3)) < 1e-9);

    const enchanted = PremadePowerups.applyPowerupToBall(meleeBall({ swordLength: 40 }), 'apple-ii');
    assert.strictEqual(enchanted.powerupName, 'Enchanted Apple');
    assert.strictEqual(enchanted.weaponDamage, 20);
    assert.strictEqual(enchanted.spinSpeed, 225);
    assert.strictEqual(enchanted.swordLength, 68);
    assert.strictEqual(enchanted.damageTakenMult, 0.5);
    assert.strictEqual(enchanted.thornsReflectMult, 0.5);
}

function testPowerupFitsWeapon() {
    assert.deepStrictEqual(PremadeWeapons.weaponPowerupProfile('webs'), {
        damage: true, speed: false, size: false,
    });
    assert.deepStrictEqual(PremadeWeapons.weaponPowerupProfile('grenade'), {
        damage: true, speed: true, size: false,
    });
    assert.deepStrictEqual(PremadeWeapons.weaponPowerupProfile('boomerang'), {
        damage: true, speed: true, size: false,
    });
    const sword = PremadeWeapons.weaponPowerupProfile('sword');
    assert.strictEqual(sword.damage, true);
    assert.strictEqual(sword.speed, true);
    assert.strictEqual(sword.size, true);
    assert.strictEqual(PremadeWeapons.weaponPowerupProfile('laser').size, true);

    assert.strictEqual(PremadePowerups.powerupFitsWeapon('size-i', 'webs'), false);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('speed-i', 'webs'), false);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('power-i', 'webs'), true);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('protection-i', 'webs'), true);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('apple-ii', 'webs'), true);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('size-i', 'grenade'), false);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('power-i', 'grenade'), true);
    assert.strictEqual(PremadePowerups.powerupFitsWeapon('size-i', 'sword'), true);
}

function testEmptyIdClearsBall() {
    const ball = PremadePowerups.applyPowerupToBall(meleeBall(), 'power-i');
    PremadePowerups.applyPowerupToBall(ball, '');
    assert.strictEqual(ball.powerupId, null);
    assert.strictEqual(ball.powerupName, null);
    assert.strictEqual(ball.damageTakenMult, 1);
    assert.strictEqual(ball.thornsReflectMult, 0);
    assert.strictEqual(ball.hitCooldownScale, 1);
}

const tests = [
    testResolveKnownAndUnknown,
    testWheelSlicesPinNothingFirst,
    testSpeedMeleeVsHybrid,
    testPowerAndProtectionAndThorns,
    testApplesStackAllRanks,
    testPowerupFitsWeapon,
    testEmptyIdClearsBall,
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
