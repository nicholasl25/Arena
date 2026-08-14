/**
 * Workflow app — Match compose + tournament stitch.
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.clearMatchComposes = function clearMatchComposes() {
        rt.matchComposeStore?.clear?.();
        rt.tournamentMedia = {
            finalReady: false,
            final: null,
            previewReady: false,
            preview: null,
            doneSegmentCount: 0,
            segmentCount: 0,
            status: null,
            error: null,
            progress: null,
        };
        rt.lastProgressMsg = '';
    }

    rt.ensureMatchCompose = async function ensureMatchCompose(payload) {
        if (!rt.matchComposeStore) return null;
        const mode = rt.setupReady?.mode === 'weapon'
            || window.ArenaSetup?.getGameMode?.() === 'weapon'
            || window.ArenaApp?.getGameMode?.() === 'weapon'
            ? 'weapon'
            : 'collision';
        const matchKey = payload.matchKey
            || window.WorkflowBracket?.matchComposeKey?.(payload.match)
            || '';
        const already = matchKey ? rt.matchComposeStore.get(matchKey) : null;
        const script = already?.script
            || (typeof payload.script === 'string' && payload.script.trim())
            || window.TournamentCompose?.buildMatchScript?.({
                a: payload.match?.a || payload.a,
                b: payload.match?.b || payload.b,
                winner: payload.winner,
                mode,
                spins: payload.powerupSpins || null,
            })
            || '';
        const aName = already?.aName || window.TournamentCompose?.fighterLabel?.(payload.match?.a) || payload.aName;
        const bName = already?.bName || window.TournamentCompose?.fighterLabel?.(payload.match?.b) || payload.bName;
        const winnerName = already?.winnerName
            || window.TournamentCompose?.plainFighterName?.(payload.winner)
            || payload.winner?.name
            || payload.winnerName;
        const loserName = already?.loserName
            || window.TournamentCompose?.plainFighterName?.(payload.loser)
            || payload.loser?.name
            || payload.loserName;
        // Order = number of completed VO records (stable even when persisted bracket lags).
        const order = Number.isInteger(payload.order)
            ? payload.order
            : (already?.order != null ? already.order : rt.matchComposeStore.size);
    
        WorkflowGraph.setNodeFile('compose', rt.matchComposeSummary(), false);
        rt.syncTournamentPhaseState(rt.tournamentPhase || 'compose');
    
        // Real media: narrated bracket+powerup+arena+bracket segment (idempotent on matchKey).
        try {
            const spins = payload.powerupSpins?.a && payload.powerupSpins?.b
                ? payload.powerupSpins
                : null;
            let matchup = payload.match
                ? window.WorkflowBracket.matchArenaMatchup(payload.match)
                : null;
            if (!matchup || matchup.length !== 2) {
                throw new Error('match compose requires a two-fighter arena matchup');
            }
            if (spins) {
                matchup = matchup.map((slot, i) => {
                    const spin = i === 0 ? spins.a : spins.b;
                    const config = { ...(slot.config || {}) };
                    const id = typeof spin?.resultId === 'string' ? spin.resultId : '';
                    if (id) config.powerupId = id;
                    else delete config.powerupId;
                    return { ...slot, config };
                });
            }
            if (!matchKey || !script) {
                throw new Error('match compose requires matchKey and script');
            }
            const LP = window.LongPipeline;
            const bracketPre = LP?.cellJson?.(payload.bracketPre) || payload.bracketPre || null;
            const bracketPost = LP?.cellJson?.(payload.bracketPost) || payload.bracketPost || null;
            const segmentRequest = {
                matchKey,
                script,
                order,
                mode,
                matchup,
                aName,
                bName,
                winnerName,
                loserName,
                bracketPre,
                bracketPost,
                activeMatch: LP?.cellJson?.(payload.match) || payload.match || null,
                lastWinner: LP?.cellJson?.(payload.winner) || payload.winner || null,
                lastLoser: LP?.cellJson?.(payload.loser) || payload.loser || null,
                powerupSpins: spins ? (LP?.cellJson?.(spins) || spins) : null,
                // Output timing is independent from preview speed. The server records
                // exactly this pair through the offline Arena renderer.
                syntheticArena: false,
            };
            LP?.requireMatchSegmentRequest?.(segmentRequest);
            WorkflowGraph.setNodeStatus(
                'compose',
                already ? 'Segment ready' : 'Recording bracket + arena for segment…',
                'busy'
            );
            rt.log(`building segment ${order + 1}: ${aName} vs ${bName}`);
            const result = await rt.apiPost('/api/tournament/ensure-segment', segmentRequest);
            const segmentFile = result.segment?.file || result.composed || null;
            const { record, created } = rt.matchComposeStore.ensure({
                ...payload,
                matchKey,
                order,
                mode,
                script,
                composed: segmentFile,
                status: 'done',
            });
            rt.applyTournamentMediaStatus(result.pipeline?.tournament);
            const count = rt.matchComposeStore.size;
            WorkflowGraph.setNodeStatus(
                'compose',
                `${record.winnerName || 'Match'} · segment ${count}`,
                'success'
            );
            if (created || result.created) {
                rt.log(`segment ${count}: ${record.aName} vs ${record.bName} → ${record.winnerName}`);
            }
            if (rt.pipeline) rt.updateUI(rt.pipeline);
            return record;
        } catch (err) {
            console.warn('tournament segment failed', err);
            if (matchKey && !already) rt.matchComposeStore.remove?.(matchKey);
            WorkflowGraph.setNodeStatus('compose', err.message || String(err), 'error');
            rt.tournamentMedia = { ...rt.tournamentMedia, error: err.message || String(err) };
            rt.syncTournamentPhaseState(rt.tournamentPhase || 'compose');
            throw err;
        }
    }

    rt.stitchTournamentFinal = async function stitchTournamentFinal() {
        if (!rt.isComputerWorkflow() || !rt.isLongBracketComplete()) return null;
        if (rt.tournamentMedia.finalReady && rt.tournamentMedia.final) return rt.tournamentMedia.final;
        const total = window.WorkflowBracket.fightMatchTotal(rt.bracketState);
        WorkflowGraph.setNodeStatus('compose', 'Stitching full-length video…', 'busy');
        rt.log(`stitching ${total} match segments…`);
        try {
            const matchKeys = rt.matchComposeStore.list()
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((record) => record.matchKey);
            const result = await rt.apiPost('/api/tournament/stitch', {
                expectedCount: total,
                championName: rt.bracketState?.champion?.name || 'Champion',
                matchKeys,
                bracketState: window.LongPipeline?.cellJson?.(rt.bracketState) || rt.bracketState,
                rosterNames: (rt.bracketState?.fighters || []).map((f) => f?.name).filter(Boolean),
                title: (rt.els.inputTitle?.value || rt.caption.title || '').trim() || undefined,
                powerupSpin: rt.isPowerupSpinEnabled(),
                weaponSpin: (rt.bracketState?.fighters || []).some(
                    (f) => f && f.id !== '_weapon' && (f.skinId || f.id),
                ),
                force: true,
            });
            rt.applyTournamentMediaStatus(result.pipeline?.tournament);
            if (result.pipeline) rt.updateUI(result.pipeline);
            else if (rt.pipeline) rt.updateUI(rt.pipeline);
            rt.log(`final video ready: ${result.final}`);
            return result.final;
        } catch (err) {
            console.warn('tournament stitch failed', err);
            rt.tournamentMedia = { ...rt.tournamentMedia, error: err.message || String(err) };
            WorkflowGraph.setNodeStatus('compose', err.message || String(err), 'error');
            rt.syncTournamentPhaseState(rt.tournamentPhase);
            throw err;
        }
    }
}());
