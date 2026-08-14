/**
 * Fighter intros — drop images in intros/; placement (point + radius) is saved separately.
 *
 * Discovery order:
 *   1. GET /api/intros (when workflow_server is running — rescans the folder)
 *   2. intros/manifest.json
 *
 * Placements:
 *   1. GET /api/intros/placements
 *   2. intros/placements.json
 *
 * Placement coords are normalized to the image (x/y in 0–1, radius as fraction of min side).
 * Exposes: window.BallIntros
 */
(function () {
    'use strict';

    const INTRO_EXTS = /\.(png|jpe?g|webp|gif)$/i;
    const DEFAULT_PLACEMENT = Object.freeze({ x: 0.5, y: 0.4, radius: 0.14 });
    const DEFAULT_FIGHTER_INTRO_IDS = Object.freeze(['sukuna', 'gojo']);

    /** @type {Record<string, { id: string, name: string, image: string }>} */
    let INTROS = {};
    let introOrder = [];
    /** @type {Record<string, { x: number, y: number, radius: number }>} */
    let PLACEMENTS = {};
    let ready = false;
    /** @type {Promise<void> | null} */
    let initPromise = null;

    /** @type {Map<string, HTMLImageElement>} */
    const imageCache = new Map();
    /** @type {Set<string>} */
    const imageLoading = new Set();

    function idFromFilename(file) {
        return file.replace(/\.[^.]+$/, '').toLowerCase();
    }

    function nameFromFilename(file) {
        const stem = file.replace(/\.[^.]+$/, '');
        return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function clamp01(n, fallback) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.max(0, Math.min(1, v));
    }

    function normalizePlacement(raw) {
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_PLACEMENT };
        return {
            x: clamp01(raw.x, DEFAULT_PLACEMENT.x),
            y: clamp01(raw.y, DEFAULT_PLACEMENT.y),
            radius: clamp01(raw.radius, DEFAULT_PLACEMENT.radius) || DEFAULT_PLACEMENT.radius,
        };
    }

    function buildCatalog(files) {
        const next = {};
        const order = [];
        files
            .filter((f) => typeof f === 'string' && INTRO_EXTS.test(f))
            .forEach((file) => {
                const id = idFromFilename(file);
                if (next[id]) return;
                order.push(id);
                next[id] = {
                    id,
                    name: nameFromFilename(file),
                    image: `intros/${file}`,
                };
            });
        INTROS = next;
        introOrder = order;
    }

    async function fetchIntroFiles() {
        try {
            const res = await fetch('/api/intros');
            if (res.ok) {
                const data = await res.json();
                const files = Array.isArray(data) ? data : data.files;
                if (Array.isArray(files)) return files;
            }
        } catch {
            /* not served via workflow_server */
        }

        try {
            const res = await fetch('intros/manifest.json');
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

    async function fetchPlacements() {
        try {
            const res = await fetch('/api/intros/placements');
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    return data.placements && typeof data.placements === 'object'
                        ? data.placements
                        : data;
                }
            }
        } catch {
            /* fall through */
        }

        try {
            const res = await fetch('intros/placements.json');
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data === 'object' && !Array.isArray(data)) return data;
            }
        } catch {
            /* missing */
        }

        return {};
    }

    function applyPlacements(raw) {
        const next = {};
        for (const [id, value] of Object.entries(raw || {})) {
            if (typeof id !== 'string') continue;
            next[id.toLowerCase()] = normalizePlacement(value);
        }
        PLACEMENTS = next;
    }

    function init() {
        if (initPromise) return initPromise;
        initPromise = (async () => {
            const [files, placements] = await Promise.all([
                fetchIntroFiles(),
                fetchPlacements(),
            ]);
            buildCatalog(files);
            applyPlacements(placements);
            ready = true;
            preloadAll();
            window.dispatchEvent(new CustomEvent('arena-intros-loaded'));
        })();
        return initPromise;
    }

    function getIntro(id) {
        return INTROS[id] || null;
    }

    function listIntroIds() {
        return introOrder.slice();
    }

    /** Default intro per fighter slot (#1 Sukuna, #2 Gojo), with catalog fallback. */
    function getDefaultIntroAssignment(fighterCount) {
        const ids = listIntroIds();
        if (!fighterCount || !ids.length) return [];

        const available = new Set(ids);
        const assigned = [];
        for (let i = 0; i < fighterCount; i++) {
            const preferred = DEFAULT_FIGHTER_INTRO_IDS[i];
            if (preferred && available.has(preferred)) {
                assigned.push(preferred);
            } else {
                assigned.push(ids[i % ids.length]);
            }
        }
        return assigned;
    }

    function getPlacement(id) {
        if (!id) return { ...DEFAULT_PLACEMENT };
        return { ...(PLACEMENTS[id] || DEFAULT_PLACEMENT) };
    }

    function setPlacementLocal(id, placement) {
        if (!id) return getPlacement(id);
        const next = normalizePlacement(placement);
        PLACEMENTS[id] = next;
        return { ...next };
    }

    async function savePlacement(id, placement) {
        if (!id) throw new Error('intro id required');
        const next = setPlacementLocal(id, placement);

        const res = await fetch('/api/intros/placements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText || 'save failed');
        if (data.placement) setPlacementLocal(id, data.placement);
        return getPlacement(id);
    }

    function loadIntroImage(id) {
        const spec = getIntro(id);
        if (!spec?.image) return null;

        if (imageCache.has(id)) return imageCache.get(id);

        if (!imageLoading.has(id)) {
            imageLoading.add(id);
            const img = new Image();
            img.onload = () => {
                imageCache.set(id, img);
                imageLoading.delete(id);
                window.dispatchEvent(new CustomEvent('arena-intros-loaded'));
            };
            img.onerror = () => {
                imageLoading.delete(id);
            };
            img.src = spec.image;
        }

        return null;
    }

    function getIntroImage(id) {
        const cached = imageCache.get(id);
        if (cached?.complete && cached.naturalWidth > 0) return cached;
        loadIntroImage(id);
        return null;
    }

    function preloadAll() {
        for (const id of introOrder) {
            loadIntroImage(id);
        }
    }

    /** Pixel radius for a placement on an image of the given size. */
    function pixelRadius(placement, imageWidth, imageHeight) {
        const p = normalizePlacement(placement);
        const minSide = Math.min(imageWidth, imageHeight);
        return Math.max(4, p.radius * minSide);
    }

    window.BallIntros = {
        DEFAULT_PLACEMENT,
        DEFAULT_FIGHTER_INTRO_IDS,
        get INTROS() {
            return INTROS;
        },
        get PLACEMENTS() {
            return PLACEMENTS;
        },
        init,
        isReady() {
            return ready;
        },
        getIntro,
        listIntroIds,
        getDefaultIntroAssignment,
        getPlacement,
        setPlacementLocal,
        savePlacement,
        getIntroImage,
        loadIntroImage,
        preloadAll,
        normalizePlacement,
        pixelRadius,
    };

    init();
}());
