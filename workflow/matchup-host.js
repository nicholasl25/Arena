/**
 * Lightweight ArenaApp-compatible matchup host for the workflow setup modal.
 * Same localStorage keys as arena/app/* so the arena picks up the saved matchup.
 * Depends: PremadeBalls, PremadeWeapons, BallSkins (optional until ready)
 */
(function () {
    'use strict';

    if (window.ArenaApp) return;

    const PB = window.PremadeBalls;
    const PW = window.PremadeWeapons;
    const SK = window.BallSkins;
    if (!PB) throw new Error('MatchupHost: missing PremadeBalls');
    if (!PW) throw new Error('MatchupHost: missing PremadeWeapons');

    const GAME_MODES = {
        collision: { id: 'collision', label: 'Ball Arena', title: 'Ball Arena' },
        weapon: { id: 'weapon', label: 'Weapon Combat', title: 'Weapon Arena' },
    };

    const MODE_STORAGE_KEY = 'arena-game-mode';
    const MATCHUP_STORAGE_KEY = 'arena-matchup-v2';
    const WEAPON_MATCHUP_STORAGE_KEY = 'arena-matchup-weapon-v2';
    const DEFAULT_WEAPON_SKIN_ID = '_weapon';
    const NONE_WEAPON_ID = 'none';

    const WEAPON_THEME_COLORS = [
        { id: 'red', hex: '#ef4444', label: 'Red' },
        { id: 'orange', hex: '#f97316', label: 'Orange' },
        { id: 'yellow', hex: '#eab308', label: 'Yellow' },
        { id: 'green', hex: '#22c55e', label: 'Green' },
        { id: 'blue', hex: '#3b82f6', label: 'Blue' },
        { id: 'purple', hex: '#a855f7', label: 'Purple' },
        { id: 'black', hex: '#000000', label: 'Black' },
    ];

    function toHealthInt(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
    }

    function loadSavedMode() {
        try {
            const raw = localStorage.getItem(MODE_STORAGE_KEY);
            if (raw && GAME_MODES[raw]) return raw;
        } catch { /* ignore */ }
        return 'collision';
    }

    function saveMode(mode) {
        try {
            localStorage.setItem(MODE_STORAGE_KEY, mode);
        } catch { /* ignore */ }
    }

    let gameMode = loadSavedMode();
    /** @type {{ id: string, config: Record<string, unknown> }[]} */
    let matchupSlots = [];

    function defaultWeaponFor() {
        return PW.DEFAULT_WEAPON;
    }

    function isDefaultWeaponSkinId(id) {
        return id === DEFAULT_WEAPON_SKIN_ID;
    }

    function isNoneWeaponId(id) {
        return id === NONE_WEAPON_ID;
    }

    function isWeaponSkinId(id) {
        return isDefaultWeaponSkinId(id) || Boolean(SK?.getSkin(id));
    }

    function resolveWeaponId(raw) {
        const id = typeof raw === 'string' ? raw : '';
        if (isNoneWeaponId(id)) return NONE_WEAPON_ID;
        return PW.getPremadeWeapon(id) ? id : defaultWeaponFor();
    }

    function defaultWeaponMatchupSlot(weaponId = defaultWeaponFor()) {
        return { id: DEFAULT_WEAPON_SKIN_ID, config: { weaponId } };
    }

    function defaultMatchupSlots() {
        if (gameMode === 'weapon') {
            const ids = SK?.isReady?.() ? SK.getDefaultMatchup() : [];
            if (ids.length >= 2) {
                return ids.map((id) => ({ id, config: { weaponId: defaultWeaponFor() } }));
            }
            return [defaultWeaponMatchupSlot(), defaultWeaponMatchupSlot()];
        }
        return PB.DEFAULT_MATCHUP.map((id) => ({ id, config: {} }));
    }

    function normalizeCollisionSlot(raw) {
        if (typeof raw === 'string') {
            return PB.getPremadeBall(raw) ? { id: raw, config: {} } : null;
        }
        if (!raw || typeof raw.id !== 'string' || !PB.getPremadeBall(raw.id)) return null;
        return { id: raw.id, config: { ...(raw.config || {}) } };
    }

    function normalizeWeaponSlot(raw) {
        if (typeof raw === 'string') {
            return isWeaponSkinId(raw) ? { id: raw, config: { weaponId: defaultWeaponFor() } } : null;
        }
        if (!raw || typeof raw.id !== 'string' || !isWeaponSkinId(raw.id)) return null;
        const config = { ...(raw.config || {}) };
        config.weaponId = resolveWeaponId(config.weaponId);
        return { id: raw.id, config };
    }

    function loadSavedMatchup() {
        try {
            const key = gameMode === 'weapon' ? WEAPON_MATCHUP_STORAGE_KEY : MATCHUP_STORAGE_KEY;
            const normalize = gameMode === 'weapon' ? normalizeWeaponSlot : normalizeCollisionSlot;
            const data = JSON.parse(localStorage.getItem(key) || 'null');
            if (!Array.isArray(data)) return null;
            const slots = data.map(normalize).filter(Boolean);
            if (slots.length >= 2) return slots;
        } catch { /* ignore */ }
        return null;
    }

    function saveMatchup(slots) {
        try {
            const key = gameMode === 'weapon' ? WEAPON_MATCHUP_STORAGE_KEY : MATCHUP_STORAGE_KEY;
            localStorage.setItem(key, JSON.stringify(slots));
        } catch { /* ignore */ }
    }

    function repairWeaponMatchup() {
        if (gameMode !== 'weapon') return;
        const valid = matchupSlots.filter((slot) => isWeaponSkinId(slot.id));
        if (valid.length >= 2) {
            matchupSlots = valid;
            return;
        }
        const ids = SK?.isReady?.() ? SK.getDefaultMatchup() : [];
        if (ids.length >= 2) {
            matchupSlots = ids.map((id) => ({ id, config: { weaponId: defaultWeaponFor() } }));
            return;
        }
        matchupSlots = [defaultWeaponMatchupSlot(), defaultWeaponMatchupSlot()];
    }

    function isWeaponThemeColor(hex) {
        if (typeof hex !== 'string') return false;
        const normalized = hex.toLowerCase();
        return WEAPON_THEME_COLORS.some((c) => c.hex === normalized);
    }

    function weaponThemeColorForIndex(index) {
        const i = ((index % WEAPON_THEME_COLORS.length) + WEAPON_THEME_COLORS.length) % WEAPON_THEME_COLORS.length;
        return WEAPON_THEME_COLORS[i].hex;
    }

    function resolveWeaponThemeColor(color, slotIndex = 0) {
        if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
            return color.toLowerCase();
        }
        return weaponThemeColorForIndex(slotIndex);
    }

    function defaultHealthFor(id) {
        if (gameMode === 'weapon') return 60;
        return PB.getPremadeBall(id)?.health ?? 100;
    }

    function defaultMassFor(id) {
        if (gameMode === 'weapon') return 64;
        return PB.getPremadeBall(id)?.mass ?? 64;
    }

    function defaultRadiusFor(id) {
        if (gameMode === 'weapon') return 40;
        return PB.getPremadeBall(id)?.radius ?? 45;
    }

    function defaultColorFor(id, slotIndex = 0) {
        if (gameMode === 'weapon') return weaponThemeColorForIndex(slotIndex);
        return PB.getPremadeBall(id)?.color ?? '#888888';
    }

    function defaultNameFor(id) {
        if (gameMode === 'weapon') {
            if (isDefaultWeaponSkinId(id)) return 'Weapon';
            return SK?.getSkin(id)?.name ?? 'Ball';
        }
        return PB.getPremadeBall(id)?.name ?? 'Ball';
    }

    function weaponDisplayName(weaponId) {
        if (isNoneWeaponId(weaponId)) return 'None';
        return PW.getPremadeWeapon(weaponId)?.name ?? 'Weapon';
    }

    function normalizeCollisionMatchupInput(input) {
        if (!Array.isArray(input) || input.length < 2) {
            throw new Error('ArenaApp.setMatchup: need at least 2 fighters');
        }
        return input.map((entry) => {
            if (typeof entry === 'string') {
                if (!PB.getPremadeBall(entry)) {
                    throw new Error(`ArenaApp.setMatchup: unknown fighter "${entry}"`);
                }
                return { id: entry, config: {} };
            }
            if (!entry || typeof entry.id !== 'string') {
                throw new Error('ArenaApp.setMatchup: each entry needs an id');
            }
            if (!PB.getPremadeBall(entry.id)) {
                throw new Error(`ArenaApp.setMatchup: unknown fighter "${entry.id}"`);
            }
            const config = { ...(entry.config || {}) };
            if (config.health != null) {
                const health = Number(config.health);
                if (!Number.isFinite(health) || health < 1) {
                    throw new Error(`ArenaApp.setMatchup: invalid health for "${entry.id}"`);
                }
                config.health = toHealthInt(health);
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

    function normalizeWeaponMatchupInput(input) {
        if (!SK) throw new Error('ArenaApp.setMatchup: weapon mode requires BallSkins');
        if (!Array.isArray(input) || input.length < 2) {
            throw new Error('ArenaApp.setMatchup: need at least 2 fighters');
        }
        return input.map((entry) => {
            if (typeof entry === 'string') {
                if (!isWeaponSkinId(entry)) {
                    throw new Error(`ArenaApp.setMatchup: unknown skin "${entry}"`);
                }
                return { id: entry, config: { weaponId: defaultWeaponFor() } };
            }
            if (!entry || typeof entry.id !== 'string') {
                throw new Error('ArenaApp.setMatchup: each entry needs an id');
            }
            if (!isWeaponSkinId(entry.id)) {
                throw new Error(`ArenaApp.setMatchup: unknown skin "${entry.id}"`);
            }
            const config = { ...(entry.config || {}) };
            if (config.health != null) {
                const health = Number(config.health);
                if (!Number.isFinite(health) || health < 1) {
                    throw new Error(`ArenaApp.setMatchup: invalid health for "${entry.id}"`);
                }
                config.health = toHealthInt(health);
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
                if (!isNoneWeaponId(config.weaponId) && !PW.getPremadeWeapon(config.weaponId)) {
                    throw new Error(`ArenaApp.setMatchup: unknown weapon "${config.weaponId}"`);
                }
            } else {
                config.weaponId = defaultWeaponFor();
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

    function setMatchup(input, { persist = true } = {}) {
        matchupSlots = gameMode === 'weapon'
            ? normalizeWeaponMatchupInput(input)
            : normalizeCollisionMatchupInput(input);
        if (persist) saveMatchup(matchupSlots);
    }

    function setGameMode(mode, { persist = true } = {}) {
        if (!GAME_MODES[mode] || mode === gameMode) return;
        gameMode = mode;
        if (persist) saveMode(mode);
        matchupSlots = loadSavedMatchup() || defaultMatchupSlots();
        repairWeaponMatchup();
        window.dispatchEvent(new CustomEvent('arena-mode-changed', { detail: { mode } }));
    }

    async function boot() {
        if (SK?.init) await SK.init();
        matchupSlots = loadSavedMatchup() || defaultMatchupSlots();
        repairWeaponMatchup();
        if (matchupSlots.length < 2) {
            matchupSlots = defaultMatchupSlots();
        }
        if (matchupSlots.length < 2 && gameMode === 'weapon') {
            gameMode = 'collision';
            saveMode(gameMode);
            matchupSlots = defaultMatchupSlots();
        }
    }

    const bootPromise = boot().then(() => {
        window.dispatchEvent(new CustomEvent('arena-ready'));
    });

    window.ArenaApp = {
        whenReady() {
            return bootPromise;
        },
        getGameMode() {
            return gameMode;
        },
        setGameMode,
        getMatchup() {
            return matchupSlots.map((slot) => ({
                id: slot.id,
                config: { ...slot.config },
            }));
        },
        setMatchup,
        defaultHealthFor,
        defaultMassFor,
        defaultRadiusFor,
        defaultColorFor,
        defaultNameFor,
        listWeaponThemeColors() {
            return WEAPON_THEME_COLORS.map((c) => ({ ...c }));
        },
        resolveWeaponThemeColor,
        listFighters() {
            if (gameMode === 'weapon' && SK) {
                const skins = SK.listSkinIds().map((id) => {
                    const spec = SK.getSkin(id);
                    if (!spec) return null;
                    return {
                        id,
                        name: spec.name,
                        color: spec.color,
                        bio: '',
                        defaultHealth: 60,
                        defaultMass: 64,
                        defaultRadius: 40,
                    };
                }).filter(Boolean);
                return [
                    {
                        id: DEFAULT_WEAPON_SKIN_ID,
                        name: 'Default (weapon name)',
                        color: '#888888',
                        bio: 'Uses the equipped weapon name as the ball label.',
                        defaultHealth: 60,
                        defaultMass: 64,
                        defaultRadius: 40,
                    },
                    ...skins,
                ];
            }
            return Object.entries(PB.PREMADE_BALLS).map(([id, spec]) => ({
                id,
                name: spec.name,
                color: spec.color,
                bio: spec.bio,
                defaultHealth: spec.health,
                defaultMass: spec.mass,
                defaultRadius: spec.radius,
            }));
        },
        listWeapons() {
            const weapons = Object.entries(PW.PREMADE_WEAPONS).map(([id, spec]) => ({
                id,
                name: spec.name,
                bio: spec.bio,
                weaponDamage: spec.weaponDamage,
                spinSpeed: spec.spinSpeed,
                swordLength: spec.swordLength,
                knockbackScale: spec.knockbackScale,
            }));
            return [
                {
                    id: NONE_WEAPON_ID,
                    name: 'None',
                    bio: 'No weapon equipped.',
                    weaponDamage: 0,
                    spinSpeed: 0,
                    swordLength: 0,
                    knockbackScale: 0,
                },
                ...weapons,
            ];
        },
        listPowerups() {
            return window.PremadePowerups?.listPowerups?.() || [];
        },
        defaultWeaponSkinId() {
            return DEFAULT_WEAPON_SKIN_ID;
        },
        noneWeaponId() {
            return NONE_WEAPON_ID;
        },
        weaponDisplayName,
        defaultWeaponFor,
        listModes() {
            return Object.values(GAME_MODES);
        },
        async refreshSkins() {
            if (!SK?.init) return;
            await SK.init();
            repairWeaponMatchup();
            window.dispatchEvent(new CustomEvent('arena-mode-changed', { detail: { mode: gameMode } }));
        },
    };
}());
