/**
 * ArenaApp — load/save matchup, slot normalize, weapon/collision defaults.
 */
(function () {
    'use strict';
    const P = (window.ArenaAppParts = window.ArenaAppParts || {});

    P.loadTournamentArenaState = function loadTournamentArenaState() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('from') !== 'workflow-long') return null;
            const data = JSON.parse(localStorage.getItem(P.TOURNAMENT_ARENA_STORAGE_KEY) || 'null');
            if (!data || !Array.isArray(data.matchup) || data.matchup.length < 2) return null;
            return data;
        } catch {
            return null;
        }
    }

    P.loadSavedMode = function loadSavedMode() {
        try {
            const raw = localStorage.getItem(P.MODE_STORAGE_KEY);
            if (raw && P.GAME_MODES[raw]) return raw;
        } catch {
            /* ignore */
        }
        return 'collision';
    }

    P.saveMode = function saveMode(mode) {
        try {
            localStorage.setItem(P.MODE_STORAGE_KEY, mode);
        } catch {
            /* ignore */
        }
    }

    P.defaultWeaponMatchupSlot = function defaultWeaponMatchupSlot(weaponId = P.defaultWeaponFor()) {
        return { id: P.DEFAULT_WEAPON_SKIN_ID, config: { weaponId } };
    }

    P.defaultMatchupSlots = function defaultMatchupSlots() {
        if (P.gameMode === 'weapon') {
            const ids = P.SK?.isReady?.() ? P.SK.getDefaultMatchup() : [];
            if (ids.length >= 2) {
                return ids.map((id) => ({ id, config: { weaponId: P.defaultWeaponFor() } }));
            }
            return [P.defaultWeaponMatchupSlot(), P.defaultWeaponMatchupSlot()];
        }
        return P.PB.DEFAULT_MATCHUP.map((id) => ({ id, config: {} }));
    }

    P.repairWeaponMatchup = function repairWeaponMatchup() {
        if (P.gameMode !== 'weapon') return;
        const valid = P.matchupSlots.filter((slot) => P.isWeaponSkinId(slot.id));
        if (valid.length >= 2) {
            P.matchupSlots = valid;
            return;
        }
        const ids = P.SK?.isReady?.() ? P.SK.getDefaultMatchup() : [];
        if (ids.length >= 2) {
            P.matchupSlots = ids.map((id) => ({ id, config: { weaponId: P.defaultWeaponFor() } }));
            return;
        }
        P.matchupSlots = [P.defaultWeaponMatchupSlot(), P.defaultWeaponMatchupSlot()];
    }

    P.normalizeCollisionSlot = function normalizeCollisionSlot(raw) {
        if (typeof raw === 'string') {
            return P.PB.getPremadeBall(raw) ? { id: raw, config: {} } : null;
        }
        if (!raw || typeof raw.id !== 'string' || !P.PB.getPremadeBall(raw.id)) return null;
        return { id: raw.id, config: { ...(raw.config || {}) } };
    }

    P.defaultWeaponFor = function defaultWeaponFor() {
        return P.PW.DEFAULT_WEAPON;
    }

    P.isDefaultWeaponSkinId = function isDefaultWeaponSkinId(id) {
        return id === P.DEFAULT_WEAPON_SKIN_ID;
    }

    P.isNoneWeaponId = function isNoneWeaponId(id) {
        return id === P.NONE_WEAPON_ID;
    }

    P.isWeaponSkinId = function isWeaponSkinId(id) {
        return P.isDefaultWeaponSkinId(id) || Boolean(P.SK?.getSkin(id));
    }

    P.resolveWeaponId = function resolveWeaponId(raw) {
        const id = typeof raw === 'string' ? raw : '';
        if (P.isNoneWeaponId(id)) return P.NONE_WEAPON_ID;
        return P.PW.getPremadeWeapon(id) ? id : P.defaultWeaponFor();
    }

    P.normalizeWeaponSlot = function normalizeWeaponSlot(raw) {
        if (!P.SK) return null;
        if (typeof raw === 'string') {
            return P.isWeaponSkinId(raw) ? { id: raw, config: { weaponId: P.defaultWeaponFor() } } : null;
        }
        if (!raw || typeof raw.id !== 'string' || !P.isWeaponSkinId(raw.id)) return null;
        const config = { ...(raw.config || {}) };
        config.weaponId = P.resolveWeaponId(config.weaponId);
        return { id: raw.id, config };
    }

    P.loadSavedMatchup = function loadSavedMatchup() {
        try {
            const tournamentMatchup = P.tournamentArenaState?.matchup;
            if (Array.isArray(tournamentMatchup) && tournamentMatchup.length >= 2) {
                const normalize = P.gameMode === 'weapon' ? P.normalizeWeaponSlot : P.normalizeCollisionSlot;
                const slots = tournamentMatchup.map(normalize).filter(Boolean);
                if (slots.length >= 2) return slots;
            }
            const key = P.gameMode === 'weapon' ? P.WEAPON_MATCHUP_STORAGE_KEY : P.MATCHUP_STORAGE_KEY;
            const normalize = P.gameMode === 'weapon' ? P.normalizeWeaponSlot : P.normalizeCollisionSlot;
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!Array.isArray(data) || data.length < 2) return null;
            const slots = data.map(normalize).filter(Boolean);
            if (slots.length >= 2) return slots;
            return null;
        } catch {
            return null;
        }
    }

    P.saveMatchup = function saveMatchup(slots) {
        try {
            const key = P.gameMode === 'weapon' ? P.WEAPON_MATCHUP_STORAGE_KEY : P.MATCHUP_STORAGE_KEY;
            localStorage.setItem(key, JSON.stringify(slots));
        } catch {
            /* ignore quota / private mode */
        }
    }

    P.isWeaponThemeColor = function isWeaponThemeColor(hex) {
        if (typeof hex !== 'string') return false;
        const normalized = hex.toLowerCase();
        return P.WEAPON_THEME_COLORS.some((c) => c.hex === normalized);
    }

    P.weaponThemeColorForIndex = function weaponThemeColorForIndex(index) {
        const i = ((index % P.WEAPON_THEME_COLORS.length) + P.WEAPON_THEME_COLORS.length) % P.WEAPON_THEME_COLORS.length;
        return P.WEAPON_THEME_COLORS[i].hex;
    }

    P.resolveWeaponThemeColor = function resolveWeaponThemeColor(color, slotIndex = 0) {
        // Keep any real hex (tournament roster colors). Only fall back to the
        // theme wheel when the slot has no usable color.
        if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
            return color.toLowerCase();
        }
        return P.weaponThemeColorForIndex(slotIndex);
    }

    P.defaultHealthFor = function defaultHealthFor(id) {
        if (P.gameMode === 'weapon') return 60;
        return P.PB.getPremadeBall(id)?.health ?? 100;
    }

    P.defaultMassFor = function defaultMassFor(id) {
        if (P.gameMode === 'weapon') return 64;
        return P.PB.getPremadeBall(id)?.mass ?? 64;
    }

    P.defaultRadiusFor = function defaultRadiusFor(id) {
        if (P.gameMode === 'weapon') return 40;
        return P.PB.getPremadeBall(id)?.radius ?? 45;
    }

    P.defaultColorFor = function defaultColorFor(id, slotIndex = 0) {
        if (P.gameMode === 'weapon') return P.weaponThemeColorForIndex(slotIndex);
        return P.PB.getPremadeBall(id)?.color ?? '#888888';
    }

    P.defaultNameFor = function defaultNameFor(id) {
        if (P.gameMode === 'weapon') {
            if (P.isDefaultWeaponSkinId(id)) return 'Weapon';
            return P.SK?.getSkin(id)?.name ?? 'Ball';
        }
        return P.PB.getPremadeBall(id)?.name ?? 'Ball';
    }

    P.weaponDisplayName = function weaponDisplayName(weaponId) {
        if (P.isNoneWeaponId(weaponId)) return 'None';
        return P.PW.getPremadeWeapon(weaponId)?.name ?? 'Weapon';
    }

    P.slotRadius = function slotRadius(slot) {
        const radius = Number(slot.config?.radius);
        if (Number.isFinite(radius) && radius > 0) return radius;
        return P.defaultRadiusFor(slot.id);
    }

    P.spawnOverridesFor = function spawnOverridesFor(slot) {
        const overrides = {};

        const health = Number(slot.config?.health);
        if (Number.isFinite(health) && health >= 1) {
            overrides.health = health;
            overrides.maxHealth = health;
        }

        if (P.gameMode === 'weapon') {
            const radius = Number(slot.config?.radius);
            if (Number.isFinite(radius) && radius > 0) {
                overrides.radius = radius;
            }
            const color = slot.config?.color;
            if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
                overrides.color = color.toLowerCase();
            }
            const name = typeof slot.config?.name === 'string' ? slot.config.name.trim() : '';
            if (name) overrides.name = name;
            return overrides;
        }

        const spec = P.PB.getPremadeBall(slot.id);
        if (!spec) return overrides;

        const mass = Number(slot.config?.mass);
        if (Number.isFinite(mass) && mass > 0) {
            overrides.mass = mass;
        }

        const radius = Number(slot.config?.radius);
        if (Number.isFinite(radius) && radius > 0) {
            overrides.radius = radius;
            overrides.baseRadius = radius;
        }

        const color = slot.config?.color;
        if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
            overrides.color = color;
        }

        const name = typeof slot.config?.name === 'string' ? slot.config.name.trim() : '';
        if (name) {
            overrides.name = name;
        }

        return overrides;
    }

    P.normalizeCollisionMatchupInput = function normalizeCollisionMatchupInput(input) {
        if (!Array.isArray(input) || input.length < 2) {
            throw new Error('ArenaApp.setMatchup: need at least 2 fighters');
        }
        return input.map((entry) => {
            if (typeof entry === 'string') {
                if (!P.PB.getPremadeBall(entry)) {
                    throw new Error(`ArenaApp.setMatchup: unknown fighter "${entry}"`);
                }
                return { id: entry, config: {} };
            }
            if (!entry || typeof entry.id !== 'string') {
                throw new Error('ArenaApp.setMatchup: each entry needs an id');
            }
            if (!P.PB.getPremadeBall(entry.id)) {
                throw new Error(`ArenaApp.setMatchup: unknown fighter "${entry.id}"`);
            }
            const config = { ...(entry.config || {}) };
            if (config.health != null) {
                const health = Number(config.health);
                if (!Number.isFinite(health) || health < 1) {
                    throw new Error(`ArenaApp.setMatchup: invalid health for "${entry.id}"`);
                }
                config.health = Ball.toHealthInt(health);
            }
            if (config.mass != null) {
                const mass = Number(config.mass);
                if (!Number.isFinite(mass) || mass <= 0) {
                    throw new Error(`ArenaApp.setMatchup: invalid mass for "${entry.id}"`);
                }
                config.mass = mass;
            }
            if (config.radius != null) {
                const radius = Number(config.radius);
                if (!Number.isFinite(radius) || radius <= 0) {
                    throw new Error(`ArenaApp.setMatchup: invalid radius for "${entry.id}"`);
                }
                config.radius = radius;
            }
            if (config.color != null) {
                if (typeof config.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(config.color)) {
                    throw new Error(`ArenaApp.setMatchup: invalid color for "${entry.id}"`);
                }
            }
            if (config.name != null) {
                if (typeof config.name !== 'string') {
                    throw new Error(`ArenaApp.setMatchup: invalid name for "${entry.id}"`);
                }
                config.name = config.name.trim();
                if (!config.name) delete config.name;
            }
            return { id: entry.id, config };
        });
    }

    P.normalizeWeaponMatchupInput = function normalizeWeaponMatchupInput(input) {
        if (!P.SK) throw new Error('ArenaApp.setMatchup: weapon mode requires BallSkins');
        if (!Array.isArray(input) || input.length < 2) {
            throw new Error('ArenaApp.setMatchup: need at least 2 fighters');
        }
        return input.map((entry) => {
            if (typeof entry === 'string') {
                if (!P.isWeaponSkinId(entry)) {
                    throw new Error(`ArenaApp.setMatchup: unknown skin "${entry}"`);
                }
                return { id: entry, config: { weaponId: P.defaultWeaponFor() } };
            }
            if (!entry || typeof entry.id !== 'string') {
                throw new Error('ArenaApp.setMatchup: each entry needs an id');
            }
            if (!P.isWeaponSkinId(entry.id)) {
                throw new Error(`ArenaApp.setMatchup: unknown skin "${entry.id}"`);
            }
            const config = { ...(entry.config || {}) };
            if (config.health != null) {
                const health = Number(config.health);
                if (!Number.isFinite(health) || health < 1) {
                    throw new Error(`ArenaApp.setMatchup: invalid health for "${entry.id}"`);
                }
                config.health = Ball.toHealthInt(health);
            }
            if (config.radius != null) {
                const radius = Number(config.radius);
                if (!Number.isFinite(radius) || radius <= 0) {
                    throw new Error(`ArenaApp.setMatchup: invalid radius for "${entry.id}"`);
                }
                config.radius = radius;
            }
            if (config.color != null) {
                if (typeof config.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(config.color)) {
                    throw new Error(`ArenaApp.setMatchup: invalid color for "${entry.id}"`);
                }
                config.color = config.color.toLowerCase();
            }
            if (config.name != null) {
                if (typeof config.name !== 'string') {
                    throw new Error(`ArenaApp.setMatchup: invalid name for "${entry.id}"`);
                }
                config.name = config.name.trim();
                if (!config.name) delete config.name;
            }
            if (config.weaponId != null) {
                if (!P.isNoneWeaponId(config.weaponId) && !P.PW.getPremadeWeapon(config.weaponId)) {
                    throw new Error(`ArenaApp.setMatchup: unknown weapon "${config.weaponId}"`);
                }
            } else {
                config.weaponId = P.defaultWeaponFor();
            }
            if (config.powerupId != null && config.powerupId !== '') {
                const PU = window.PremadePowerups;
                if (!PU?.getPremadePowerup?.(config.powerupId)) {
                    throw new Error(`ArenaApp.setMatchup: unknown powerup "${config.powerupId}"`);
                }
            } else {
                delete config.powerupId;
            }
            return { id: entry.id, config };
        });
    }

    P.setMatchup = function setMatchup(input, { persist = true } = {}) {
        P.matchupSlots = P.gameMode === 'weapon'
            ? P.normalizeWeaponMatchupInput(input)
            : P.normalizeCollisionMatchupInput(input);
        if (persist) P.saveMatchup(P.matchupSlots);
        P.reset();
    }

    P.setGameMode = function setGameMode(mode, { persist = true } = {}) {
        if (!P.GAME_MODES[mode] || mode === P.gameMode) return;
        P.gameMode = mode;
        if (persist) P.saveMode(mode);
        P.matchupSlots = P.loadSavedMatchup() || P.defaultMatchupSlots();
        P.repairWeaponMatchup();
        P.reset();
        window.dispatchEvent(new CustomEvent('arena-mode-changed', { detail: { mode } }));
    }
}());
