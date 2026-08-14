/**
 * Premade weapon catalog — loads after individual weapon files register themselves.
 * Exposes: window.PremadeWeapons
 *
 * To add a weapon:
 *   1. Add premade-weapons/your-weapon.js (PremadeWeaponRegistry.register with stats + behavior)
 *   2. Include the script in pages/index.html (and offline-render.html / workflow.html) after registry.js
 */
(function () {
    'use strict';

    const registry = window.PremadeWeaponRegistry;
    if (!registry) {
        throw new Error('PremadeWeapons: missing PremadeWeaponRegistry (load registry.js first)');
    }

    const PremadeWeaponId = registry.getPremadeWeaponId();
    const PREMADE_WEAPONS = registry.getPremadeWeapons();
    const DEFAULT_WEAPON = PremadeWeaponId.SWORD;

    function getPremadeWeapon(id) {
        return registry.getPremadeWeapon(id);
    }

    function iconUrl(weaponId) {
        if (typeof weaponId !== 'string' || !weaponId) return null;
        return getPremadeWeapon(weaponId)?.icon || null;
    }

    /**
     * Which powerup effects actually change this weapon.
     * Size follows registered geometry / projectileRadius, not applyWeaponToBall defaults.
     */
    function weaponPowerupProfile(weaponId) {
        const spec = getPremadeWeapon(weaponId);
        if (!spec) return { damage: true, speed: true, size: true };
        const probe = {
            radius: 20,
            projectileRadius: spec.projectileRadius ?? null,
            swordLength: spec.swordLength ?? 0,
            spikeLength: spec.spikeLength ?? 0,
            bowLength: spec.bowLength ?? 0,
            bladeWidthScale: spec.bladeWidthScale ?? 0,
            weaponDamage: spec.weaponDamage ?? 0,
            projectileDamage: spec.projectileDamage ?? spec.weaponDamage ?? 0,
            spinSpeed: spec.spinSpeed ?? 0,
        };
        const behavior = registry.resolveBehavior(spec);
        const ranged = !!behavior.shootsProjectiles?.(probe);
        const melee = behavior.canDealMeleeDamage?.(probe) !== false;
        const damage = melee || ranged
            || Number(spec.weaponDamage) > 0
            || Number(spec.projectileDamage) > 0;
        const speed = Number(spec.spinSpeed) > 0 || ranged;
        let size = Number(spec.swordLength) > 0
            || Number(spec.spikeLength) > 0
            || Number(spec.bowLength) > 0
            || Number(spec.bladeWidthScale) > 0
            || Number(spec.projectileRadius) > 0;
        if (!size && ranged) {
            const sent = behavior.buildProjectile?.({ ...probe, projectileRadius: 99 });
            size = !sent || sent.radius === 99;
        }
        return { damage, speed, size };
    }

    function applyWeaponToBall(ball, weaponId) {
        const spec = getPremadeWeapon(weaponId);
        if (!spec) {
            throw new Error(`Unknown premade weapon: ${weaponId}`);
        }
        ball.weaponKind = spec.weaponKind || 'blade';
        ball.weaponDamage = spec.weaponDamage;
        // Per-ball spin jitter so identical weapons drift out of phase
        const spinScale = 0.86 + Math.random() * 0.28;
        ball.spinSpeed = spec.spinSpeed * spinScale;
        ball.swordLength = spec.swordLength ?? 0;
        ball.spikeCount = spec.spikeCount ?? 0;
        ball.spikeLength = spec.spikeLength ?? 0;
        ball.shootInterval = spec.shootInterval ?? 1.4;
        ball.arrowSpeed = spec.arrowSpeed ?? 400;
        ball.bowLength = spec.bowLength ?? 28;
        ball.knockbackScale = spec.knockbackScale;
        ball.bladeWidthScale = spec.bladeWidthScale ?? 1;
        ball.damageMax = spec.damageMax ?? spec.weaponDamage;
        ball.damageRampHits = spec.damageRampHits ?? 0;
        ball.projectileDamage = spec.projectileDamage ?? spec.weaponDamage;
        ball.projectileKind = spec.projectileKind || null;
        ball.projectileRadius = spec.projectileRadius ?? null;
        ball.baseSpinSpeed = ball.spinSpeed;
        ball.spinSpeedMax = (spec.spinSpeedMax ?? spec.spinSpeed) * spinScale;
        ball.weaponId = weaponId;
        ball.weaponName = spec.name;
        ball.weaponIcon = spec.icon || null;
        ball.weaponBio = spec.bio;
        ball.weaponBehavior = registry.resolveBehavior(spec);
        ball._pendingShot = false;
        ball._damageCharge = 0;
        ball._laserCooldown = 0;
        ball._laserBeam = null;
        if (ball.weaponBehavior.shootsProjectiles?.(ball)) {
            ball._shootTimer = Math.random() * ball.shootInterval * 0.5;
        }
        ball.weaponBehavior.apply?.(ball, spec);
        return ball;
    }

    window.PremadeWeapons = {
        PremadeWeaponId,
        PREMADE_WEAPONS,
        DEFAULT_WEAPON,
        getPremadeWeapon,
        iconUrl,
        weaponPowerupProfile,
        applyWeaponToBall,
    };
}());
