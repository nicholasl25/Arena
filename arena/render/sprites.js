/**
 * Weapon sprite loading + aimed/centered/tinted draws.
 * Extends window.ArenaRenderParts
 */
(function (R) {
    'use strict';

    /** Pixel-art weapon sprites (Minecraft-style items). */
    const WEAPON_SPRITE_URLS = {
        sword: 'premade-weapons/sprites/Sword.png',
        arrow: 'premade-weapons/sprites/Arrow.png',
        bow: 'premade-weapons/sprites/Bow-unloaded.png',
        bowPull1: 'premade-weapons/sprites/Bow_pull1.png',
        bowPull2: 'premade-weapons/sprites/Bow_pull2.png',
        hammer: 'premade-weapons/sprites/Stone_Hammer.png',
        slingshot: 'premade-weapons/sprites/Slingshot.png',
        slingshotProjectile: 'premade-weapons/sprites/Slingshot_projectile.png',
        basketball: 'premade-weapons/sprites/Basketball.png',
        grenade: 'premade-weapons/sprites/Grenade.png',
        staff: 'premade-weapons/sprites/Staff.png',
    };
    /** Tip / fire direction in the source image (canvas angle; 0 = +X, −π/2 = up). */
    const SPRITE_AIM = {
        sword: -Math.PI / 4,      // tip toward top-right
        arrow: -Math.PI / 4,
        bow: (-3 * Math.PI) / 4,  // open side / fire toward top-left (same as pull frames)
        bowPull1: (-3 * Math.PI) / 4, // nocked arrow toward top-left
        bowPull2: (-3 * Math.PI) / 4,
        hammer: -Math.PI / 4,     // head toward top-right
        slingshot: -Math.PI / 4,  // fire opposite string pull (toward top-right)
        grenade: -Math.PI / 2,    // fuse toward top
        staff: -Math.PI / 4,      // crystal tip toward top-right
    };

    /** @type {Record<string, HTMLImageElement>} */
    const weaponSpriteImgs = {};

    /** Scratch canvas so tint composites don't punch the arena. */
    let projectileTintCanvas = null;

    function getWeaponSprite(key) {
        if (!WEAPON_SPRITE_URLS[key]) return null;
        let img = weaponSpriteImgs[key];
        if (!img) {
            img = new Image();
            img.decoding = 'async';
            img.src = WEAPON_SPRITE_URLS[key];
            weaponSpriteImgs[key] = img;
        }
        return img.complete && img.naturalWidth > 0 ? img : null;
    }

    /** Preload so the first fight frame isn't empty. */
    Object.keys(WEAPON_SPRITE_URLS).forEach((key) => getWeaponSprite(key));

    /**
     * Draw a Minecraft-style item sprite aimed along `angle`.
     * Source art points along SPRITE_AIM[key]; we rotate so that becomes `angle`.
     */
    function drawAimedSprite(ctx, key, x, y, angle, size) {
        const img = getWeaponSprite(key);
        if (!img || !(size > 0)) return false;
        const aim = SPRITE_AIM[key] ?? -Math.PI / 4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle - aim);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, -size * 0.5, -size * 0.5, size, size);
        ctx.restore();
        return true;
    }

    /**
     * Draw a Minecraft-style item sprite aimed along `angle`, with the back
     * corner (hilt / handle butt) pinned at (baseX, baseY) — not the ball center.
     * Source art points along SPRITE_AIM[key]; corner-to-corner span ≈ size√2.
     */
    function drawAimedSpriteFromBase(ctx, key, baseX, baseY, angle, size) {
        const img = getWeaponSprite(key);
        if (!img || !(size > 0)) return false;
        const aim = SPRITE_AIM[key] ?? -Math.PI / 4;
        // Image center sits half a diagonal forward from the hilt corner.
        const halfDiag = size * Math.SQRT2 * 0.5;
        ctx.save();
        ctx.translate(baseX + Math.cos(angle) * halfDiag, baseY + Math.sin(angle) * halfDiag);
        ctx.rotate(angle - aim);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, -size * 0.5, -size * 0.5, size, size);
        ctx.restore();
        return true;
    }

    /** Blade sprites sized from hit-segment length (swordLength); nest under the rim. */
    function bladeSpriteDraw(ctx, key, x1, y1, x2, y2, dpr) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return false;
        // Visual span tracks swordLength via segment len (not bladeWidthScale).
        const size = (len / Math.SQRT2) * 1.45;
        const nest = Math.max(6, 7 * dpr) + len * 0.04;
        const bx = x1 - Math.cos(angle) * nest;
        const by = y1 - Math.sin(angle) * nest;
        return drawAimedSpriteFromBase(ctx, key, bx, by, angle, size);
    }

    /** Centered sprite (optional spin). Good for balls / orbs. */
    function drawCenteredSprite(ctx, key, x, y, size, spin = 0) {
        const img = getWeaponSprite(key);
        if (!img || !(size > 0)) return false;
        ctx.save();
        ctx.translate(x, y);
        if (spin) ctx.rotate(spin);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, -size * 0.5, -size * 0.5, size, size);
        ctx.restore();
        return true;
    }

    /** Recolor a white/light sprite to `tint` while keeping alpha. */
    function drawTintedCenteredSprite(ctx, key, x, y, size, tint, spin = 0) {
        const img = getWeaponSprite(key);
        if (!img || !(size > 0)) return false;
        const s = Math.max(1, Math.ceil(size));
        if (!projectileTintCanvas) projectileTintCanvas = document.createElement('canvas');
        const off = projectileTintCanvas;
        if (off.width !== s || off.height !== s) {
            off.width = s;
            off.height = s;
        }
        const octx = off.getContext('2d');
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, s, s);
        octx.imageSmoothingEnabled = false;
        octx.fillStyle = tint || '#888';
        octx.fillRect(0, 0, s, s);
        octx.globalCompositeOperation = 'multiply';
        octx.drawImage(img, 0, 0, s, s);
        octx.globalCompositeOperation = 'destination-in';
        octx.drawImage(img, 0, 0, s, s);
        octx.globalCompositeOperation = 'source-over';

        ctx.save();
        ctx.translate(x, y);
        if (spin) ctx.rotate(spin);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, -size * 0.5, -size * 0.5, size, size);
        ctx.restore();
        return true;
    }

    function shadeHex(hex, amount) {
        const raw = (hex || '#888888').replace('#', '');
        const full = raw.length === 3
            ? raw.split('').map((c) => c + c).join('')
            : raw.padEnd(6, '0').slice(0, 6);
        const n = parseInt(full, 16);
        if (Number.isNaN(n)) return hex || '#888';
        let r = (n >> 16) & 255;
        let g = (n >> 8) & 255;
        let b = n & 255;
        if (amount >= 0) {
            r = Math.round(r + (255 - r) * amount);
            g = Math.round(g + (255 - g) * amount);
            b = Math.round(b + (255 - b) * amount);
        } else {
            const t = 1 + amount;
            r = Math.round(r * t);
            g = Math.round(g * t);
            b = Math.round(b * t);
        }
        return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    }

    R.getWeaponSprite = getWeaponSprite;
    R.drawAimedSprite = drawAimedSprite;
    R.drawAimedSpriteFromBase = drawAimedSpriteFromBase;
    R.bladeSpriteDraw = bladeSpriteDraw;
    R.drawCenteredSprite = drawCenteredSprite;
    R.drawTintedCenteredSprite = drawTintedCenteredSprite;
    R.shadeHex = shadeHex;

    // Shared mutable sim→canvas mapping (mutated each draw / drawBallAt).
    if (!R.offsetXFromSim) R.offsetXFromSim = (x) => x;
    if (!R.offsetYFromSim) R.offsetYFromSim = (y) => y;
}(window.ArenaRenderParts = window.ArenaRenderParts || {}));
