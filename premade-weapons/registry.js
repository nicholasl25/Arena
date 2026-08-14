/**
 * Premade weapon registry — each weapon file calls register() with stats + optional behavior.
 *
 * To add a weapon:
 *   1. Create premade-weapons/your-weapon.js that calls PremadeWeaponRegistry.register(...)
 *   2. Include the script in pages/index.html / offline-render.html / workflow.html after registry.js
 *   3. For special abilities, pass a `behavior` object (see DefaultWeaponBehavior hooks below).
 *      Stats-only weapons (sword, dagger) can omit behavior and get the blade defaults.
 *
 * Kind sharing: the first weapon that registers a given weaponKind installs that kind's
 * default behavior. Later weapons with the same kind (e.g. basketball → slingshot) inherit it
 * unless they pass their own `behavior`.
 */
(function () {
    'use strict';

    const PREMADE_WEAPONS = {};
    const PremadeWeaponId = {};
    /** @type {Record<string, object>} */
    const KIND_BEHAVIORS = {};
    /** @type {Record<string, function>} */
    const PROJECTILE_DRAWERS = {};

    /** Spin the weapon angle by spinSpeed. */
    function spinWeapon(ball, dt) {
        ball.weaponAngle = (ball.weaponAngle + ball.spinSpeed * dt) % (Math.PI * 2);
    }

    /** Spin + accumulate shoot timer → ball._pendingShot. */
    function spinAndShoot(ball, dt) {
        spinWeapon(ball, dt);
        ball._shootTimer = (ball._shootTimer || 0) + dt;
        if (ball._shootTimer >= ball.shootInterval) {
            ball._shootTimer -= ball.shootInterval;
            ball._pendingShot = true;
        }
    }

    /**
     * Default blade — long rotating segment, strike slow-mo on hit, shatters projectiles.
     * Weapon files override only the hooks they need.
     */
    const DefaultWeaponBehavior = {
        canDealMeleeDamage() {
            return true;
        },
        appliesRecoil() {
            return true;
        },
        blocksMelee() {
            return false;
        },
        shootsProjectiles() {
            return false;
        },
        skipsStrikeSlow() {
            return false;
        },
        /** @returns {number|null} null → sim default cooldown */
        getHitCooldown() {
            return null;
        },
        getHitSegments(ball) {
            return ball.getSwordSegment ? [ball.getSwordSegment()] : [];
        },
        getDamage(ball) {
            return ball.weaponDamage;
        },
        getChargeFraction() {
            return 1;
        },
        registerHit() {},
        step(ball, dt) {
            spinWeapon(ball, dt);
        },
        apply() {},
        update() {},
        onWallCollision() {},
        onBallCollision() {},
        /**
         * After a successful melee hit that dealt damage.
         * Default: strike slow-mo. Laser overrides to pause the beam instead.
         */
        onMeleeHit(attacker, defender, sim) {
            sim._triggerStrikeSlow();
        },
        /** @returns {{ duration?: number, scale?: number }|null} */
        clashSlowMo() {
            return null;
        },
        /**
         * @returns {'reflect'|'shatter'|'stick'|null}
         * null = ignore this weapon for deflection (keep checking others)
         */
        onProjectileContact() {
            return 'shatter';
        },
        /** Whether this weapon's hit segments can slice web strands. */
        cutsWebs() {
            return true;
        },
        /** Optional projectile field overrides merged into spawnArrow defaults. */
        buildProjectile() {
            return null;
        },
        /** @param {*} _ctx @param {*} ball @param {*} h render helpers from ArenaRender */
        draw(_ctx, ball, h) {
            if (!ball.getSwordSegment) return;
            const seg = ball.getSwordSegment();
            h.drawSword(
                _ctx,
                h.toX(seg.x1),
                h.toY(seg.y1),
                h.toX(seg.x2),
                h.toY(seg.y2),
                h.scale,
                h.dpr,
                ball.bladeWidthScale ?? 1,
            );
        },
        /** 'punch' | null — arena-app hit SFX */
        hitSfx: null,
        /** 'glove' | null — arena-app clash SFX when both match */
        clashSfx: null,
    };

    const NoneWeaponBehavior = {
        ...DefaultWeaponBehavior,
        canDealMeleeDamage() {
            return false;
        },
        getHitSegments() {
            return [];
        },
        step() {},
        draw() {},
    };

    function resolveBehavior(spec) {
        const kind = spec.weaponKind || 'blade';
        const base = KIND_BEHAVIORS[kind] || DefaultWeaponBehavior;
        if (!spec.behavior) return Object.assign({}, base);
        return Object.assign({}, base, spec.behavior);
    }

    window.PremadeWeaponRegistry = {
        DefaultWeaponBehavior,
        NoneWeaponBehavior,
        helpers: { spinWeapon, spinAndShoot },

        /**
         * @param {string} id stable string id (e.g. 'sword')
         * @param {string} idKey constant key on PremadeWeaponId (e.g. 'SWORD')
         * @param {object} spec stats + optional behavior / projectileKind
         */
        register(id, idKey, spec) {
            PremadeWeaponId[idKey] = id;
            PREMADE_WEAPONS[id] = spec;
            const kind = spec.weaponKind || 'blade';
            if (spec.behavior && !KIND_BEHAVIORS[kind]) {
                KIND_BEHAVIORS[kind] = Object.assign({}, DefaultWeaponBehavior, spec.behavior);
            }
            if (spec.projectileDraw && spec.projectileKind) {
                PROJECTILE_DRAWERS[spec.projectileKind] = spec.projectileDraw;
            }
        },

        /** Register a projectile drawer by kind (e.g. 'plasma', 'basketball'). */
        registerProjectileDraw(kind, drawFn) {
            PROJECTILE_DRAWERS[kind] = drawFn;
        },

        getProjectileDraw(kind) {
            return PROJECTILE_DRAWERS[kind] || null;
        },

        resolveBehavior,

        getPremadeWeapon(id) {
            return PREMADE_WEAPONS[id] || null;
        },

        getPremadeWeaponId() {
            return PremadeWeaponId;
        },

        getPremadeWeapons() {
            return PREMADE_WEAPONS;
        },
    };
}());
