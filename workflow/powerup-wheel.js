/**
 * Tournament powerup wheel — weighted slices, spin math, canvas draw.
 * Exposes: window.PowerupWheel
 */
(function () {
    'use strict';

    const POINTER_ANGLE = -Math.PI / 2;
    const TAU = Math.PI * 2;
    const SPIN_MS = 5200;
    const REVEAL_MS = 1800;
    const SEQUENCE_GAP_MS = 280;
    const MIN_TURNS = 6;
    const MAX_TURNS = 8;
    const NOTHING_NAME = 'No Powerup';
    const NOTHING_ICON = 'premade-powerups/sprites/EmptyBottle.webp';
    const NOTHING_COLOR = '#ffffff';

    const NOTHING_SHARE = 0.4;
    const POWERUP_SHARE = 0.6;

    /** @type {Record<string, HTMLImageElement>} */
    const iconImgs = {};
    /** @type {WeakMap<CanvasImageSource, HTMLCanvasElement>} */
    const punchedIcons = typeof WeakMap === 'function' ? new WeakMap() : null;

    function easeOutCubic(t) {
        const x = Math.min(1, Math.max(0, t));
        return 1 - ((1 - x) ** 3);
    }

    function wrapAngle(angle) {
        return ((angle % TAU) + TAU) % TAU;
    }

    function isAppleSlice(slice) {
        const id = slice?.id;
        if (window.PremadePowerups?.isApplePowerup) return window.PremadePowerups.isApplePowerup(id);
        return typeof id === 'string' && id.startsWith('apple-');
    }

    function fighterWeaponId(fighter) {
        if (!fighter) return '';
        return fighter.weaponId || fighter.arenaMatchup?.config?.weaponId || '';
    }

    function sliceWeight(slice) {
        return Math.max(0, Number(slice.weight) || 0);
    }

    function pushWeighted(normalized, slices, poolShare) {
        const sum = slices.reduce((acc, s) => acc + sliceWeight(s), 0);
        if (!(sum > 0) || !(poolShare > 0)) return 0;
        for (const slice of slices) {
            const w = sliceWeight(slice);
            if (!(w > 0)) continue;
            normalized.push({
                id: slice.id,
                name: slice.name || '?',
                icon: slice.icon || null,
                color: slice.color || '#888888',
                weight: (w / sum) * poolShare,
            });
        }
        return poolShare;
    }

    /**
     * Always 40% Nothing. Apples keep their catalog fraction of the 60% pool
     * (currently 15/90 → 10% of the rim), same pinning as Nothing.
     * Remaining powerups split whatever is left; invalid ones for this weapon
     * are dropped without changing apple / nothing odds.
     */
    function buildSlices({ fighter } = {}) {
        const raw = window.PremadePowerups?.listWheelSlices?.() || [{
            id: '',
            name: NOTHING_NAME,
            icon: NOTHING_ICON,
            color: NOTHING_COLOR,
            weight: 1,
        }];
        const nothingSrc = raw.find((s) => !s.id) || {
            id: '',
            name: NOTHING_NAME,
            icon: NOTHING_ICON,
            color: NOTHING_COLOR,
            weight: 1,
        };
        const powered = raw.filter((s) => s.id);
        const apples = powered.filter(isAppleSlice);
        const restAll = powered.filter((s) => !isAppleSlice(s));
        const weaponId = fighterWeaponId(fighter);
        const fits = window.PremadePowerups?.powerupFitsWeapon;
        const rest = typeof fits === 'function'
            ? restAll.filter((s) => fits(s.id, weaponId))
            : restAll;

        const poweredSum = powered.reduce((sum, s) => sum + sliceWeight(s), 0);
        const appleSum = apples.reduce((sum, s) => sum + sliceWeight(s), 0);
        const appleShare = poweredSum > 0 && appleSum > 0
            ? (appleSum / poweredSum) * POWERUP_SHARE
            : 0;
        let restShare = POWERUP_SHARE - appleShare;
        const restSum = rest.reduce((sum, s) => sum + sliceWeight(s), 0);
        let nothingWeight = NOTHING_SHARE;
        if (!(restSum > 0)) {
            nothingWeight += restShare;
            restShare = 0;
        }

        const normalized = [{
            id: nothingSrc.id || '',
            name: NOTHING_NAME,
            icon: nothingSrc.icon || NOTHING_ICON,
            color: nothingSrc.color || NOTHING_COLOR,
            weight: nothingWeight,
        }];
        pushWeighted(normalized, apples, appleShare);
        pushWeighted(normalized, rest, restShare);

        let angle = 0;
        return normalized.map((slice) => {
            const weight = Math.max(0, Number(slice.weight) || 0);
            const span = weight * TAU;
            const start = angle;
            const end = angle + span;
            const mid = start + span / 2;
            angle = end;
            return {
                id: slice.id || '',
                name: slice.id ? (slice.name || '?') : NOTHING_NAME,
                icon: slice.icon || null,
                color: slice.color || '#888888',
                weight,
                start,
                end,
                mid,
                span,
            };
        });
    }

    function pickSliceIndex(slices, random = Math.random) {
        const total = slices.reduce((sum, s) => sum + s.weight, 0) || 1;
        let roll = random() * total;
        for (let i = 0; i < slices.length; i += 1) {
            roll -= slices[i].weight;
            if (roll <= 0) return i;
        }
        return slices.length - 1;
    }

    /**
     * Wheel rotation so the pointer (top) lands on a random point inside the slice.
     * Rotation is clockwise-positive on canvas when drawing with +rotation.
     */
    function targetRotation(slices, index, random = Math.random) {
        const slice = slices[index];
        if (!slice) return 0;
        const pad = Math.min(slice.span * 0.12, 0.08);
        const lo = slice.start + pad;
        const hi = slice.end - pad;
        const land = lo >= hi ? slice.mid : lo + random() * (hi - lo);
        const turns = MIN_TURNS + Math.floor(random() * (MAX_TURNS - MIN_TURNS + 1));
        return turns * TAU + (POINTER_ANGLE - land);
    }

    function createSpin({ fighter, delayMs = 0, random = Math.random, slices = null } = {}) {
        const resolved = Array.isArray(slices) && slices.length
            ? slices
            : buildSlices({ fighter });
        const index = pickSliceIndex(resolved, random);
        const endRotation = targetRotation(resolved, index, random);
        const result = resolved[index];
        const hasId = Boolean(result?.id);
        return {
            fighter: fighter || null,
            slices: resolved,
            index,
            resultId: result?.id || '',
            resultName: hasId ? (result.name || '?') : (result?.name || NOTHING_NAME),
            resultColor: result?.color || NOTHING_COLOR,
            delayMs,
            durationMs: SPIN_MS,
            revealMs: REVEAL_MS,
            endRotation,
            startRotation: 0,
        };
    }

    /** Equal-weight slices for a custom wheel (e.g. weapons). No empty slice. */
    function buildSlicesFromEntries(entries) {
        const list = (Array.isArray(entries) ? entries : [])
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const id = typeof entry.id === 'string' ? entry.id : '';
                if (!id) return null;
                return {
                    id,
                    name: entry.name || id,
                    icon: entry.icon || null,
                    color: entry.color || '#888888',
                    weight: Math.max(0.01, Number(entry.weight) || 1),
                };
            })
            .filter(Boolean);
        if (!list.length) return [];
        const sum = list.reduce((acc, s) => acc + s.weight, 0) || 1;
        let angle = 0;
        return list.map((slice) => {
            const weight = slice.weight / sum;
            const span = weight * TAU;
            const start = angle;
            const end = angle + span;
            const mid = start + span / 2;
            angle = end;
            return {
                id: slice.id,
                name: slice.name,
                icon: slice.icon,
                color: slice.color,
                weight,
                start,
                end,
                mid,
                span,
            };
        });
    }

    function applyWeaponResultToFighter(fighter, weaponId) {
        if (!fighter) return;
        const id = typeof weaponId === 'string' ? weaponId.trim() : '';
        if (!id) return;
        fighter.weaponId = id;
        fighter.weaponIcon = window.PremadeWeapons?.iconUrl?.(id) || fighter.weaponIcon || null;
        if (!fighter.arenaMatchup) {
            fighter.arenaMatchup = { id: fighter.id, config: {} };
        }
        if (!fighter.arenaMatchup.config) fighter.arenaMatchup.config = {};
        fighter.arenaMatchup.config.weaponId = id;
    }

    function spinProgress(spin, elapsedMs) {
        if (!spin) return { rotation: 0, t: 0, spinning: false, revealed: false, done: true };
        const local = elapsedMs - spin.delayMs;
        if (local < 0) {
            return { rotation: spin.startRotation, t: 0, spinning: false, revealed: false, done: false };
        }
        if (local < spin.durationMs) {
            const t = easeOutCubic(local / spin.durationMs);
            return {
                rotation: spin.startRotation + (spin.endRotation - spin.startRotation) * t,
                t,
                spinning: true,
                revealed: false,
                done: false,
            };
        }
        const revealT = (local - spin.durationMs) / spin.revealMs;
        return {
            rotation: spin.endRotation,
            t: 1,
            spinning: false,
            revealed: true,
            done: revealT >= 1,
            revealT: Math.min(1, Math.max(0, revealT)),
        };
    }

    function isPairDone(spinA, spinB, elapsedMs) {
        return spinProgress(spinA, elapsedMs).done && spinProgress(spinB, elapsedMs).done;
    }

    /** Local wheel angle currently under the top pointer. */
    function pointerLocalAngle(rotation) {
        return wrapAngle(POINTER_ANGLE - rotation);
    }

    function sliceIndexAtRotation(slices, rotation) {
        if (!slices?.length) return -1;
        const a = pointerLocalAngle(rotation);
        for (let i = 0; i < slices.length; i += 1) {
            const slice = slices[i];
            if (a >= slice.start && a < slice.end) return i;
        }
        return slices.length - 1;
    }

    function tickIntensity(spin, elapsedMs) {
        const p0 = spinProgress(spin, elapsedMs - 16);
        const p1 = spinProgress(spin, elapsedMs);
        const omega = Math.abs(p1.rotation - p0.rotation);
        return Math.min(1, omega / 0.22);
    }

    /** Elapsed times when the pointer crosses into a new sector. */
    function tickTimesMs(spin, stepMs = 4) {
        if (!spin?.slices?.length) return [];
        if (spin._tickTimes) return spin._tickTimes;
        const start = Number(spin.delayMs) || 0;
        const end = start + (Number(spin.durationMs) || SPIN_MS);
        const times = [];
        let prev = -1;
        for (let t = start; t <= end; t += stepMs) {
            const idx = sliceIndexAtRotation(spin.slices, spinProgress(spin, t).rotation);
            if (prev >= 0 && idx !== prev) times.push(t);
            prev = idx;
        }
        spin._tickTimes = times;
        return times;
    }

    function collectTickEvents(spinA, spinB) {
        const events = [];
        for (const spin of [spinA, spinB]) {
            if (!spin) continue;
            for (const tMs of tickTimesMs(spin)) {
                events.push({ tMs, intensity: tickIntensity(spin, tMs) });
            }
        }
        events.sort((a, b) => a.tMs - b.tMs);
        return events;
    }

    function playDueTicks(spin, fromMs, toMs) {
        if (!spin || !(toMs > fromMs)) return 0;
        const play = window.ArenaAudio?.playWheelTick;
        if (typeof play !== 'function') return 0;
        let n = 0;
        for (const tMs of tickTimesMs(spin)) {
            if (tMs > fromMs && tMs <= toMs) {
                play(tickIntensity(spin, tMs));
                n += 1;
            }
        }
        return n;
    }

    function shade(hex, amount) {
        const raw = String(hex || '#888888').replace('#', '');
        if (raw.length !== 6) return hex;
        const n = parseInt(raw, 16);
        const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount));
        const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount));
        const b = Math.min(255, Math.max(0, (n & 255) + amount));
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    function sliceLabelText(slice) {
        if (!slice) return '';
        return slice.id ? String(slice.name || '?') : NOTHING_NAME;
    }

    /** Radial names, outside-in: origin at the rim so type uses the widest arc. */
    function sliceLabelLayout(slice, radius) {
        const label = sliceLabelText(slice);
        const span = Math.max(0, Number(slice?.span) || 0);
        const r = Math.max(1, Number(radius) || 1);
        const hasIcon = !!slice?.icon;
        const outer = hasIcon ? r * 0.66 : r * 0.90;
        const inner = r * 0.16;
        const maxWidth = Math.max(8, outer - inner);
        const maxHeight = Math.max(4, span * outer * 0.92);
        const maxSize = Math.min(34, r * 0.13, maxHeight);
        const fitted = Math.min(maxSize, maxWidth / Math.max(1, label.length * 0.5));
        return {
            label,
            mode: 'radial',
            fontSize: label ? Math.max(4, fitted) : 0,
            maxWidth,
            inner,
            outer,
            anchor: 'outer',
        };
    }

    function getSliceIcon(src) {
        if (!src || typeof Image === 'undefined') return null;
        let img = iconImgs[src];
        if (!img) {
            img = new Image();
            img.decoding = 'async';
            img.src = src;
            iconImgs[src] = img;
        }
        return img.complete && img.naturalWidth > 0 ? img : null;
    }

    function punchBlack(img) {
        if (!img || typeof document === 'undefined' || !document.createElement) return img;
        const hit = punchedIcons?.get(img);
        if (hit) return hit;
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        if (!(c.width > 0 && c.height > 0)) return img;
        const x = c.getContext('2d');
        if (!x) return img;
        x.drawImage(img, 0, 0);
        let data;
        try {
            data = x.getImageData(0, 0, c.width, c.height);
        } catch {
            return img;
        }
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i] < 18 && px[i + 1] < 18 && px[i + 2] < 18) px[i + 3] = 0;
        }
        x.putImageData(data, 0, 0);
        punchedIcons?.set(img, c);
        return c;
    }

    function preloadIcons(slices) {
        const urls = [...new Set((slices || []).map((s) => s?.icon).filter(Boolean))];
        if (typeof Image === 'undefined' || !urls.length) return Promise.resolve();
        return Promise.all(urls.map((url) => new Promise((resolve) => {
            const existing = iconImgs[url];
            if (existing?.complete) {
                resolve();
                return;
            }
            const img = existing || new Image();
            const done = () => resolve();
            img.onload = done;
            img.onerror = done;
            if (!existing) {
                img.decoding = 'async';
                img.src = url;
                iconImgs[url] = img;
            }
            if (img.decode) img.decode().then(done, done);
        })));
    }

    function drawSliceIcon(ctx, slice, radius) {
        const img = getSliceIcon(slice.icon);
        if (!img) return;
        const along = radius * 0.80;
        const maxBySpan = Math.max(14, slice.span * along * 0.72);
        const size = Math.min(radius * 0.22, maxBySpan);
        if (size < 8) return;
        const punch = !/Bottle|Apple/i.test(String(slice.icon || ''));
        const sprite = punch ? punchBlack(img) : img;
        ctx.save();
        ctx.translate(Math.cos(slice.mid) * along, Math.sin(slice.mid) * along);
        ctx.rotate(slice.mid + Math.PI / 2);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
    }

    function drawSliceLabel(ctx, slice, radius, lit) {
        const layout = sliceLabelLayout(slice, radius);
        if (!layout.label || !ctx) return;

        ctx.save();
        ctx.fillStyle = slice.id
            ? (lit ? '#ffffff' : 'rgba(255,255,255,0.96)')
            : (lit ? '#111111' : 'rgba(28,25,23,0.88)');
        ctx.font = `700 ${layout.fontSize}px "DM Sans", "IBM Plex Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 3;

        const along = layout.outer;
        ctx.translate(Math.cos(slice.mid) * along, Math.sin(slice.mid) * along);
        ctx.rotate(slice.mid);
        const flip = Math.cos(slice.mid) < 0;
        if (flip) ctx.rotate(Math.PI);
        ctx.textAlign = flip ? 'left' : 'right';
        ctx.fillText(layout.label, 0, 0, layout.maxWidth);
        ctx.restore();
    }

    function drawWheel(ctx, {
        cx,
        cy,
        radius,
        rotation = 0,
        slices,
        highlightIndex = -1,
        glow = 0,
    }) {
        if (!ctx || !slices?.length || !(radius > 0)) return;

        ctx.save();
        ctx.translate(cx, cy);

        // Soft drop shadow
        ctx.beginPath();
        ctx.arc(4, 8, radius * 1.02, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fill();

        ctx.rotate(rotation);

        for (let i = 0; i < slices.length; i += 1) {
            const slice = slices[i];
            if (slice.span <= 0) continue;
            const lit = i === highlightIndex && glow > 0;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, slice.start, slice.end);
            ctx.closePath();
            ctx.fillStyle = lit ? shade(slice.color, 36) : slice.color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius * 0.98, slice.start, slice.end);
            ctx.closePath();
            ctx.clip();
            drawSliceIcon(ctx, slice, radius);
            drawSliceLabel(ctx, slice, radius, lit);
            ctx.restore();
        }

        // Hub
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.14, 0, TAU);
        ctx.fillStyle = '#1c1917';
        ctx.fill();
        ctx.strokeStyle = '#faf7f1';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.restore();

        // Rim
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = Math.max(4, radius * 0.045);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.97, 0, TAU);
        ctx.strokeStyle = 'rgba(250,247,241,0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (glow > 0 && highlightIndex >= 0) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rotation);
            const slice = slices[highlightIndex];
            if (slice) {
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, radius * 1.04, slice.start, slice.end);
                ctx.closePath();
                ctx.fillStyle = `rgba(255, 236, 160, ${0.18 + glow * 0.22})`;
                ctx.fill();
            }
            ctx.restore();
        }

        drawPointer(ctx, cx, cy - radius - 2, radius * 0.12);
    }

    function drawPointer(ctx, tipX, tipY, size) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY + size * 1.6);
        ctx.lineTo(tipX - size, tipY - size * 0.2);
        ctx.lineTo(tipX + size, tipY - size * 0.2);
        ctx.closePath();
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function drawSpinCard(ctx, {
        x,
        y,
        w,
        h,
        spin,
        progress,
    }) {
        if (!ctx || !spin) return;
        const top = 64;
        const bottom = 38;
        const pointerRoom = Math.max(16, Math.min(w, h) * 0.035);
        const radius = Math.max(48, Math.min(w * 0.46, (h - top - bottom - pointerRoom) / 2));
        const cx = x + w / 2;
        const cy = y + top + pointerRoom + radius;
        const glow = progress.revealed ? (0.55 + 0.45 * Math.sin((progress.revealT || 0) * Math.PI * 4)) : 0;
        const highlight = progress.revealed || progress.t > 0.98 ? spin.index : -1;

        const fighter = spin.fighter;
        if (fighter) {
            const nameY = y + 34;
            ctx.fillStyle = '#faf7f1';
            ctx.font = '700 44px "Russo One", "DM Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(trimName(fighter.name || '?', 22), cx, nameY);
        }

        drawWheel(ctx, {
            cx,
            cy,
            radius,
            rotation: progress.rotation,
            slices: spin.slices,
            highlightIndex: highlight,
            glow,
        });

        if (progress.revealed) {
            drawResultPopup(ctx, {
                cx,
                cy,
                radius,
                name: spin.resultName || NOTHING_NAME,
                color: spin.resultId ? spin.resultColor : '#64748b',
                revealT: progress.revealT || 0,
            });
        }

        const bannerY = y + h - 20;
        roundRectPath(ctx, x + 24, bannerY - 14, w - 48, 28, 10);
        if (progress.revealed) {
            ctx.fillStyle = spin.resultId ? spin.resultColor : '#64748b';
            ctx.globalAlpha = 0.28 + (progress.revealT || 0) * 0.2;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = spin.resultColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#faf7f1';
            ctx.font = '700 15px "DM Sans", "IBM Plex Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(spin.resultName || NOTHING_NAME, cx, bannerY);
        } else {
            ctx.fillStyle = 'rgba(250,247,241,0.08)';
            ctx.fill();
            ctx.fillStyle = 'rgba(250,247,241,0.55)';
            ctx.font = '600 13px "DM Sans", "IBM Plex Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(progress.spinning ? 'Spinning…' : 'Ready', cx, bannerY);
        }
    }

    function drawResultPopup(ctx, { cx, cy, radius, name, color, revealT }) {
        const t = Math.min(1, Math.max(0, Number(revealT) || 0));
        const pop = Math.min(1, t * 3);
        const scale = 0.86 + 0.14 * pop;
        const boxW = Math.min(radius * 1.35, Math.max(140, radius * 1.1));
        const boxH = Math.max(52, radius * 0.32);
        const label = String(name || NOTHING_NAME);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.globalAlpha = pop;

        roundRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 14);
        ctx.fillStyle = 'rgba(28, 25, 23, 0.92)';
        ctx.fill();
        ctx.strokeStyle = color || '#faf7f1';
        ctx.lineWidth = 3;
        ctx.stroke();

        roundRectPath(ctx, -boxW / 2 + 4, -boxH / 2 + 4, boxW - 8, boxH - 8, 11);
        ctx.strokeStyle = `rgba(250,247,241,0.18)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#faf7f1';
        ctx.font = `700 ${Math.max(16, Math.min(26, boxW / Math.max(8, label.length * 0.55)))}px "Russo One", "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0, boxW - 24);
        ctx.restore();
    }

    function drawScene(ctx, {
        width,
        height,
        spinA,
        spinB,
        elapsedMs,
        title = 'POWERUP SPIN',
    }) {
        if (!ctx) return;
        let g = null;
        try {
            g = ctx.createLinearGradient?.(0, 0, width, height) || null;
        } catch {
            g = null;
        }
        if (g) {
            g.addColorStop(0, '#1c1917');
            g.addColorStop(0.5, '#292524');
            g.addColorStop(1, '#44403c');
            ctx.fillStyle = g;
        } else {
            ctx.fillStyle = '#292524';
        }
        ctx.fillRect(0, 0, width, height);

        const midX = width / 2;
        ctx.fillStyle = 'rgba(250,247,241,0.16)';
        ctx.fillRect(midX - 1, 8, 2, height - 16);

        ctx.fillStyle = 'rgba(250,247,241,0.7)';
        ctx.font = '700 11px "DM Sans", "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(title, midX, 18);

        const progA = spinProgress(spinA, elapsedMs);
        const progB = spinProgress(spinB, elapsedMs);

        drawSpinCard(ctx, {
            x: 0,
            y: 0,
            w: midX,
            h: height,
            spin: spinA,
            progress: progA,
        });
        drawSpinCard(ctx, {
            x: midX,
            y: 0,
            w: width - midX,
            h: height,
            spin: spinB,
            progress: progB,
        });
    }

    function roundRectPath(ctx, x, y, w, h, r) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }

    function trimName(name, max) {
        const value = String(name || '?');
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function applyResultToFighter(fighter, powerupId) {
        if (!fighter) return;
        const raw = typeof powerupId === 'string' ? powerupId : '';
        const resolved = window.PremadePowerups?.resolvePowerupId?.(raw);
        const id = (resolved == null ? raw : resolved) || '';
        fighter.powerupId = id || null;
        if (!fighter.arenaMatchup) {
            fighter.arenaMatchup = { id: fighter.id, config: {} };
        }
        if (!fighter.arenaMatchup.config) fighter.arenaMatchup.config = {};
        if (id) fighter.arenaMatchup.config.powerupId = id;
        else delete fighter.arenaMatchup.config.powerupId;
    }

    function serializeSpin(spin) {
        if (!spin) return null;
        return {
            fighter: spin.fighter
                ? { name: spin.fighter.name || '?', color: spin.fighter.color || '#888888' }
                : null,
            slices: (spin.slices || []).map((slice) => ({
                id: slice.id || '',
                name: slice.id ? (slice.name || '?') : NOTHING_NAME,
                icon: slice.icon || null,
                color: slice.color || '#888888',
                weight: slice.weight,
                start: slice.start,
                end: slice.end,
                mid: slice.mid,
                span: slice.span,
            })),
            index: spin.index,
            resultId: spin.resultId || '',
            resultName: spin.resultId ? (spin.resultName || '?') : NOTHING_NAME,
            resultColor: spin.resultColor || NOTHING_COLOR,
            delayMs: spin.delayMs || 0,
            durationMs: spin.durationMs || SPIN_MS,
            revealMs: spin.revealMs || REVEAL_MS,
            endRotation: spin.endRotation || 0,
            startRotation: spin.startRotation || 0,
        };
    }

    function nextSpinDelayMs(prevSpin, gapMs = SEQUENCE_GAP_MS) {
        if (!prevSpin) return 0;
        return (Number(prevSpin.delayMs) || 0)
            + (Number(prevSpin.durationMs) || SPIN_MS)
            + (Number(prevSpin.revealMs) || REVEAL_MS)
            + Math.max(0, Number(gapMs) || 0);
    }

    function spinDurationMs(spinA, spinB) {
        const one = (spin) => {
            if (!spin) return 0;
            return (Number(spin.delayMs) || 0)
                + (Number(spin.durationMs) || SPIN_MS)
                + (Number(spin.revealMs) || REVEAL_MS);
        };
        return Math.max(one(spinA), one(spinB), 1);
    }

    window.PowerupWheel = {
        SPIN_MS,
        REVEAL_MS,
        SEQUENCE_GAP_MS,
        NOTHING_NAME,
        buildSlices,
        buildSlicesFromEntries,
        sliceLabelLayout,
        sliceLabelText,
        pickSliceIndex,
        targetRotation,
        createSpin,
        spinProgress,
        isPairDone,
        sliceIndexAtRotation,
        tickTimesMs,
        collectTickEvents,
        playDueTicks,
        preloadIcons,
        drawScene,
        applyResultToFighter,
        applyWeaponResultToFighter,
        serializeSpin,
        nextSpinDelayMs,
        spinDurationMs,
    };
}());
