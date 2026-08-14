/**
 * Ball skins — one module, no per-skin JS files.
 * Drop images in skins/ or category subfolders (e.g. skins/GOT/);
 * the filename (without extension) is the ball name. Catalog id is the
 * lowercased stem when unique; duplicate names in another folder get
 * `{folder-slug}/{stem}` so every folder still appears in the picker.
 *
 * Discovery order:
 *   1. GET /api/skins (when server/workflow_server.py is running — rescans the folder)
 *   2. skins/manifest.json (written by the server, or edit by hand)
 * Default ball tint comes from skins/<folder>/colors.json when present.
 *
 * Exposes: window.BallSkins
 */
(function () {
    'use strict';

    const SKIN_EXTS = /\.(png|jpe?g|webp|gif)$/i;
    const FALLBACK_COLORS = ['#cc0000', '#00308f', '#f58426', '#22c55e', '#a855f7', '#0ea5e9'];

    /** @type {Record<string, { id: string, name: string, image: string, color: string }>} */
    let SKINS = {};
    let skinOrder = [];
    let ready = false;
    /** @type {Promise<void> | null} */
    let initPromise = null;

    /** @type {Map<string, HTMLImageElement>} */
    const imageCache = new Map();
    /** @type {Set<string>} */
    const imageLoading = new Set();

    function basename(file) {
        const i = file.lastIndexOf('/');
        return i >= 0 ? file.slice(i + 1) : file;
    }

    function idFromFilename(file) {
        return basename(file).replace(/\.[^.]+$/, '').toLowerCase();
    }

    function nameFromFilename(file) {
        const stem = basename(file).replace(/\.[^.]+$/, '');
        return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function colorForIndex(i) {
        return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    }

    function isHexColor(value) {
        return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
    }

    function normalizeHex(value) {
        return isHexColor(value) ? value.toLowerCase() : null;
    }

    function categoryFromFile(file) {
        const i = String(file || '').lastIndexOf('/');
        if (i <= 0) return 'Other';
        return file.slice(0, i);
    }

    function slugCategory(category) {
        return String(category || 'other')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'other';
    }

    /** @type {Record<string, Record<string, string>>} */
    const colorMaps = {};

    async function loadFolderColors(category) {
        const cat = String(category || '');
        if (!cat || colorMaps[cat]) return colorMaps[cat] || {};
        try {
            const res = await fetch(`skins/${encodeURIComponent(cat)}/colors.json`);
            if (!res.ok) {
                colorMaps[cat] = {};
                return {};
            }
            const data = await res.json();
            const map = {};
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                for (const [key, value] of Object.entries(data)) {
                    const hex = normalizeHex(value);
                    if (hex) map[String(key).toLowerCase()] = hex;
                }
            }
            colorMaps[cat] = map;
            return map;
        } catch {
            colorMaps[cat] = {};
            return {};
        }
    }

    function applyLoadedColors() {
        for (const id of skinOrder) {
            const spec = SKINS[id];
            if (!spec) continue;
            const stem = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
            const hex = colorMaps[spec.category]?.[stem] || colorMaps[spec.category]?.[id];
            if (hex) spec.color = hex;
        }
    }

    function buildCatalog(files) {
        const next = {};
        const order = [];
        const claimedStem = new Set();
        files
            .filter((f) => typeof f === 'string' && SKIN_EXTS.test(f))
            .forEach((file, i) => {
                const stem = idFromFilename(file);
                const category = categoryFromFile(file);
                let id = stem;
                // Same filename in two folders (NBA All vs NBA All 2): keep the
                // first short id for backwards compat; later copies get a folder prefix.
                if (claimedStem.has(stem) || next[id]) {
                    id = `${slugCategory(category)}/${stem}`;
                    let n = 2;
                    while (next[id]) {
                        id = `${slugCategory(category)}/${stem}-${n}`;
                        n += 1;
                    }
                }
                claimedStem.add(stem);
                order.push(id);
                const mapped = colorMaps[category]?.[stem];
                next[id] = {
                    id,
                    name: nameFromFilename(file),
                    image: `skins/${file}`,
                    category,
                    color: mapped || colorForIndex(i),
                };
            });
        SKINS = next;
        skinOrder = order;
        ready = true;
    }

    async function fetchSkinFiles() {
        try {
            const res = await fetch('/api/skins');
            if (res.ok) {
                const data = await res.json();
                const files = Array.isArray(data) ? data : data.files;
                if (Array.isArray(files)) return files;
            }
        } catch {
            /* not served via workflow_server */
        }

        try {
            const res = await fetch('skins/manifest.json');
            if (res.ok) {
                const data = await res.json();
                const files = Array.isArray(data) ? data : data.files;
                if (Array.isArray(files)) return files;
            }
        } catch {
            /* file:// or missing manifest */
        }

        return [];
    }

    function init() {
        if (initPromise) return initPromise;
        initPromise = (async () => {
            const files = await fetchSkinFiles();
            const categories = new Set(
                files
                    .filter((f) => typeof f === 'string' && SKIN_EXTS.test(f))
                    .map((f) => categoryFromFile(f)),
            );
            await Promise.all([...categories].map((cat) => loadFolderColors(cat)));
            buildCatalog(files);
            applyLoadedColors();
            preloadAll();
        })();
        return initPromise;
    }

    function getSkin(id) {
        return SKINS[id] || null;
    }

    function listSkinIds() {
        return skinOrder.slice();
    }

    function listCategories() {
        const cats = new Set();
        for (const id of skinOrder) {
            const cat = SKINS[id]?.category;
            if (cat) cats.add(cat);
        }
        return [...cats].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function listSkinIdsInCategory(category) {
        const cat = String(category || '');
        if (!cat) return [];
        return skinOrder.filter((id) => SKINS[id]?.category === cat);
    }

    function getDefaultMatchup() {
        const ids = listSkinIds();
        if (ids.length >= 2) return [ids[0], ids[1]];
        if (ids.length === 1) return [ids[0], ids[0]];
        return [];
    }

    function loadSkinImage(id) {
        const spec = getSkin(id);
        if (!spec?.image) return null;

        if (imageCache.has(id)) return imageCache.get(id);

        if (!imageLoading.has(id)) {
            imageLoading.add(id);
            const img = new Image();
            img.onload = () => {
                imageCache.set(id, img);
                imageLoading.delete(id);
                window.dispatchEvent(new CustomEvent('arena-skins-loaded'));
            };
            img.onerror = () => {
                imageLoading.delete(id);
            };
            img.src = spec.image;
        }

        return null;
    }

    function getSkinImage(id) {
        const cached = imageCache.get(id);
        if (cached?.complete && cached.naturalWidth > 0) return cached;
        loadSkinImage(id);
        return null;
    }

    function preloadAll() {
        for (const id of skinOrder) {
            loadSkinImage(id);
        }
    }

    window.BallSkins = {
        get SKINS() {
            return SKINS;
        },
        get DEFAULT_WEAPON_MATCHUP() {
            return getDefaultMatchup();
        },
        init,
        isReady() {
            return ready;
        },
        getSkin,
        listSkinIds,
        listCategories,
        listSkinIdsInCategory,
        getDefaultMatchup,
        getSkinImage,
        preloadAll,
    };

    init();
}());
