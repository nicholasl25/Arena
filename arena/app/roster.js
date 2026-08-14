/**
 * ArenaApp — makeRoster, spawn, labels, wall inset, velocities.
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});

    P.randomVelocity = function randomVelocity(speed) {
        // |vy| at least 40% of speed — flat launches skim the floor under gravity.
        const elev = 0.4 + Math.random() * 0.6;
        const sin = elev * (Math.random() < 0.5 ? -1 : 1);
        const cos = Math.sqrt(1 - elev * elev) * (Math.random() < 0.5 ? -1 : 1);
        return { vx: cos * speed, vy: sin * speed };
    }

    P.computeWallInset = function computeWallInset() {
        if (!P.canvas || !P.canvas.width) return 12;
        const dpr = window.devicePixelRatio || 1;
        const lineW = Math.max(6, 8 * dpr);
        // Match arena-render spike padding so physics walls align with the drawn border.
        const spikePad = Math.max(11, 15 * dpr) + lineW * 0.5 + Math.max(2, 2 * dpr);
        const usable = Math.max(1, Math.min(P.canvas.width, P.canvas.height) - spikePad * 2);
        const scale = usable / P.ARENA_SIZE;
        return lineW / scale;
    }

    P.cornerPosition = function cornerPosition(radius, corner) {
        const inset = P.computeWallInset();
        const margin = inset + radius + 6;
        return {
            x: corner === 'upper-right' ? P.ARENA_SIZE - margin : margin,
            y: margin,
        };
    }

    /** Apply optional custom label from the matchup slot onto a spawned ball. */
    P.applyBallLabel = function applyBallLabel(slot, ball) {
        if (!ball || !slot) return ball;
        const name = typeof slot.config?.name === 'string' ? slot.config.name.trim() : '';
        if (name) ball.name = name;
        return ball;
    }

    P.makeCollisionRoster = function makeCollisionRoster() {
        const balls = [];

        P.matchupSlots.forEach((slot, i) => {
            const spec = P.PB.getPremadeBall(slot.id);
            if (!spec) return;

            const radius = P.slotRadius(slot);
            const corner = P.SPAWN_CORNERS[i] ?? P.SPAWN_CORNERS[i % P.SPAWN_CORNERS.length];
            const { x, y } = P.cornerPosition(radius, corner);
            const vel = P.randomVelocity(115 + Math.random() * 50);
            const ball = P.PB.createPremadeBall(slot.id, {
                x,
                y,
                vx: vel.vx,
                vy: vel.vy,
            }, P.spawnOverridesFor(slot));
            P.applyBallLabel(slot, ball);
            ball._slotIndex = i;
            ball.onHealthChanged();
            balls.push(ball);
        });
        return balls;
    }

    P.makeWeaponRoster = function makeWeaponRoster() {
        if (!P.SK) return [];
        const balls = [];

        P.matchupSlots.forEach((slot, i) => {
            if (!P.isWeaponSkinId(slot.id)) return;
            const skinSpec = P.isDefaultWeaponSkinId(slot.id) ? null : P.SK.getSkin(slot.id);

            const radius = P.slotRadius(slot);
            const corner = P.SPAWN_CORNERS[i] ?? P.SPAWN_CORNERS[i % P.SPAWN_CORNERS.length];
            const { x, y } = P.cornerPosition(radius, corner);
            const vel = P.randomVelocity(115 + Math.random() * 50);
            const overrides = P.spawnOverridesFor(slot);
            const health = overrides.health ?? 60;
            const themeColor = P.resolveWeaponThemeColor(overrides.color || slot.config?.color, i);
            const weaponId = P.resolveWeaponId(slot.config?.weaponId);
            const customName = typeof overrides.name === 'string' ? overrides.name.trim() : '';
            const displayName = customName
                || (P.isDefaultWeaponSkinId(slot.id) ? P.weaponDisplayName(weaponId) : skinSpec?.name)
                || 'Ball';

            const ball = new WeaponBall({
                x,
                y,
                vx: vel.vx,
                vy: vel.vy,
                radius,
                health,
                maxHealth: health,
                mass: 64,
                color: themeColor,
                name: displayName,
                skinId: P.isDefaultWeaponSkinId(slot.id) ? null : slot.id,
            });
            if (P.isNoneWeaponId(weaponId)) {
                ball.weaponKind = 'none';
                ball.weaponBehavior = window.PremadeWeaponRegistry?.NoneWeaponBehavior || null;
                ball.spinSpeed = 0;
                ball.weaponId = P.NONE_WEAPON_ID;
                ball.weaponName = 'None';
                ball.weaponIcon = null;
                ball.weaponBio = 'No weapon equipped.';
            } else {
                P.PW.applyWeaponToBall(ball, weaponId);
            }
            const PU = window.PremadePowerups;
            if (PU?.applyPowerupToBall) {
                PU.applyPowerupToBall(ball, slot.config?.powerupId);
            }
            ball.bio = ball.weaponBio || '';
            ball.displayFont = i % 2 === 0 ? 'Russo One' : 'Orbitron';
            ball._slotIndex = i;
            balls.push(ball);
        });
        return balls;
    }

    P.makeRoster = function makeRoster() {
        return P.gameMode === 'weapon' ? P.makeWeaponRoster() : P.makeCollisionRoster();
    }
}());
