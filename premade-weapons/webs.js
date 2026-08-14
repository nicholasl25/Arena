/**
 * Webs — each wall bounce anchors a web; opponents break it and take damage.
 * Depends: PremadeWeaponRegistry
 */
(function () {
    'use strict';

    PremadeWeaponRegistry.register('webs', 'WEBS', {
        name: 'Webs',
        weaponKind: 'webs',
        weaponDamage: 6,
        spinSpeed: 0,
        knockbackScale: 0,
        bio: 'Lays damaging webs.',
        behavior: {
            canDealMeleeDamage() {
                return false;
            },
            getHitSegments() {
                return [];
            },
            step() {},
            draw() {},
            onWallCollision(ball, sim) {
                // Contact from the clamped position — catches every wall touch, including
                // floor bounces where the velocity flip happens in enforceMinSpeed.
                const r = ball.radius;
                const inset = sim.wallInset;
                const eps = 1;
                const contacts = new Set();
                if (ball.x <= inset + r + eps) contacts.add('left');
                if (ball.x >= sim.width - inset - r - eps) contacts.add('right');
                if (ball.y <= inset + r + eps) contacts.add('top');
                // enforceMinSpeed bounces balls up to 4 units above the floor (_isOnFloor),
                // so the floor needs a wider tolerance than the other walls.
                if (sim._isOnFloor?.(ball)) contacts.add('bottom');

                const previous = sim._webWallContacts.get(ball._arenaId);
                sim._webWallContacts.set(ball._arenaId, contacts);
                if (!contacts.size) return;

                let isNewContact = false;
                for (const wall of contacts) {
                    if (!previous?.has(wall)) isNewContact = true;
                }
                if (!isNewContact) return;

                const x = contacts.has('left')
                    ? inset
                    : contacts.has('right')
                        ? sim.width - inset
                        : ball.x;
                const y = contacts.has('top')
                    ? inset
                    : contacts.has('bottom')
                        ? sim.height - inset
                        : ball.y;
                sim.anchorWeb(ball, { x, y });
            },
            onBallCollision(ball, _other, sim) {
                sim._webChainBroken.add(ball._arenaId);
            },
        },
    });
}());
