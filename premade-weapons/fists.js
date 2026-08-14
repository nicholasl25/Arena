/**
 * Fists — alternating punches; landing hits builds combo pressure (faster + harder).
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    const { spinWeapon } = PremadeWeaponRegistry.helpers;

    const COMBO_WINDOW = 1.0;
    const COMBO_MAX = 5;
    const COMBO_DMG_PER = 0.3;
    const COMBO_SPEED_PER = 0.3;

    function comboCount(ball) {
        return Math.min(COMBO_MAX, Math.max(0, ball._fistCombo || 0));
    }

    function resetCombo(ball) {
        ball._fistCombo = 0;
        ball._fistComboTimer = 0;
    }

    function resetFists(ball) {
        ball._fistExt = [0, 0];
        ball._punchingFist = -1;
        ball._punchDir = 0;
        ball._punchHold = 0;
        ball._nextFist = Math.random() < 0.5 ? 0 : 1;
        ball._fistPunchLanded = false;
        resetCombo(ball);
        ball._punchTimer = randomPunchDelay(ball) * (0.3 + Math.random() * 0.4);
    }

    function randomPunchDelay(ball) {
        const base = ball.shootInterval > 0 ? ball.shootInterval : 0.95;
        const speedMul = Math.max(0.35, 1 - comboCount(ball) * COMBO_SPEED_PER);
        return base * (0.4 + Math.random() * 0.7) * speedMul;
    }

    function stepFists(ball, dt) {
        if (!ball._fistExt) resetFists(ball);

        if (ball._fistCombo > 0) {
            ball._fistComboTimer -= dt;
            if (ball._fistComboTimer <= 0) resetCombo(ball);
        }

        if (ball._punchingFist >= 0) {
            const i = ball._punchingFist;
            if (ball._punchDir > 0) {
                ball._fistExt[i] = Math.min(1, ball._fistExt[i] + dt / 0.032);
                if (ball._fistExt[i] >= 1) {
                    ball._punchHold += dt;
                    if (ball._punchHold >= 0.16) {
                        ball._punchDir = -1;
                        ball._punchHold = 0;
                    }
                }
            } else {
                ball._fistExt[i] = Math.max(0, ball._fistExt[i] - dt / 0.05);
                if (ball._fistExt[i] <= 0) {
                    if (!ball._fistPunchLanded) resetCombo(ball);
                    ball._punchingFist = -1;
                    ball._punchDir = 0;
                    ball._punchTimer = randomPunchDelay(ball);
                }
            }
            return;
        }

        ball._punchTimer -= dt;
        if (ball._punchTimer > 0) return;

        ball._punchingFist = ball._nextFist;
        ball._nextFist = 1 - ball._nextFist;
        ball._punchDir = 1;
        ball._punchHold = 0;
        ball._fistPunchLanded = false;
        ball._fistExt[ball._punchingFist] = 0;
    }

    PremadeWeaponRegistry.register('fists', 'FISTS', {
        name: 'Fists',
        weaponKind: 'fists',
        weaponDamage: 8,
        damageMax: 18,
        spinSpeed: 5.2,
        swordLength: 58,
        shootInterval: 0.32,
        knockbackScale: 1.45,
        bladeWidthScale: 1.7,
        bio: 'Combo punches.',
        behavior: {
            hitSfx: 'punch',
            clashSfx: 'glove',
            apply(ball) {
                resetFists(ball);
            },
            step(ball, dt) {
                spinWeapon(ball, dt);
                stepFists(ball, dt);
            },
            registerHit(ball) {
                ball._fistPunchLanded = true;
                ball._fistCombo = Math.min(COMBO_MAX, (ball._fistCombo || 0) + 1);
                ball._fistComboTimer = COMBO_WINDOW;
            },
            getHitSegments(ball) {
                const reach = ball.swordLength || 58;
                const baseR = ball.radius + 2;
                const idle = 3;
                const exts = ball._fistExt || [0, 0];
                const idleDmg = ball.weaponDamage;
                const punchDmg = ball.damageMax ?? ball.weaponDamage;
                const comboMul = 1 + comboCount(ball) * COMBO_DMG_PER;
                const halfW = 9 * (ball.bladeWidthScale ?? 1);
                const segments = [];
                for (let i = 0; i < 2; i++) {
                    const e = Math.max(0, Math.min(1, exts[i] || 0));
                    const angle = ball.weaponAngle + i * Math.PI;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const px = -sin;
                    const py = cos;
                    const baseDist = baseR + idle * 0.35;
                    const tipR = baseR + idle + reach * e;
                    const fullyExtended = e >= 1
                        && ball._punchingFist === i
                        && ball._punchDir > 0;
                    let frontDmg = fullyExtended
                        ? Math.round(punchDmg * 1.4)
                        : Math.round(idleDmg + (punchDmg - idleDmg) * e);
                    frontDmg = Math.round(frontDmg * comboMul);
                    const sideDmg = Math.max(1, Math.round(frontDmg * 0.4));

                    segments.push({
                        x1: ball.x + baseDist * cos,
                        y1: ball.y + baseDist * sin,
                        x2: ball.x + tipR * cos,
                        y2: ball.y + tipR * sin,
                        damage: frontDmg,
                    });

                    const tipX = ball.x + tipR * cos;
                    const tipY = ball.y + tipR * sin;
                    segments.push({
                        x1: tipX - halfW * px,
                        y1: tipY - halfW * py,
                        x2: tipX + halfW * px,
                        y2: tipY + halfW * py,
                        damage: sideDmg,
                    });
                    for (const side of [-1, 1]) {
                        const ox = side * halfW * px;
                        const oy = side * halfW * py;
                        segments.push({
                            x1: ball.x + baseDist * cos + ox,
                            y1: ball.y + baseDist * sin + oy,
                            x2: tipX + ox,
                            y2: tipY + oy,
                            damage: sideDmg,
                        });
                    }
                }
                return segments;
            },
            draw(ctx, ball, h) {
                h.drawFists(ctx, ball, h.cx, h.cy, h.r, h.dpr);
            },
        },
    });
}());
