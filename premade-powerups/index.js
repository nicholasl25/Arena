/**
 * Premade powerup catalog — apply after weapon stats are set.
 * Exposes: window.PremadePowerups
 */
(function () {
    'use strict';

    const registry = window.PremadePowerupRegistry;
    if (!registry) {
        throw new Error('PremadePowerups: missing PremadePowerupRegistry (load registry.js first)');
    }

    const PremadePowerupId = registry.getPremadePowerupId();
    const PREMADE_POWERUPS = registry.getPremadePowerups();
    const EMPTY_POWERUP_ID = '';
    const EMPTY_POWERUP_ICON = 'premade-powerups/sprites/EmptyBottle.webp';
    const EMPTY_POWERUP_NAME = 'No Powerup';

    function getPremadePowerup(id) {
        return registry.getPremadePowerup(id);
    }

    function resolvePowerupId(raw) {
        if (raw == null || raw === EMPTY_POWERUP_ID) return EMPTY_POWERUP_ID;
        if (typeof raw !== 'string') return EMPTY_POWERUP_ID;
        return getPremadePowerup(raw) ? raw : EMPTY_POWERUP_ID;
    }

    function listPowerups() {
        return Object.keys(PREMADE_POWERUPS)
            .map((id) => {
                const spec = PREMADE_POWERUPS[id];
                return {
                    id,
                    name: spec.name,
                    icon: spec.icon || null,
                    color: spec.color,
                    bio: spec.bio || '',
                    searchText: `${spec.name} ${id} ${spec.bio || ''}`,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    function isApplePowerup(id) {
        return typeof id === 'string' && id.startsWith('apple-');
    }

    /** Tags a powerup must match on the weapon. Empty = always valid. Apples always valid. */
    function powerupWheelNeeds(spec) {
        if (!spec || isApplePowerup(spec.id)) return [];
        const needs = [];
        if ((Number(spec.damageMult) || 1) !== 1) needs.push('damage');
        if ((Number(spec.speedMult) || 1) !== 1) needs.push('speed');
        if ((Number(spec.sizeMult) || 1) !== 1) needs.push('size');
        return needs;
    }

    function powerupFitsWeapon(powerupId, weaponId) {
        if (!powerupId) return true;
        if (isApplePowerup(powerupId)) return true;
        const spec = getPremadePowerup(powerupId);
        if (!spec) return false;
        const needs = powerupWheelNeeds({ ...spec, id: powerupId });
        if (!needs.length) return true;
        if (!weaponId || !window.PremadeWeapons?.weaponPowerupProfile) return true;
        const profile = window.PremadeWeapons.weaponPowerupProfile(weaponId);
        return needs.every((tag) => profile[tag]);
    }

    /** Wheel slices: Nothing is listed first; PowerupWheel pins it to 40% of the rim. */
    function listWheelSlices() {
        const slices = [{
            id: EMPTY_POWERUP_ID,
            name: EMPTY_POWERUP_NAME,
            icon: EMPTY_POWERUP_ICON,
            color: '#ffffff',
            weight: 1,
        }];
        for (const id of Object.keys(PREMADE_POWERUPS)) {
            const spec = PREMADE_POWERUPS[id];
            const weight = Number(spec.wheelWeight);
            if (!(weight > 0)) continue;
            slices.push({
                id,
                name: spec.name,
                icon: spec.icon || null,
                color: spec.color || '#888888',
                weight,
            });
        }
        return slices;
    }

    function ballHasMeleeThreat(ball) {
        const behavior = ball.weaponBehavior;
        if (!behavior || behavior.canDealMeleeDamage?.(ball) === false) return false;
        const segs = behavior.getHitSegments?.(ball);
        if (Array.isArray(segs)) return segs.length > 0;
        return true;
    }

    function ballHasRangedThreat(ball) {
        return !!ball.weaponBehavior?.shootsProjectiles?.(ball);
    }

    /** Melee + projectiles both scale with Speed — use the smaller hybrid mult. */
    function resolveSpeedMult(ball, spec) {
        const full = Number(spec.speedMult) || 1;
        if (full === 1) return 1;
        if (!(ballHasMeleeThreat(ball) && ballHasRangedThreat(ball))) return full;
        const hybrid = Number(spec.hybridSpeedMult);
        return Number.isFinite(hybrid) && hybrid > 0 ? hybrid : full;
    }

    /**
     * Scale weapon stats already applied to the ball.
     * Safe to call with empty / unknown id (no-op).
     */
    function applyPowerupToBall(ball, powerupId) {
        const id = resolvePowerupId(powerupId);
        ball.powerupId = id || null;
        ball.powerupName = null;
        ball.powerupIcon = null;
        ball.powerupColor = null;
        ball.powerupBio = null;
        ball.hitCooldownScale = 1;
        ball.damageTakenMult = 1;
        ball.thornsReflectMult = 0;

        if (!id) return ball;
        const spec = getPremadePowerup(id);
        if (!spec) return ball;

        const damageMult = Number(spec.damageMult) || 1;
        const speedMult = resolveSpeedMult(ball, spec);
        const sizeMult = Number(spec.sizeMult) || 1;
        const damageTakenMult = Number(spec.damageTakenMult);
        const thornsReflectMult = Number(spec.thornsReflectMult);

        if (damageMult !== 1) {
            if (Number.isFinite(ball.weaponDamage)) ball.weaponDamage *= damageMult;
            if (Number.isFinite(ball.projectileDamage)) ball.projectileDamage *= damageMult;
            if (Number.isFinite(ball.damageMax)) ball.damageMax *= damageMult;
        }

        if (speedMult !== 1) {
            if (Number.isFinite(ball.spinSpeed)) ball.spinSpeed *= speedMult;
            if (Number.isFinite(ball.baseSpinSpeed)) ball.baseSpinSpeed *= speedMult;
            if (Number.isFinite(ball.spinSpeedMax)) ball.spinSpeedMax *= speedMult;
            if (Number.isFinite(ball.shootInterval) && ball.shootInterval > 0) {
                ball.shootInterval /= speedMult;
            }
            ball.hitCooldownScale = 1 / speedMult;
        }

        if (sizeMult !== 1) {
            if (Number.isFinite(ball.swordLength) && ball.swordLength > 0) {
                ball.swordLength *= sizeMult;
            }
            if (Number.isFinite(ball.spikeLength) && ball.spikeLength > 0) {
                ball.spikeLength *= sizeMult;
            }
            if (Number.isFinite(ball.bowLength) && ball.bowLength > 0) {
                ball.bowLength *= sizeMult;
            }
            if (Number.isFinite(ball.bladeWidthScale) && ball.bladeWidthScale > 0) {
                ball.bladeWidthScale *= sizeMult;
            }
            const projR = Number(ball.projectileRadius);
            if (Number.isFinite(projR) && projR > 0) {
                ball.projectileRadius = projR * sizeMult;
            } else if (ballHasRangedThreat(ball)) {
                ball.projectileRadius = 7.5 * sizeMult;
            }
        }

        if (Number.isFinite(damageTakenMult) && damageTakenMult >= 0) {
            ball.damageTakenMult = damageTakenMult;
        }
        if (Number.isFinite(thornsReflectMult) && thornsReflectMult > 0) {
            ball.thornsReflectMult = thornsReflectMult;
        }

        ball.powerupId = id;
        ball.powerupName = spec.name;
        ball.powerupIcon = spec.icon || null;
        ball.powerupColor = spec.color || '#888888';
        ball.powerupBio = spec.bio || '';
        return ball;
    }

    window.PremadePowerups = {
        PremadePowerupId,
        PREMADE_POWERUPS,
        EMPTY_POWERUP_ID,
        EMPTY_POWERUP_ICON,
        EMPTY_POWERUP_NAME,
        getPremadePowerup,
        resolvePowerupId,
        listPowerups,
        listWheelSlices,
        isApplePowerup,
        powerupFitsWeapon,
        applyPowerupToBall,
    };
}());
