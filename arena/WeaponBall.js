/**
 * Weapon ball — fixed health, rotating weapon, no body damage.
 * Special abilities live on ball.weaponBehavior (from PremadeWeaponRegistry).
 * Depends: Ball
 */
class WeaponBall extends Ball {
    /**
     * @param {object} opts
     * @param {number} [opts.weaponDamage=10]
     * @param {number} [opts.spinSpeed=3.8]
     * @param {number} [opts.swordLength=32]
     * @param {number} [opts.spikeCount=0]
     * @param {number} [opts.spikeLength=0]
     * @param {number} [opts.knockbackScale=1]
     * @param {number} [opts.bladeWidthScale=1]
     * @param {string} [opts.weaponKind='blade']
     * @param {number} [opts.shootInterval=1.4]
     * @param {number} [opts.arrowSpeed=400]
     * @param {number} [opts.bowLength=28]
     * @param {number} [opts.projectileDamage]
     * @param {number} [opts.damageMax]
     * @param {number} [opts.damageRampHits=0]
     * @param {number} [opts.spinSpeedMax]
     * @param {number} [opts.weaponAngle] random if omitted
     * @param {string} [opts.skinId]
     * @param {string} [opts.weaponId]
     * @param {object} [opts.weaponBehavior]
     */
    constructor({
        weaponDamage = 10,
        spinSpeed = 3.8,
        swordLength = 32,
        spikeCount = 0,
        spikeLength = 0,
        knockbackScale = 1,
        bladeWidthScale = 1,
        weaponKind = 'blade',
        shootInterval = 1.4,
        arrowSpeed = 400,
        bowLength = 28,
        projectileDamage,
        damageMax,
        damageRampHits = 0,
        spinSpeedMax,
        weaponAngle,
        skinId,
        weaponId,
        weaponBehavior,
        ...opts
    }) {
        super(opts);
        this.weaponDamage = weaponDamage;
        this.spinSpeed = spinSpeed;
        this.baseSpinSpeed = spinSpeed;
        this.spinSpeedMax = spinSpeedMax ?? spinSpeed;
        this.swordLength = swordLength;
        this.spikeCount = spikeCount;
        this.spikeLength = spikeLength;
        this.knockbackScale = knockbackScale;
        this.bladeWidthScale = bladeWidthScale;
        this.weaponKind = weaponKind;
        this.shootInterval = shootInterval;
        this.arrowSpeed = arrowSpeed;
        this.bowLength = bowLength;
        this.projectileDamage = projectileDamage ?? weaponDamage;
        this.damageMax = damageMax ?? weaponDamage;
        this.damageRampHits = damageRampHits;
        this.weaponAngle = weaponAngle ?? Math.random() * Math.PI * 2;
        this.skinId = skinId || null;
        this.weaponId = weaponId || null;
        this.isWeaponBall = true;
        this.weaponBehavior = weaponBehavior
            || window.PremadeWeaponRegistry?.DefaultWeaponBehavior
            || null;
        this._shootTimer = this._shootsProjectiles() ? Math.random() * shootInterval * 0.5 : 0;
        this._pendingShot = false;
        this._damageCharge = 0;
        this._laserCooldown = 0;
        this._fistExt = [0, 0];
        this._punchingFist = -1;
        this._punchDir = 0;
        this._punchHold = 0;
        this._nextFist = 0;
        this._punchTimer = 0;
    }

    _shootsProjectiles() {
        return !!this.weaponBehavior?.shootsProjectiles?.(this);
    }

    computeDamage() {
        return 0;
    }

    getWeaponDamage() {
        return this.weaponBehavior?.getDamage?.(this) ?? this.weaponDamage;
    }

    getDamageChargeFraction() {
        return this.weaponBehavior?.getChargeFraction?.(this) ?? 1;
    }

    registerWeaponHit() {
        this.weaponBehavior?.registerHit?.(this);
    }

    /** @param {number} dt */
    stepWeapon(dt) {
        if (this.weaponBehavior?.step) {
            this.weaponBehavior.step(this, dt);
            return;
        }
        this.weaponAngle = (this.weaponAngle + this.spinSpeed * dt) % (Math.PI * 2);
    }

    /** Blade segment in world coordinates (base just outside ball rim → tip). */
    getSwordSegment() {
        const cos = Math.cos(this.weaponAngle);
        const sin = Math.sin(this.weaponAngle);
        const baseR = this.radius + 2;
        const tipR = baseR + this.swordLength;
        return {
            x1: this.x + baseR * cos,
            y1: this.y + baseR * sin,
            x2: this.x + tipR * cos,
            y2: this.y + tipR * sin,
        };
    }

    /** Hit segments for weapon collision — delegated to behavior. */
    getWeaponHitSegments() {
        return this.weaponBehavior?.getHitSegments?.(this) ?? [];
    }
}
