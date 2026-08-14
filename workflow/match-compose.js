/**
 * Per-matchup voice-over compose records for Long YouTube tournament loop.
 * Pure helpers — browser + Node tests. One compose per stable matchComposeKey.
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'workflow-match-compose-v1';

    function powerupSpeakLabel(fighter) {
        if (!fighter) return '';
        const id = fighter.arenaMatchup?.config?.powerupId
            || fighter.config?.powerupId
            || fighter.powerupId
            || '';
        if (typeof id === 'string' && id) {
            const spec = root.PremadePowerups?.getPremadePowerup?.(id);
            if (spec?.name) return stripPowerupRank(spec.name);
            const base = id.split('-')[0];
            if (base) return base.charAt(0).toUpperCase() + base.slice(1);
        }
        const named = fighter.powerupName || fighter.arenaMatchup?.config?.powerupName;
        if (typeof named === 'string' && named.trim()) {
            return stripPowerupRank(named);
        }
        return '';
    }

    /** "Speed I" / "Power II" → "Speed" / "Power" */
    function stripPowerupRank(label) {
        return String(label || '')
            .replace(/\s+[IVXLC\d]+$/i, '')
            .trim();
    }

    /** "Dagger with Speed" → "Dagger" (winner lines stay plain). */
    function stripPowerupClause(label) {
        return String(label || '')
            .replace(/\s+with\s+[A-Za-z][\w'-]*$/i, '')
            .trim();
    }

    function plainFighterName(fighter) {
        if (!fighter) return '?';
        let name = '';
        if (typeof fighter.name === 'string' && fighter.name.trim()) name = fighter.name.trim();
        else if (fighter.id) name = String(fighter.id);
        else return '?';
        return stripPowerupClause(name) || name;
    }

    function fighterLabel(fighter) {
        if (!fighter) return '?';
        const name = plainFighterName(fighter);
        if (name === '?') return name;
        const powerup = powerupSpeakLabel(fighter);
        return powerup ? `${name} with ${powerup}` : name;
    }

    function powerupGetsLabel(fighter, spin) {
        if (spin && typeof spin === 'object') {
            const id = typeof spin.resultId === 'string' ? spin.resultId : '';
            if (!id) return 'nothing';
            return stripPowerupRank(spin.resultName || powerupSpeakLabel({ powerupId: id }) || 'nothing')
                || 'nothing';
        }
        return powerupSpeakLabel(fighter) || 'nothing';
    }

    function buildGetsLine(fighter, spin) {
        const name = plainFighterName(fighter || spin?.fighter);
        return `${name} gets ${powerupGetsLabel(fighter, spin)}`;
    }

    function buildMatchScript({
        a,
        b,
        winner,
        mode = 'collision',
        spins = null,
        weaponSpins = null,
    } = {}) {
        const lines = [`${plainFighterName(a)} vs. ${plainFighterName(b)}`];
        if (weaponSpins?.a || weaponSpins?.b) {
            lines.push(buildGetsLine(a, weaponSpins.a));
            lines.push(buildGetsLine(b, weaponSpins.b));
        }
        if (spins?.a || spins?.b) {
            lines.push(buildGetsLine(a, spins.a));
            lines.push(buildGetsLine(b, spins.b));
        }
        const winName = plainFighterName(winner);
        if (winner && winName !== '?') lines.push(`${winName} wins`);
        return lines.join('\n\n');
    }

    function normalizeRecord(entry, fallbackKey = '') {
        if (!entry || typeof entry !== 'object') return null;
        const matchKey = typeof entry.matchKey === 'string' && entry.matchKey
            ? entry.matchKey
            : fallbackKey;
        if (!matchKey) return null;
        return {
            matchKey,
            matchId: entry.matchId || null,
            order: entry.order != null && Number.isInteger(Number(entry.order))
                ? Number(entry.order)
                : null,
            aName: entry.aName || null,
            bName: entry.bName || null,
            winnerName: entry.winnerName || null,
            loserName: entry.loserName || null,
            script: typeof entry.script === 'string' ? entry.script : '',
            mode: entry.mode === 'weapon' ? 'weapon' : 'collision',
            composed: entry.composed || null,
            status: entry.status || 'done',
            at: Number(entry.at) || Date.now(),
        };
    }

    function createStore(options = {}) {
        const storage = options.storage || null;
        const storageKey = options.storageKey || STORAGE_KEY;
        /** @type {Map<string, object>} */
        const records = new Map();
        let calls = 0;

        function hydrate(raw) {
            records.clear();
            if (!raw || typeof raw !== 'object') return;
            const list = Array.isArray(raw.records)
                ? raw.records
                : (raw.byKey && typeof raw.byKey === 'object'
                    ? Object.values(raw.byKey)
                    : (Array.isArray(raw) ? raw : []));
            for (const entry of list) {
                const rec = normalizeRecord(entry, entry?.matchKey);
                if (rec) records.set(rec.matchKey, rec);
            }
        }

        function load() {
            if (!storage?.getItem) return;
            try {
                const parsed = JSON.parse(storage.getItem(storageKey) || 'null');
                hydrate(parsed);
            } catch {
                records.clear();
            }
        }

        function persist() {
            if (!storage?.setItem) return;
            try {
                storage.setItem(storageKey, JSON.stringify({
                    version: 1,
                    records: list(),
                }));
            } catch { /* ignore quota */ }
        }

        function list() {
            return [...records.values()].map((r) => ({ ...r }));
        }

        function get(matchKey) {
            const rec = records.get(matchKey);
            return rec ? { ...rec } : null;
        }

        function has(matchKey) {
            return records.has(matchKey);
        }

        function clear() {
            records.clear();
            calls = 0;
            if (storage?.removeItem) {
                try { storage.removeItem(storageKey); } catch { /* ignore */ }
            }
        }

        function remove(matchKey) {
            if (!matchKey || !records.has(matchKey)) return false;
            records.delete(matchKey);
            persist();
            return true;
        }

        /**
         * Ensure exactly one compose record/call for this matchup.
         * Returns { record, created }.
         */
        function ensure(payload = {}) {
            const matchKey = payload.matchKey
                || root.WorkflowBracket?.matchComposeKey?.(payload.match)
                || '';
            if (!matchKey) {
                throw new Error('TournamentCompose: matchKey required');
            }
            const existing = records.get(matchKey);
            if (existing) {
                // Allow refreshing the composed filename after media succeeds.
                const nextOrder = payload.order != null && Number.isInteger(Number(payload.order))
                    ? Number(payload.order)
                    : existing.order;
                if (
                    (payload.composed && payload.composed !== existing.composed)
                    || nextOrder !== existing.order
                ) {
                    if (payload.composed) existing.composed = payload.composed;
                    existing.order = nextOrder;
                    existing.status = payload.status || existing.status || 'done';
                    records.set(matchKey, existing);
                    persist();
                }
                return { record: { ...existing }, created: false };
            }

            calls += 1;
            const match = payload.match || null;
            const mode = payload.mode === 'weapon' ? 'weapon' : 'collision';
            const script = typeof payload.script === 'string' && payload.script.trim()
                ? payload.script.trim()
                : buildMatchScript({
                    a: match?.a || payload.a,
                    b: match?.b || payload.b,
                    winner: payload.winner,
                    mode,
                    spins: payload.powerupSpins || payload.spins || null,
                });
            const record = normalizeRecord({
                matchKey,
                matchId: match?.id || payload.matchId || null,
                order: payload.order != null && Number.isInteger(Number(payload.order))
                    ? Number(payload.order)
                    : null,
                aName: fighterLabel(match?.a || payload.a),
                bName: fighterLabel(match?.b || payload.b),
                winnerName: plainFighterName(payload.winner),
                loserName: plainFighterName(payload.loser),
                script,
                mode,
                composed: payload.composed || null,
                status: payload.status || (payload.composed ? 'done' : 'pending'),
                at: Date.now(),
            }, matchKey);
            records.set(matchKey, record);
            persist();
            return { record: { ...record }, created: true };
        }

        load();

        return {
            STORAGE_KEY: storageKey,
            load,
            persist,
            list,
            get,
            has,
            clear,
            remove,
            ensure,
            get size() { return records.size; },
            get calls() { return calls; },
        };
    }

    const api = {
        STORAGE_KEY,
        buildMatchScript,
        buildGetsLine,
        createStore,
        fighterLabel,
        plainFighterName,
        powerupSpeakLabel,
    };

    root.TournamentCompose = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
