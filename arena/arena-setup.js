/**
 * Desktop match setup panel — pick fighters and per-slot config without editing code.
 * Depends: ArenaApp (arena/app/*), hidden on phone layout via CSS.
 */
(function () {
    'use strict';

    const MIN_FIGHTERS = 2;
    const MAX_FIGHTERS = 6;
    /** Fixed optional entrant slots for Long YouTube tournament setup. */
    const LONG_GRID_SIZE = 32;
    const EMPTY_WEAPON_ID = '';
    /** Long workflow roster — must stay disjoint from arena-matchup-* (Shorts). */
    const TOURNAMENT_ROSTER_STORAGE_KEY = 'workflow-tournament-roster-v1';
    const TOURNAMENT_OPTIONS_STORAGE_KEY = 'workflow-tournament-options-v1';
    const EMPTY_POWERUP_ID = '';
    const DEFAULT_TOURNAMENT_OPTIONS = { powerupSpin: true };

    const STAT_FIELDS_COLLISION = [
        { key: 'health', label: 'Health', min: 1, step: 1 },
        { key: 'mass', label: 'Mass', min: 0.1, step: 1 },
        { key: 'radius', label: 'Radius', min: 0.1, step: 1 },
    ];

    const STAT_FIELDS_WEAPON = [
        { key: 'health', label: 'Health', min: 1, step: 1 },
        { key: 'radius', label: 'Radius', min: 0.1, step: 1 },
    ];

    const slotsEl = document.getElementById('setup-slots');
    const allStatsEl = document.getElementById('setup-all-stats');
    const addBtn = document.getElementById('btn-add-fighter');
    const startBtn = document.getElementById('btn-start-fight');
    const panel = document.getElementById('setup-panel');
    const modeToggleEl = document.getElementById('setup-mode-toggle');
    const panelEyebrow = document.querySelector('.setup-panel-eyebrow');
    const panelHint = document.querySelector('.setup-panel-hint');
    const saveBtn = document.getElementById('btn-save-matchup');

    if (!slotsEl || !panel) return;

    const panelTitle = panel.querySelector('.wf-modal-title, .setup-panel-title');

    function isLongWorkflow() {
        return document.body?.dataset?.workflow === 'long';
    }

    let fighters = [];
    let weapons = [];
    let gameMode = 'collision';
    /** @type {{ id: string, config: { health?: number, mass?: number, radius?: number, weaponId?: string } }[]} */
    let slots = [];
    const openDetails = new Set();
    /** Per-slot skin folder pick (weapon mode). Empty until the user chooses a folder. */
    const slotSkinFolders = new Map();

    function waitForArenaApp(cb) {
        function run(app) {
            const ready = app.whenReady?.();
            if (ready && typeof ready.then === 'function') {
                ready.then(() => cb(app));
                return;
            }
            cb(app);
        }
        if (window.ArenaApp) {
            run(window.ArenaApp);
            return;
        }
        const timer = setInterval(() => {
            if (window.ArenaApp) {
                clearInterval(timer);
                run(window.ArenaApp);
            }
        }, 16);
    }

    function isWeaponMode() {
        return gameMode === 'weapon';
    }

    function statFields() {
        return isWeaponMode() ? STAT_FIELDS_WEAPON : STAT_FIELDS_COLLISION;
    }

    function slotLabel() {
        return isWeaponMode() ? 'Skin' : 'Fighter';
    }

    function updateModeChrome() {
        const long = isLongWorkflow();
        if (panelEyebrow) {
            panelEyebrow.textContent = long
                ? 'Long YouTube'
                : (isWeaponMode() ? 'Weapon Arena' : 'Ball Arena');
        }
        if (panelTitle) {
            panelTitle.textContent = long ? 'Tournament setup' : 'Match setup';
        }
        if (panelHint) {
            panelHint.textContent = long
                ? 'Fill entrant slots with a weapon and optional skin. Empty slots are ignored. Save builds the bracket.'
                : (isWeaponMode()
                    ? 'Pick skins, weapons, and tune stats, then start the sword fight.'
                    : 'Pick fighters and tune stats, then start the fight.');
        }
        if (modeToggleEl) modeToggleEl.hidden = long;
        if (addBtn) addBtn.hidden = long;
        if (saveBtn) saveBtn.textContent = long ? 'Save tournament' : 'Save matchup';
        panel.classList.toggle('is-long-tournament', long);
    }

    function renderModeToggle() {
        if (!modeToggleEl || !window.ArenaApp?.listModes) return;
        if (isLongWorkflow()) {
            modeToggleEl.innerHTML = '';
            modeToggleEl.hidden = true;
            return;
        }
        modeToggleEl.hidden = false;
        const modes = window.ArenaApp.listModes();
        const current = window.ArenaApp.getGameMode();
        modeToggleEl.innerHTML = modes.map((m) => `
            <button
                type="button"
                class="setup-mode-btn${m.id === current ? ' is-active' : ''}"
                data-mode="${m.id}"
            >${m.label}</button>
        `).join('');
        modeToggleEl.querySelectorAll('.setup-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (mode && mode !== gameMode) {
                    window.ArenaApp.setGameMode(mode);
                }
            });
        });
    }

    function makeEmptyLongSlot(slotIndex = 0) {
        const id = defaultSkinId();
        return {
            id,
            empty: true,
            config: {
                ...defaultConfig(id, slotIndex),
                weaponId: EMPTY_WEAPON_ID,
            },
        };
    }

    function hydrateSlot(slot, i) {
        return {
            id: slot.id,
            empty: false,
            config: {
                health: slot.config?.health ?? defaultFor(slot.id, 'health', i),
                mass: slot.config?.mass ?? defaultFor(slot.id, 'mass', i),
                radius: slot.config?.radius ?? defaultFor(slot.id, 'radius', i),
                weaponId: slotWeaponId(slot),
                powerupId: slotPowerupId(slot),
                name: slot.config?.name ?? '',
                color: resolveSlotColor(slot, i),
            },
        };
    }

    function expandLongSlots(matchup) {
        const filled = (Array.isArray(matchup) ? matchup : [])
            .slice(0, LONG_GRID_SIZE)
            .map((slot, i) => hydrateSlot(slot, i));
        while (filled.length < LONG_GRID_SIZE) {
            filled.push(makeEmptyLongSlot(filled.length));
        }
        return filled;
    }

    function loadTournamentRoster() {
        try {
            const raw = localStorage.getItem(TOURNAMENT_ROSTER_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (!Array.isArray(parsed) || parsed.length < 2) return null;
            return parsed.map((slot) => ({
                id: slot.id,
                config: { ...(slot.config || {}) },
            }));
        } catch {
            return null;
        }
    }

    function loadTournamentOptions() {
        try {
            const raw = localStorage.getItem(TOURNAMENT_OPTIONS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_TOURNAMENT_OPTIONS };
            return {
                powerupSpin: parsed.powerupSpin !== false,
            };
        } catch {
            return { ...DEFAULT_TOURNAMENT_OPTIONS };
        }
    }

    function saveTournamentOptions(next) {
        const options = {
            powerupSpin: next?.powerupSpin !== false,
        };
        localStorage.setItem(TOURNAMENT_OPTIONS_STORAGE_KEY, JSON.stringify(options));
        return options;
    }

    function getTournamentOptions() {
        return loadTournamentOptions();
    }

    function syncFromArena() {
        if (!window.ArenaApp) return;
        const long = isLongWorkflow();
        if (long && window.ArenaApp.getGameMode() !== 'weapon') {
            window.ArenaApp.setGameMode('weapon', { persist: false });
            return;
        }
        gameMode = long ? 'weapon' : window.ArenaApp.getGameMode();
        fighters = window.ArenaApp.listFighters();
        weapons = window.ArenaApp.listWeapons?.() || [];
        // Long setup reads only the tournament roster — never Shorts / live Arena matchup.
        slots = long
            ? expandLongSlots(loadTournamentRoster() || [])
            : window.ArenaApp.getMatchup().map((slot, i) => hydrateSlot(slot, i));
        updateModeChrome();
        renderModeToggle();
        renderSlots();
    }

    function fighterMeta(id) {
        return fighters.find((x) => x.id === id) || null;
    }

    function weaponMeta(id) {
        return weapons.find((x) => x.id === id) || null;
    }

    function defaultWeaponId() {
        return window.ArenaApp?.defaultWeaponFor?.() || weapons.find((w) => w.id !== 'none')?.id || weapons[0]?.id || 'sword';
    }

    function slotWeaponId(slot) {
        const id = slot.config?.weaponId;
        if (id === EMPTY_WEAPON_ID) return EMPTY_WEAPON_ID;
        if (id === 'none') return 'none';
        if (typeof id === 'string' && weaponMeta(id)) return id;
        if (isLongWorkflow() && slot.empty) return EMPTY_WEAPON_ID;
        return defaultWeaponId();
    }

    function slotPowerupId(slot) {
        const id = slot.config?.powerupId;
        if (!id || id === EMPTY_POWERUP_ID) return EMPTY_POWERUP_ID;
        if (typeof id === 'string' && window.PremadePowerups?.getPremadePowerup?.(id)) return id;
        return EMPTY_POWERUP_ID;
    }

    function powerupOptions() {
        const listed = window.ArenaApp?.listPowerups?.() || window.PremadePowerups?.listPowerups?.() || [];
        return [
            { id: EMPTY_POWERUP_ID, name: 'No powerup', searchText: 'none empty clear powerup' },
            ...listed.map((p) => ({
                id: p.id,
                name: p.name,
                searchText: `${p.name} ${p.id} ${p.bio || ''}`,
            })),
        ];
    }

    function longWeaponOptions() {
        return [
            { id: EMPTY_WEAPON_ID, name: '— Empty slot —', searchText: 'empty slot none clear' },
            ...weapons
                .filter((w) => w.id !== 'none')
                .map((w) => ({
                    id: w.id,
                    name: w.name,
                    searchText: `${w.name} ${w.id} ${w.bio || ''}`,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        ];
    }

    function longSkinOptions(folder) {
        const none = {
            id: defaultSkinId(),
            name: 'No skin (use weapon name)',
            searchText: 'no skin default weapon',
        };
        if (!folder) return [none];
        return [
            none,
            ...fighters
                .filter((f) => f.id !== defaultSkinId() && (f.category || 'Other') === folder)
                .map((f) => ({
                    id: f.id,
                    name: f.name,
                    searchText: `${f.name} ${f.id} ${f.category || ''}`,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        ];
    }

    function skinFolderOptions() {
        const cats = window.BallSkins?.listCategories?.()
            || [...new Set(fighters.map((f) => f.category).filter(Boolean))].sort(
                (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
            );
        return [
            { id: '', name: 'Choose folder…', searchText: 'choose folder' },
            ...cats.map((cat) => ({
                id: cat,
                name: cat,
                searchText: cat,
            })),
        ];
    }

    function skinCategoryForId(skinId) {
        if (!skinId || skinId === defaultSkinId()) return '';
        return window.BallSkins?.getSkin?.(skinId)?.category
            || fighters.find((f) => f.id === skinId)?.category
            || '';
    }

    function folderForSlot(idx) {
        if (slotSkinFolders.has(idx)) return slotSkinFolders.get(idx) || '';
        return skinCategoryForId(slots[idx]?.id);
    }

    function setFolderForSlot(idx, folder) {
        const next = typeof folder === 'string' ? folder : '';
        if (next) slotSkinFolders.set(idx, next);
        else slotSkinFolders.delete(idx);
    }

    function applySkinFolderChange(idx, folder) {
        setFolderForSlot(idx, folder);
        const skinId = slots[idx]?.id;
        if (skinId && skinId !== defaultSkinId() && skinCategoryForId(skinId) !== folder) {
            const weaponId = slotWeaponId(slots[idx]);
            const prevColor = slots[idx].config?.color;
            const prevName = slots[idx].config?.name;
            const prevPowerup = slots[idx].config?.powerupId;
            slots[idx] = makeSlot(defaultSkinId(), idx);
            if (isWeaponMode()) {
                slots[idx].empty = false;
                slots[idx].config.weaponId = weaponId;
            }
            if (prevColor) slots[idx].config.color = prevColor;
            if (prevName) slots[idx].config.name = prevName;
            if (prevPowerup) slots[idx].config.powerupId = prevPowerup;
        }
        renderSlots();
    }

    function resolveLongSkinId(id) {
        const skinId = typeof id === 'string' && id ? id : defaultSkinId();
        if (skinId === defaultSkinId()) return defaultSkinId();
        if (fighterMeta(skinId) || window.BallSkins?.getSkin?.(skinId)) return skinId;
        return null;
    }

    function validateLongSlots() {
        const errors = [];
        const filled = [];
        slots.forEach((slot, i) => {
            const label = `Entrant ${i + 1}`;
            const weaponId = slot.config?.weaponId;
            const hasWeapon = typeof weaponId === 'string' && weaponId.length > 0 && weaponId !== 'none';
            if (!hasWeapon) return;

            if (!weaponMeta(weaponId)) {
                errors.push(`${label}: unknown weapon "${weaponId}"`);
                return;
            }
            const skinId = resolveLongSkinId(slot.id);
            if (!skinId) {
                errors.push(`${label}: unknown skin "${slot.id}"`);
                return;
            }
            filled.push({
                id: skinId,
                config: buildSlotPayload({ ...slot, id: skinId, empty: false }, i),
            });
        });

        if (filled.length < MIN_FIGHTERS) {
            errors.push(`Need at least ${MIN_FIGHTERS} entrants with a weapon selected.`);
        }
        if (filled.length > LONG_GRID_SIZE) {
            errors.push(`At most ${LONG_GRID_SIZE} entrants allowed.`);
        }
        return { filled, errors };
    }

    function defaultSkinId() {
        return window.ArenaApp?.defaultWeaponSkinId?.() || '_weapon';
    }

    function weaponLabelPlaceholder(slot) {
        const weaponId = slotWeaponId(slot);
        if (window.ArenaApp?.weaponDisplayName) {
            return window.ArenaApp.weaponDisplayName(weaponId);
        }
        return weaponMeta(weaponId)?.name || 'Weapon';
    }

    function themeColors() {
        return window.ArenaApp?.listWeaponThemeColors?.() || [];
    }

    function isThemeColor(hex) {
        if (typeof hex !== 'string') return false;
        const normalized = hex.toLowerCase();
        return themeColors().some((c) => c.hex === normalized);
    }

    function themeColorForSlot(slotIndex) {
        const colors = themeColors();
        if (!colors.length) return '#888888';
        return colors[((slotIndex % colors.length) + colors.length) % colors.length].hex;
    }

    function resolveSlotColor(slot, slotIndex) {
        const color = slot.config?.color;
        if (isThemeColor(color)) return color.toLowerCase();
        if (window.ArenaApp?.resolveWeaponThemeColor) {
            return window.ArenaApp.resolveWeaponThemeColor(color, slotIndex);
        }
        return themeColorForSlot(slotIndex);
    }

    function defaultFor(id, key, slotIndex = 0) {
        const meta = fighterMeta(id);
        if (meta) {
            if (key === 'health') return meta.defaultHealth;
            if (key === 'mass') return meta.defaultMass;
            if (key === 'radius') return meta.defaultRadius;
            if (key === 'color' && !isWeaponMode()) return meta.color;
        }
        const app = window.ArenaApp;
        if (app) {
            if (key === 'health') return app.defaultHealthFor(id);
            if (key === 'mass') return app.defaultMassFor(id);
            if (key === 'radius') return app.defaultRadiusFor(id);
            if (key === 'color') return app.defaultColorFor(id, slotIndex);
        }
        return key === 'health' ? (isWeaponMode() ? 60 : 100) : key === 'color' ? '#888888' : 36;
    }

    function slotStat(slot, key) {
        const val = Number(slot.config?.[key]);
        const min = key === 'health' ? 1 : 0.1;
        if (Number.isFinite(val) && val >= min) return val;
        return defaultFor(slot.id, key);
    }

    function slotColor(slot, slotIndex = 0) {
        if (isWeaponMode()) return resolveSlotColor(slot, slotIndex);
        const color = slot.config?.color;
        if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
        return defaultFor(slot.id, 'color', slotIndex);
    }

    function slotName(slot) {
        return typeof slot.config?.name === 'string' ? slot.config.name : '';
    }

    function defaultConfig(id, slotIndex = 0) {
        const config = {
            health: defaultFor(id, 'health', slotIndex),
            mass: defaultFor(id, 'mass', slotIndex),
            radius: defaultFor(id, 'radius', slotIndex),
            name: '',
            color: defaultFor(id, 'color', slotIndex),
            powerupId: EMPTY_POWERUP_ID,
        };
        if (isWeaponMode()) config.weaponId = defaultWeaponId();
        return config;
    }

    function makeSlot(id, slotIndex = 0) {
        return { id, config: defaultConfig(id, slotIndex) };
    }

    /** @type {Map<string, { destroy: () => void }>} */
    const searchSelects = new Map();

    function searchSelectKey(slotIndex, picker) {
        return `${picker}:${slotIndex}`;
    }

    function destroySearchSelects() {
        for (const control of searchSelects.values()) {
            control.destroy();
        }
        searchSelects.clear();
    }

    function mountSearchSelect(mount, { options, value, ariaLabel, onChange }) {
        if (!window.SetupSearchSelect?.mount) {
            mount.innerHTML = `<select class="setup-select" aria-label="${ariaLabel}">${options.map((opt) =>
                `<option value="${opt.id}"${opt.id === value ? ' selected' : ''}>${opt.name}</option>`
            ).join('')}</select>`;
            const sel = mount.querySelector('select');
            sel?.addEventListener('change', () => onChange(sel.value));
            return null;
        }
        return window.SetupSearchSelect.mount(mount, { options, value, ariaLabel, onChange });
    }

    function skinOptions(folder) {
        const none = fighters.find((f) => f.id === defaultSkinId());
        const noneOpt = none
            ? { id: none.id, name: none.name, searchText: `${none.name} ${none.id}` }
            : { id: defaultSkinId(), name: 'Default (weapon name)', searchText: 'default weapon' };
        if (!folder) return [noneOpt];
        return [
            noneOpt,
            ...fighters
                .filter((f) => f.id !== defaultSkinId() && (f.category || 'Other') === folder)
                .map((f) => ({
                    id: f.id,
                    name: f.name,
                    searchText: `${f.name} ${f.id} ${f.category || ''}`,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        ];
    }

    function weaponOptions() {
        return weapons
            .map((w) => ({
                id: w.id,
                name: w.name,
                searchText: `${w.name} ${w.id} ${w.bio || ''}`,
            }))
            .sort((a, b) => {
                if (a.id === 'none') return -1;
                if (b.id === 'none') return 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
    }

    function fighterOptions() {
        return fighters
            .map((f) => ({
                id: f.id,
                name: f.name,
                searchText: `${f.name} ${f.id}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    function buildThemeSwatches(slot, i) {
        const selected = slotColor(slot, i);
        const swatches = themeColors().map((c) => `
            <button
                type="button"
                class="setup-theme-swatch${c.hex === selected ? ' is-selected' : ''}"
                data-slot="${i}"
                data-color="${c.hex}"
                style="--swatch:${c.hex}"
                aria-label="${c.label}"
                aria-pressed="${c.hex === selected}"
            ></button>
        `).join('');
        return `
            <div class="setup-stat setup-stat-theme">
                <span class="setup-stat-label">Color</span>
                <div class="setup-theme-swatches" role="group" aria-label="Fighter ${i + 1} color">
                    ${swatches}
                </div>
            </div>
        `;
    }

    function buildAppearanceFields(slot, i) {
        if (isWeaponMode()) {
            const placeholder = slot.id === defaultSkinId()
                ? weaponLabelPlaceholder(slot)
                : (fighterMeta(slot.id)?.name || 'Ball');
            return `
            <label class="setup-stat">
                <span class="setup-stat-label">Label</span>
                <input
                    type="text"
                    class="setup-stat-input"
                    data-slot="${i}"
                    data-stat="name"
                    maxlength="16"
                    placeholder="${placeholder}"
                    value="${slotName(slot).replace(/"/g, '&quot;')}"
                    aria-label="Fighter ${i + 1} ball label"
                >
            </label>
            ${buildThemeSwatches(slot, i)}
        `;
        }
        const meta = fighterMeta(slot.id);
        const placeholder = meta?.name || 'Ball';
        return `
            <label class="setup-stat">
                <span class="setup-stat-label">Name</span>
                <input
                    type="text"
                    class="setup-stat-input"
                    data-slot="${i}"
                    data-stat="name"
                    maxlength="16"
                    placeholder="${placeholder}"
                    value="${slotName(slot).replace(/"/g, '&quot;')}"
                    aria-label="Fighter ${i + 1} ball label"
                >
            </label>
            <label class="setup-stat setup-stat-color">
                <span class="setup-stat-label">Color</span>
                <input
                    type="color"
                    class="setup-color-input"
                    data-slot="${i}"
                    data-stat="color"
                    value="${slotColor(slot, i)}"
                    aria-label="Fighter ${i + 1} color"
                >
            </label>
        `;
    }

    function buildStatFields(slot, i) {
        return statFields().map(({ key, label, min, step }) => `
            <label class="setup-stat">
                <span class="setup-stat-label">${label}</span>
                <input
                    type="number"
                    class="setup-stat-input"
                    data-slot="${i}"
                    data-stat="${key}"
                    min="${min}"
                    step="${step}"
                    size="4"
                    inputmode="decimal"
                    value="${slotStat(slot, key)}"
                    aria-label="Fighter ${i + 1} ${label.toLowerCase()}"
                >
            </label>
        `).join('');
    }

    const ALL_STAT_FIELDS = [
        { key: 'health', label: 'Health', min: 1, step: 1 },
        { key: 'radius', label: 'Radius', min: 0.1, step: 1 },
    ];

    function slotsForAllStats() {
        if (!isLongWorkflow()) return slots;
        return slots.filter((slot) => slotWeaponId(slot) !== EMPTY_WEAPON_ID);
    }

    function commonStat(key) {
        const targets = slotsForAllStats();
        if (!targets.length) return null;
        const first = slotStat(targets[0], key);
        for (let i = 1; i < targets.length; i++) {
            if (slotStat(targets[i], key) !== first) return null;
        }
        return first;
    }

    function applyStatToAll(key, val) {
        const min = key === 'health' ? 1 : 0.1;
        if (!Number.isFinite(val) || val < min) return;
        slotsForAllStats().forEach((slot) => {
            slot.config[key] = val;
        });
        slotsEl.querySelectorAll(`.setup-stat-input[data-stat="${key}"]`).forEach((input) => {
            if (input.dataset.slot == null) return;
            input.value = String(val);
        });
    }

    function syncAllStatInput(key) {
        if (!allStatsEl) return;
        const input = allStatsEl.querySelector(`.setup-all-stat-input[data-all-stat="${key}"]`);
        if (!input) return;
        const shared = commonStat(key);
        if (shared == null) {
            input.value = '';
            input.placeholder = 'mixed';
        } else {
            input.value = String(shared);
            input.placeholder = '';
        }
    }

    function renderAllStats() {
        if (!allStatsEl) return;
        const targets = slotsForAllStats();
        if (!targets.length) {
            allStatsEl.innerHTML = '';
            allStatsEl.hidden = true;
            return;
        }
        allStatsEl.hidden = false;
        allStatsEl.innerHTML = `
            <div class="setup-all-stats-head">
                <span class="setup-all-stats-label">All balls</span>
                <span class="setup-all-stats-meta">applies to every fighter</span>
            </div>
            <div class="setup-all-stats-grid">
                ${ALL_STAT_FIELDS.map(({ key, label, min, step }) => {
                    const shared = commonStat(key);
                    return `
                    <label class="setup-stat">
                        <span class="setup-stat-label">${label}</span>
                        <input
                            type="number"
                            class="setup-stat-input setup-all-stat-input"
                            data-all-stat="${key}"
                            min="${min}"
                            step="${step}"
                            size="4"
                            inputmode="decimal"
                            ${shared == null ? 'placeholder="mixed"' : `value="${shared}"`}
                            aria-label="All balls ${label.toLowerCase()}"
                        >
                    </label>
                    `;
                }).join('')}
            </div>
        `;
        allStatsEl.querySelectorAll('.setup-all-stat-input').forEach((input) => {
            input.addEventListener('input', () => {
                const key = input.dataset.allStat;
                const min = key === 'health' ? 1 : 0.1;
                const val = Number(input.value);
                if (Number.isFinite(val) && val >= min) {
                    applyStatToAll(key, val);
                }
            });
        });
    }

    function captureOpenDetails() {
        slotsEl.querySelectorAll('details.setup-slot-details').forEach((el) => {
            const idx = Number(el.dataset.slot);
            if (el.open) openDetails.add(idx);
            else openDetails.delete(idx);
        });
    }

    function bindSharedSlotControls() {
        slotsEl.querySelectorAll('.setup-stat-input').forEach((input) => {
            input.addEventListener('input', () => {
                const idx = Number(input.dataset.slot);
                const key = input.dataset.stat;
                if (key === 'name') {
                    slots[idx].config.name = input.value;
                    return;
                }
                const min = key === 'health' ? 1 : 0.1;
                const val = Number(input.value);
                if (Number.isFinite(val) && val >= min) {
                    slots[idx].config[key] = val;
                    if (key === 'health' || key === 'radius') syncAllStatInput(key);
                }
            });
        });

        slotsEl.querySelectorAll('.setup-theme-swatch').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.slot);
                const color = btn.dataset.color;
                if (!isThemeColor(color)) return;
                slots[idx].config.color = color.toLowerCase();
                const article = slotsEl.querySelector(`.setup-slot[data-slot="${idx}"]`);
                if (article) article.style.setProperty('--ball-color', color);
                slotsEl.querySelectorAll(`.setup-theme-swatch[data-slot="${idx}"]`).forEach((swatch) => {
                    const active = swatch.dataset.color === color;
                    swatch.classList.toggle('is-selected', active);
                    swatch.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
            });
        });

        slotsEl.querySelectorAll('.setup-color-input').forEach((input) => {
            input.addEventListener('input', () => {
                const idx = Number(input.dataset.slot);
                slots[idx].config.color = input.value;
                const article = slotsEl.querySelector(`.setup-slot[data-slot="${idx}"]`);
                if (article) article.style.setProperty('--ball-color', input.value);
            });
        });
    }

    function mountLongPickers() {
        slotsEl.querySelectorAll('.setup-search-select-mount').forEach((mount) => {
            const idx = Number(mount.dataset.slot);
            const picker = mount.dataset.picker;
            const key = searchSelectKey(idx, picker);

            if (picker === 'weapon') {
                const control = mountSearchSelect(mount, {
                    options: longWeaponOptions(),
                    value: slotWeaponId(slots[idx]),
                    ariaLabel: `Entrant ${idx + 1} weapon`,
                    onChange: (weaponId) => {
                        if (weaponId === EMPTY_WEAPON_ID) {
                            slots[idx] = makeEmptyLongSlot(idx);
                        } else {
                            const prevSkin = slots[idx].id || defaultSkinId();
                            const prevColor = slots[idx].config?.color;
                            const prevName = slots[idx].config?.name;
                            const prevPowerup = slots[idx].config?.powerupId;
                            slots[idx] = makeSlot(prevSkin, idx);
                            slots[idx].empty = false;
                            slots[idx].config.weaponId = weaponId;
                            if (prevColor) slots[idx].config.color = prevColor;
                            if (prevName) slots[idx].config.name = prevName;
                            if (prevPowerup) slots[idx].config.powerupId = prevPowerup;
                        }
                        renderSlots();
                    },
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            if (picker === 'skin-folder') {
                const filled = slotWeaponId(slots[idx]) !== EMPTY_WEAPON_ID;
                if (!filled) {
                    mount.innerHTML = `<div class="setup-long-skin-placeholder" aria-hidden="true">Folder</div>`;
                    return;
                }
                const control = mountSearchSelect(mount, {
                    options: skinFolderOptions(),
                    value: folderForSlot(idx),
                    ariaLabel: `Entrant ${idx + 1} skin folder`,
                    onChange: (folder) => applySkinFolderChange(idx, folder),
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            if (picker === 'skin') {
                const filled = slotWeaponId(slots[idx]) !== EMPTY_WEAPON_ID;
                if (!filled) {
                    mount.innerHTML = `<div class="setup-long-skin-placeholder" aria-hidden="true">Skin (optional)</div>`;
                    return;
                }
                const folder = folderForSlot(idx);
                if (!folder) {
                    mount.innerHTML = `<div class="setup-long-skin-placeholder">Choose folder first</div>`;
                    return;
                }
                const control = mountSearchSelect(mount, {
                    options: longSkinOptions(folder),
                    value: slots[idx].id,
                    ariaLabel: `Entrant ${idx + 1} skin`,
                    onChange: (id) => {
                        const weaponId = slotWeaponId(slots[idx]);
                        const prevName = slots[idx].config?.name;
                        const prevPowerup = slots[idx].config?.powerupId;
                        slots[idx] = makeSlot(id, idx);
                        slots[idx].empty = false;
                        slots[idx].config.weaponId = weaponId;
                        if (prevName) slots[idx].config.name = prevName;
                        if (prevPowerup) slots[idx].config.powerupId = prevPowerup;
                        setFolderForSlot(idx, folder);
                        renderSlots();
                    },
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            if (picker === 'powerup') {
                const filled = slotWeaponId(slots[idx]) !== EMPTY_WEAPON_ID;
                if (!filled) {
                    mount.innerHTML = `<div class="setup-long-skin-placeholder" aria-hidden="true">Powerup (optional)</div>`;
                    return;
                }
                const control = mountSearchSelect(mount, {
                    options: powerupOptions(),
                    value: slotPowerupId(slots[idx]),
                    ariaLabel: `Entrant ${idx + 1} powerup`,
                    onChange: (powerupId) => {
                        slots[idx].config.powerupId = powerupId || EMPTY_POWERUP_ID;
                    },
                });
                if (control) searchSelects.set(key, control);
            }
        });
    }

    function renderLongSlots() {
        slotsEl.classList.add('is-long-grid');
        const filledCount = slots.filter((s) => slotWeaponId(s) !== EMPTY_WEAPON_ID).length;
        slotsEl.innerHTML = `
            <p class="setup-long-grid-meta" id="setup-long-grid-meta">${filledCount} / ${LONG_GRID_SIZE} entrants · need ${MIN_FIGHTERS}–${LONG_GRID_SIZE} · empty slots ignored</p>
            <div class="setup-long-grid">
                ${slots.map((slot, i) => {
                    const weaponId = slotWeaponId(slot);
                    const filled = weaponId !== EMPTY_WEAPON_ID;
                    const color = filled ? slotColor(slot, i) : '#c4bbb0';
                    const weaponName = filled
                        ? (weaponMeta(weaponId)?.name || weaponId)
                        : 'Empty';
                    const skinName = !filled
                        ? '—'
                        : (slot.id === defaultSkinId()
                            ? 'No skin'
                            : (fighterMeta(slot.id)?.name || slot.id));
                    return `
                    <article class="setup-slot setup-long-slot${filled ? ' is-filled' : ' is-empty'}" data-slot="${i}" style="--ball-color:${color}">
                        <div class="setup-long-slot-head">
                            <span class="setup-slot-index">${i + 1}</span>
                            <div class="setup-long-slot-summary">
                                <strong class="setup-long-slot-weapon">${weaponName}</strong>
                                <span class="setup-long-slot-skin">${skinName}</span>
                            </div>
                        </div>
                        <div class="setup-slot-pickers setup-long-pickers">
                            <div class="setup-search-select-mount setup-search-select-mount-weapon" data-slot="${i}" data-picker="weapon" aria-label="Entrant ${i + 1} weapon"></div>
                            <div class="setup-search-select-mount${filled ? '' : ' is-disabled'}" data-slot="${i}" data-picker="skin-folder" aria-label="Entrant ${i + 1} skin folder"></div>
                            <div class="setup-search-select-mount${filled ? '' : ' is-disabled'}" data-slot="${i}" data-picker="skin" aria-label="Entrant ${i + 1} skin"></div>
                            <div class="setup-search-select-mount${filled ? '' : ' is-disabled'}" data-slot="${i}" data-picker="powerup" aria-label="Entrant ${i + 1} powerup"></div>
                        </div>
                        ${filled ? `
                        <details class="setup-slot-details"${openDetails.has(i) ? ' open' : ''} data-slot="${i}">
                            <summary class="setup-slot-details-summary">
                                <span class="setup-slot-details-label">Label · color</span>
                                <span class="setup-slot-details-meta">optional</span>
                            </summary>
                            <div class="setup-stat-grid">
                                ${buildAppearanceFields(slot, i)}
                            </div>
                        </details>
                        ` : ''}
                    </article>
                    `;
                }).join('')}
            </div>
        `;
        mountLongPickers();
        bindSharedSlotControls();
        if (addBtn) addBtn.hidden = true;
    }

    function renderShortSlots() {
        slotsEl.classList.remove('is-long-grid');
        slotsEl.innerHTML = slots.map((slot, i) => {
            const color = slotColor(slot, i);
            const detailsMeta = isWeaponMode()
                ? 'HP · radius · label · color'
                : 'HP · mass · radius · label · color';
            const pickers = isWeaponMode() ? `
                    <div class="setup-slot-pickers">
                        <div class="setup-search-select-mount" data-slot="${i}" data-picker="skin-folder" aria-label="Skin folder ${i + 1}"></div>
                        <div class="setup-search-select-mount" data-slot="${i}" data-picker="skin" aria-label="Skin ${i + 1}"></div>
                        <div class="setup-search-select-mount setup-search-select-mount-weapon" data-slot="${i}" data-picker="weapon" aria-label="Weapon ${i + 1}"></div>
                        <div class="setup-search-select-mount" data-slot="${i}" data-picker="powerup" aria-label="Powerup ${i + 1}"></div>
                    </div>
            ` : `
                    <div class="setup-search-select-mount" data-slot="${i}" data-picker="fighter" aria-label="${slotLabel()} ${i + 1}"></div>
            `;
            return `
            <article class="setup-slot" data-slot="${i}" style="--ball-color:${color}">
                <div class="setup-slot-top">
                    <span class="setup-slot-index">${i + 1}</span>
                    ${pickers}
                    <button type="button" class="setup-slot-remove" data-slot="${i}" aria-label="Remove fighter ${i + 1}"${slots.length <= MIN_FIGHTERS ? ' disabled' : ''}>
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <details class="setup-slot-details"${openDetails.has(i) ? ' open' : ''} data-slot="${i}">
                    <summary class="setup-slot-details-summary">
                        <span class="setup-slot-details-label">Stats</span>
                        <span class="setup-slot-details-meta">${detailsMeta}</span>
                    </summary>
                    <div class="setup-stat-grid">
                        ${buildStatFields(slot, i)}
                        ${buildAppearanceFields(slot, i)}
                    </div>
                </details>
            </article>
        `;
        }).join('');

        slotsEl.querySelectorAll('.setup-search-select-mount').forEach((mount) => {
            const idx = Number(mount.dataset.slot);
            const picker = mount.dataset.picker;
            const key = searchSelectKey(idx, picker);

            if (picker === 'weapon') {
                const control = mountSearchSelect(mount, {
                    options: weaponOptions(),
                    value: slotWeaponId(slots[idx]),
                    ariaLabel: `Weapon ${idx + 1}`,
                    onChange: (weaponId) => {
                        slots[idx].config.weaponId = weaponId;
                        if (slots[idx].id === defaultSkinId()) {
                            renderSlots();
                        }
                    },
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            if (picker === 'skin-folder') {
                const control = mountSearchSelect(mount, {
                    options: skinFolderOptions(),
                    value: folderForSlot(idx),
                    ariaLabel: `Skin folder ${idx + 1}`,
                    onChange: (folder) => applySkinFolderChange(idx, folder),
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            if (picker === 'powerup') {
                const control = mountSearchSelect(mount, {
                    options: powerupOptions(),
                    value: slotPowerupId(slots[idx]),
                    ariaLabel: `Powerup ${idx + 1}`,
                    onChange: (powerupId) => {
                        slots[idx].config.powerupId = powerupId || EMPTY_POWERUP_ID;
                    },
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            if (picker === 'skin') {
                const folder = folderForSlot(idx);
                if (!folder) {
                    mount.innerHTML = `<div class="setup-long-skin-placeholder">Choose folder first</div>`;
                    return;
                }
                const control = mountSearchSelect(mount, {
                    options: skinOptions(folder),
                    value: slots[idx].id,
                    ariaLabel: `Skin ${idx + 1}`,
                    onChange: (id) => {
                        const weaponId = slotWeaponId(slots[idx]);
                        const prevPowerup = slots[idx].config?.powerupId;
                        slots[idx] = makeSlot(id, idx);
                        slots[idx].config.weaponId = weaponId;
                        if (prevPowerup) slots[idx].config.powerupId = prevPowerup;
                        setFolderForSlot(idx, folder);
                        renderSlots();
                    },
                });
                if (control) searchSelects.set(key, control);
                return;
            }

            const control = mountSearchSelect(mount, {
                options: fighterOptions(),
                value: slots[idx].id,
                ariaLabel: `${slotLabel()} ${idx + 1}`,
                onChange: (id) => {
                    slots[idx] = makeSlot(id, idx);
                    renderSlots();
                },
            });
            if (control) searchSelects.set(key, control);
        });

        bindSharedSlotControls();

        slotsEl.querySelectorAll('.setup-slot-remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.slot);
                if (slots.length <= MIN_FIGHTERS) return;
                openDetails.delete(idx);
                const nextOpen = new Set();
                openDetails.forEach((openIdx) => {
                    if (openIdx < idx) nextOpen.add(openIdx);
                    else if (openIdx > idx) nextOpen.add(openIdx - 1);
                });
                openDetails.clear();
                nextOpen.forEach((v) => openDetails.add(v));
                slots.splice(idx, 1);
                renderSlots();
                syncAddButton();
            });
        });

        syncAddButton();
    }

    function renderSlots() {
        captureOpenDetails();
        destroySearchSelects();
        if (isLongWorkflow()) {
            renderLongSlots();
        } else {
            renderShortSlots();
        }
        renderAllStats();
    }

    function syncAddButton() {
        if (!addBtn) return;
        if (isLongWorkflow()) {
            addBtn.hidden = true;
            return;
        }
        addBtn.hidden = false;
        addBtn.disabled = slots.length >= MAX_FIGHTERS;
    }

    function buildSlotPayload(slot, slotIndex) {
        const payload = {
            health: slotStat(slot, 'health'),
        };
        if (isWeaponMode()) {
            payload.radius = slotStat(slot, 'radius');
            payload.color = slotColor(slot, slotIndex);
            const weaponId = slotWeaponId(slot);
            if (weaponId !== EMPTY_WEAPON_ID) payload.weaponId = weaponId;
            const powerupId = slotPowerupId(slot);
            if (powerupId !== EMPTY_POWERUP_ID) payload.powerupId = powerupId;
        } else {
            payload.mass = slotStat(slot, 'mass');
            payload.radius = slotStat(slot, 'radius');
            const color = slotColor(slot, slotIndex);
            if (color) payload.color = color;
        }
        const name = slotName(slot).trim();
        if (name) payload.name = name;
        return payload;
    }

    function pendingMatchupSlots() {
        if (!isLongWorkflow()) {
            return slots.map((slot, i) => ({
                id: slot.id,
                config: buildSlotPayload(slot, i),
            }));
        }
        return validateLongSlots().filled;
    }

    function applyMatchup() {
        if (isLongWorkflow()) {
            const { filled, errors } = validateLongSlots();
            if (errors.length) {
                throw new Error(errors.join(' '));
            }
            // Live Arena only — never write Long roster into arena-matchup-* (Shorts).
            window.ArenaApp.setMatchup(filled, { persist: false });
            return;
        }
        const payload = slots.map((slot, i) => ({
            id: slot.id,
            config: buildSlotPayload(slot, i),
        }));
        window.ArenaApp.setMatchup(payload);
    }

    function refreshForWorkflow() {
        syncFromArena();
    }

    waitForArenaApp((app) => {
        gameMode = app.getGameMode();
        fighters = app.listFighters();
        weapons = app.listWeapons?.() || [];
        const long = isLongWorkflow();
        if (long && app.getGameMode() !== 'weapon') {
            app.setGameMode('weapon', { persist: false });
            return;
        }
        slots = long
            ? expandLongSlots(loadTournamentRoster() || [])
            : app.getMatchup().map((slot, i) => hydrateSlot(slot, i));
        updateModeChrome();
        renderModeToggle();
        renderSlots();

        window.addEventListener('arena-mode-changed', () => {
            syncFromArena();
        });

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (isLongWorkflow()) return;
                if (slots.length >= MAX_FIGHTERS) return;
                const id = isWeaponMode()
                    ? defaultSkinId()
                    : (fighters[0]?.id ?? slots[0].id);
                slots.push(makeSlot(id, slots.length));
                renderSlots();
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', applyMatchup);
        }
    });

    window.ArenaSetup = {
        getPendingMatchup() {
            return pendingMatchupSlots();
        },
        getGameMode() {
            return gameMode;
        },
        applyMatchup,
        refreshForWorkflow,
        getTournamentOptions,
        setTournamentOptions(next) {
            return saveTournamentOptions(next);
        },
        isLongTournamentSetup() {
            return isLongWorkflow();
        },
        longGridSize() {
            return LONG_GRID_SIZE;
        },
    };
}());
