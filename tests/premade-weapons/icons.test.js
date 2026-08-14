/**
 * node tests/premade-weapons/icons.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const FUN = path.join(__dirname, '../..');
global.window = global;
require(path.join(FUN, 'premade-weapons/registry.js'));
require(path.join(FUN, 'premade-weapons/sword.js'));
require(path.join(FUN, 'premade-weapons/dagger.js'));
require(path.join(FUN, 'premade-weapons/hammer.js'));
require(path.join(FUN, 'premade-weapons/spikes.js'));
require(path.join(FUN, 'premade-weapons/slingshot.js'));
require(path.join(FUN, 'premade-weapons/bow.js'));
require(path.join(FUN, 'premade-weapons/basketball.js'));
require(path.join(FUN, 'premade-weapons/staff.js'));
require(path.join(FUN, 'premade-weapons/grenade.js'));
require(path.join(FUN, 'premade-weapons/index.js'));

assert.strictEqual(PremadeWeapons.iconUrl('sword'), 'premade-weapons/sprites/Sword.png');
assert.strictEqual(PremadeWeapons.iconUrl('hammer'), 'premade-weapons/sprites/Stone_Hammer.png');
assert.strictEqual(PremadeWeapons.iconUrl('bow'), 'premade-weapons/sprites/Bow-unloaded.png');
assert.strictEqual(PremadeWeapons.iconUrl('dagger'), 'premade-weapons/sprites/Sword.png');
assert.strictEqual(PremadeWeapons.iconUrl('spikes'), null);
assert.strictEqual(PremadeWeapons.iconUrl(''), null);

const ball = { };
PremadeWeapons.applyWeaponToBall(ball, 'sword');
assert.strictEqual(ball.weaponIcon, 'premade-weapons/sprites/Sword.png');
PremadeWeapons.applyWeaponToBall(ball, 'dagger');
assert.strictEqual(ball.weaponIcon, 'premade-weapons/sprites/Sword.png');

console.log('ok  weapon icons only on sprites that exist');
