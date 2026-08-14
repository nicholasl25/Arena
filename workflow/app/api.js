/**
 * Workflow app — API helpers + pipeline poll/UI sync.
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.nodeLabel = function nodeLabel(nodeId) {
        if (nodeId === 'record' && rt.isComputerWorkflow()) return 'Arena';
        if (nodeId === 'powerup' && rt.isComputerWorkflow()) return 'Powerup';
        if (nodeId === 'compose' && rt.isComputerWorkflow()) return 'Voice Over';
        return rt.NODE_LABELS[nodeId] || nodeId;
    }

    rt.log = function log(msg) {
        if (!msg || msg === rt.lastLogMsg) return;
        rt.lastLogMsg = msg;
        console.log(`[workflow] ${msg}`);
        if (rt.els.logLines) {
            const line = document.createElement('div');
            line.className = 'log-line';
            const prefix = document.createElement('span');
            prefix.className = 'log-prefix';
            prefix.textContent = '›';
            const text = document.createElement('span');
            text.textContent = msg;
            line.append(prefix, text);
            rt.els.logLines.appendChild(line);
            while (rt.els.logLines.children.length > 40) {
                rt.els.logLines.removeChild(rt.els.logLines.firstChild);
            }
            if (rt.els.workflowLog) rt.els.workflowLog.scrollTop = rt.els.workflowLog.scrollHeight;
            return;
        }
        if (rt.els.logText) rt.els.logText.textContent = msg;
    }

    rt.apiGet = async function apiGet(path) {
        const res = await fetch(`${rt.API}${path}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    }

    rt.apiPost = async function apiPost(path, body) {
        const res = await fetch(`${rt.API}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    }

    rt.shortFile = function shortFile(name, max = 28) {
        if (!name) return '';
        return name.length > max ? `${name.slice(0, max - 1)}…` : name;
    }

    rt.videoClip = function videoClip(folder, name, state) {
        if (!name) return null;
        const entry = state.stages?.[folder]?.find((v) => v.name === name);
        const bust = entry?.mtime ? `?t=${entry.mtime}` : '';
        return {
            url: `/recordings/${folder}/${encodeURIComponent(name)}${bust}`,
            name,
        };
    }

    rt.videoForNode = function videoForNode(nodeId, state) {
        if (!state) return null;
        const raw = state.active.raw;
        const composed = state.active.composed
            || (rt.isComputerWorkflow() && rt.tournamentMedia.finalReady ? rt.tournamentMedia.final : null);
        const posted = state.stages.posted[0]?.name || null;
    
        if (nodeId === 'record') {
            if (rt.isComputerWorkflow()) {
                return rt.videoClip('composed', composed, state)
                    || rt.videoClip('raw', raw, state)
                    || rt.videoClip('posted', posted, state);
            }
            return rt.videoClip('raw', raw, state)
                || rt.videoClip('composed', composed, state)
                || rt.videoClip('posted', posted, state);
        }
        if (nodeId === 'compose') {
            return rt.videoClip('composed', composed, state)
                || rt.videoClip('raw', raw, state);
        }
        if (nodeId === 'youtube') {
            return rt.videoClip('composed', composed, state)
                || rt.videoClip('posted', posted, state);
        }
        return null;
    }

    rt.canRedoStep = function canRedoStep(nodeId, state) {
        if (!state) return false;
        const raw = state.active.raw;
        const composed = state.active.composed;
        const hasPosted = state.stages.posted.length > 0;
        const hasAny = Boolean(raw || composed || hasPosted);
    
        if (nodeId === 'setup') return rt.isMatchupReady(rt.setupReady) || hasAny;
        if (nodeId === 'intro') return rt.isIntroReady(rt.setupReady) || hasAny;
        if (nodeId === 'record') {
            if (rt.isComputerWorkflow()) return rt.isMatchupReady(rt.setupReady) || hasAny;
            return hasAny;
        }
        if (nodeId === 'compose') return Boolean(composed || hasPosted);
        if (nodeId === 'youtube') return hasPosted;
        return false;
    }

    rt.redoConfirmMessage = function redoConfirmMessage(nodeId) {
        const label = rt.nodeLabel(nodeId);
        if (nodeId === 'setup') {
            return rt.isComputerWorkflow()
                ? 'Redo Make setup? This clears the fighters, bracket, and deletes all recordings, composed videos, and uploads.'
                : 'Redo Make setup? This clears the matchup, intro, and deletes all recordings, composed videos, and uploads.';
        }
        if (nodeId === 'intro') {
            return 'Redo Make intro? This clears the intro choice so you can skip, use default, or edit manually again. Recordings stay.';
        }
        if (nodeId === 'record') {
            return rt.isComputerWorkflow()
                ? 'Redo Tournament? This rebuilds the bracket demo and deletes recordings, composed videos, and uploads.'
                : 'Redo Record? This deletes all recordings, composed videos, and uploads — back to a fresh start.';
        }
        if (nodeId === 'compose') {
            return 'Redo Compose? This deletes composed and uploaded videos. Your raw recording stays so you can compose again.';
        }
        if (nodeId === 'youtube') {
            return 'Redo YouTube? This moves the latest upload back to composed/ so you can upload again.';
        }
        return `Redo ${label}? This undoes later workflow steps.`;
    }

    rt.loadDraftScript = async function loadDraftScript(rawName) {
        if (!rawName) return;
        const data = await rt.apiGet(`/api/draft-script?file=${encodeURIComponent(rawName)}`);
        if (!rt.scriptDirty || !rt.scriptText.trim()) {
            rt.scriptText = data.script;
            if (rt.els.inputScript) rt.els.inputScript.value = rt.scriptText;
            rt.scriptDirty = false;
        }
        if (rt.els.composeModeBadge) {
            if (data.mode === 'weapon') {
                rt.els.composeModeBadge.hidden = false;
                rt.els.composeModeBadge.textContent = 'Weapon mode — spinning swords';
            } else {
                rt.els.composeModeBadge.hidden = true;
                rt.els.composeModeBadge.textContent = '';
            }
        }
    }

    rt.loadDraftCaption = async function loadDraftCaption(composedName) {
        if (!composedName) return;
        const data = await rt.apiGet(`/api/draft-caption?file=${encodeURIComponent(composedName)}`);
        if (!rt.captionDirty || !rt.caption.title.trim()) {
            rt.caption = {
                title: data.title,
                description: data.description,
                privacy: data.privacy || 'public',
            };
            if (rt.els.inputTitle) rt.els.inputTitle.value = rt.caption.title;
            if (rt.els.inputDescription) rt.els.inputDescription.value = rt.caption.description;
            if (rt.els.inputPrivacy) rt.els.inputPrivacy.value = rt.caption.privacy;
            rt.captionDirty = false;
        }
    }

    rt.updateUI = function updateUI(state) {
        rt.pipeline = state;
        const rawName = state.active.raw;
        const composedName = state.active.composed;
        const hasPosted = state.stages.posted.length > 0;
    
        const rawFile = rawName || state.stages.raw[0]?.name || null;
        const composedFile = composedName || state.stages.composed[0]?.name || null;
        const postedFile = state.stages.posted[0]?.name || null;
    
        const matchupDone = rt.isMatchupReady(rt.setupReady) || Boolean(rawFile);
        const introDone = !rt.hasIntroNode() || rt.isIntroReady(rt.setupReady) || Boolean(rawFile);
        const pipelineReady = matchupDone && introDone;
        const recordDone = rt.isComputerWorkflow()
            ? Boolean(rawFile) || (matchupDone && Boolean(rt.bracketState))
            : Boolean(rawFile);
        const composeDone = rt.isComputerWorkflow()
            ? (rt.matchComposeStore?.size || 0) > 0 || Boolean(composedFile) || hasPosted
            : Boolean(composedFile) || hasPosted;
        const youtubeDone = hasPosted;
        const tournamentDone = rt.isLongTournamentComplete();
    
        if (rt.isMatchupReady(rt.setupReady)) {
            WorkflowGraph.setNodeFile('setup', rt.setupSummary(), false);
        } else if (rawFile) {
            WorkflowGraph.setNodeFile('setup', 'ready', false);
        } else {
            WorkflowGraph.setNodeFile('setup', '', true);
        }
    
        if (rt.hasIntroNode()) {
            if (rt.isIntroReady(rt.setupReady)) {
                WorkflowGraph.setNodeFile('intro', rt.introSummary(), false);
            } else if (rawFile) {
                WorkflowGraph.setNodeFile('intro', 'ready', false);
            } else {
                WorkflowGraph.setNodeFile('intro', '', true);
            }
        }
    
        if (rt.isComputerWorkflow() && matchupDone) {
            WorkflowGraph.setNodeFile('record', rt.bracketSummary() || rt.shortFile(rawFile) || 'bracket ready', false);
            WorkflowGraph.setNodeFile('bracket', rt.bracketSummary() || 'bracket ready', false);
        } else if (rawFile) {
            WorkflowGraph.setNodeFile('record', rt.shortFile(rawFile), false);
        } else if (composedFile) {
            WorkflowGraph.setNodeFile('record', rt.shortFile(composedFile), false);
        } else if (postedFile) {
            WorkflowGraph.setNodeFile('record', rt.shortFile(postedFile), false);
        } else {
            WorkflowGraph.setNodeFile('record', '', true);
            if (rt.isComputerWorkflow()) WorkflowGraph.setNodeFile('bracket', '', true);
        }
    
        if (rt.isComputerWorkflow()) {
            const voSummary = rt.matchComposeSummary();
            if (voSummary) {
                WorkflowGraph.setNodeFile('compose', voSummary, false);
            } else if (composedFile) {
                WorkflowGraph.setNodeFile('compose', rt.shortFile(composedFile), false);
            } else {
                WorkflowGraph.setNodeFile('compose', '', true);
            }
        } else if (composedFile) {
            WorkflowGraph.setNodeFile('compose', rt.shortFile(composedFile), false);
        } else if (rawFile) {
            WorkflowGraph.setNodeFile('compose', rt.shortFile(rawFile), false, true);
        } else {
            WorkflowGraph.setNodeFile('compose', '', true);
        }
    
        if (postedFile) {
            WorkflowGraph.setNodeFile('youtube', rt.shortFile(postedFile), false);
        } else if (rt.isComputerWorkflow() && tournamentDone) {
            WorkflowGraph.setNodeFile('youtube', rt.shortFile(composedFile || rt.tournamentMedia.final), false);
        } else if (composedFile) {
            WorkflowGraph.setNodeFile('youtube', rt.shortFile(composedFile), false, true);
        } else {
            WorkflowGraph.setNodeFile('youtube', '', true);
        }
    
        WorkflowGraph.setNodeState('setup', matchupDone ? 'done' : 'active');
    
        if (rt.hasIntroNode()) {
            if (!matchupDone) {
                WorkflowGraph.setNodeState('intro', 'locked');
            } else if (introDone) {
                WorkflowGraph.setNodeState('intro', 'done');
            } else {
                WorkflowGraph.setNodeState('intro', 'active');
            }
        }
    
        if (!pipelineReady) {
            WorkflowGraph.setNodeState('record', 'locked');
        } else if (recordDone && !rt.isComputerWorkflow()) {
            WorkflowGraph.setNodeState('record', 'done');
        } else if (rt.isComputerWorkflow() && matchupDone) {
            WorkflowGraph.setNodeState('record', 'active');
        } else if (recordDone) {
            WorkflowGraph.setNodeState('record', 'done');
        } else {
            WorkflowGraph.setNodeState('record', 'active');
        }
        if (rt.isComputerWorkflow()) {
            WorkflowGraph.setNodeState('bracket', pipelineReady ? 'active' : 'locked');
        }
    
        if (rt.isComputerWorkflow()) {
            if (!pipelineReady) {
                WorkflowGraph.setNodeState('compose', 'locked');
            } else if (composeDone) {
                WorkflowGraph.setNodeState('compose', 'done');
            } else {
                WorkflowGraph.setNodeState('compose', 'active');
            }
        } else if (!rawFile) {
            WorkflowGraph.setNodeState('compose', 'locked');
        } else if (composeDone) {
            WorkflowGraph.setNodeState('compose', 'done');
        } else {
            WorkflowGraph.setNodeState('compose', 'active');
        }
    
        if (rt.isComputerWorkflow()) {
            if (!tournamentDone) {
                WorkflowGraph.setNodeState('youtube', 'locked');
            } else if (youtubeDone) {
                WorkflowGraph.setNodeState('youtube', 'done');
            } else {
                WorkflowGraph.setNodeState('youtube', 'active');
            }
            WorkflowGraph.getNodeEl('youtube')?.classList.remove('is-future');
        } else if (!composedFile && !hasPosted) {
            WorkflowGraph.setNodeState('youtube', 'locked');
        } else if (youtubeDone) {
            WorkflowGraph.setNodeState('youtube', 'done');
        } else {
            WorkflowGraph.setNodeState('youtube', 'active');
        }
    
        if (rt.isFutureNode('compose') && !rt.isComputerWorkflow()) {
            WorkflowGraph.setNodeFile('compose', '', true);
            WorkflowGraph.setNodeState('compose', null);
        }
        if (rt.isFutureNode('youtube') && !rt.isComputerWorkflow()) {
            WorkflowGraph.setNodeFile('youtube', '', true);
            WorkflowGraph.setNodeState('youtube', null);
        }
    
        const introActive = rt.hasIntroNode() && matchupDone && !introDone;
        const recordActive = pipelineReady && !(recordDone && !rt.isComputerWorkflow());
        const composeActive = rt.isComputerWorkflow()
            ? pipelineReady && !rt.busy && !tournamentDone
            : (!rt.isFutureNode('compose') && Boolean(rawFile) && !composeDone);
        const youtubeActive = rt.isComputerWorkflow()
            ? tournamentDone && !hasPosted
            : (!rt.isFutureNode('youtube') && Boolean(composedFile) && !hasPosted);
    
        if (rt.hasIntroNode()) {
            WorkflowGraph.setEdgeProgress('setup', 'intro', matchupDone, introActive);
            WorkflowGraph.setEdgeProgress('intro', 'record', introDone, recordActive && !recordDone);
        } else {
            WorkflowGraph.setEdgeProgress('setup', 'bracket', matchupDone, !tournamentDone && rt.tournamentNodeForPhase() === 'bracket');
            WorkflowGraph.setEdgeProgress('bracket', 'powerup', matchupDone, !tournamentDone && rt.tournamentNodeForPhase() === 'powerup');
            WorkflowGraph.setEdgeProgress('powerup', 'record', matchupDone, !tournamentDone && rt.tournamentNodeForPhase() === 'record');
            WorkflowGraph.setEdgeProgress('record', 'compose', matchupDone, !tournamentDone && rt.tournamentNodeForPhase() === 'compose');
            WorkflowGraph.setEdgeProgress('compose', 'bracket', matchupDone, !tournamentDone && rt.tournamentNodeForPhase() === 'bracket');
            WorkflowGraph.setEdgeProgress('compose', 'youtube', tournamentDone, youtubeActive);
        }
        if (!rt.isComputerWorkflow()) {
            WorkflowGraph.setEdgeProgress('record', 'compose', Boolean(rawFile), composeActive);
            WorkflowGraph.setEdgeProgress('compose', 'youtube', composeDone && !rt.isFutureNode('compose'), youtubeActive);
        }
        WorkflowGraph.setEdgeProgress('compose', 'instagram', composeDone, false);
        WorkflowGraph.setEdgeProgress('compose', 'tiktok', composeDone, false);
    
        const canCompose = Boolean(rawName) && !rt.busy && !rt.isComputerWorkflow();
        const canEditScript = Boolean(rawName) && !rt.busy && !rt.isComputerWorkflow();
        const canPost = rt.isComputerWorkflow()
            ? tournamentDone && Boolean(composedName || rt.tournamentMedia.final) && !rt.busy
            : Boolean(composedName) && !rt.busy;
        const hasRecordVideo = rt.isComputerWorkflow()
            ? rt.isMatchupReady(rt.setupReady)
            : Boolean(rt.videoForNode('record', state));
        const hasComposeVideo = rt.isComputerWorkflow()
            ? ((rt.matchComposeStore?.size || 0) > 0 || Boolean(rt.videoForNode('compose', state)))
            : Boolean(rt.videoForNode('compose', state));
        const hasYoutubeVideo = Boolean(rt.videoForNode('youtube', state));
        const introUnlocked = matchupDone && !rt.busy;
    
        WorkflowGraph.setActionDisabled('setup', 'edit-setup', rt.busy);
        WorkflowGraph.setActionDisabled('setup', 'redo', rt.busy || !rt.canRedoStep('setup', state));
    
        if (rt.hasIntroNode()) {
            WorkflowGraph.setActionDisabled('intro', 'intro-skip', !introUnlocked);
            WorkflowGraph.setActionDisabled('intro', 'intro-default', !introUnlocked);
            WorkflowGraph.setActionDisabled('intro', 'intro-manual', !introUnlocked);
            WorkflowGraph.setActionDisabled('intro', 'redo', rt.busy || !rt.canRedoStep('intro', state));
        }
    
        WorkflowGraph.setActionDisabled('record', 'watch', !hasRecordVideo);
        WorkflowGraph.setActionDisabled('record', 'fast-forward', !pipelineReady || rt.busy);
        WorkflowGraph.setActionDisabled('record', 'open-arena', !pipelineReady || rt.busy);
        WorkflowGraph.setActionDisabled('bracket', 'watch', !hasRecordVideo);
        WorkflowGraph.setActionDisabled('bracket', 'open-bracket', !pipelineReady || rt.busy);
        WorkflowGraph.setActionDisabled('tournament', 'watch', !rt.hasCuratedTournamentVideo() || rt.busy);
        WorkflowGraph.setActionDisabled('tournament', 'preview-step', !pipelineReady || rt.busy);
        WorkflowGraph.setActionDisabled('tournament', 'preview-fast-forward', !pipelineReady || rt.busy);
    
        WorkflowGraph.setActionDisabled('compose', 'watch', !hasComposeVideo);
        WorkflowGraph.setActionDisabled('compose', 'run-compose', !canCompose);
        WorkflowGraph.setActionDisabled('compose', 'edit-script', !canEditScript);
        WorkflowGraph.setActionDisabled('compose', 'reload-script', !canEditScript);
    
        WorkflowGraph.setActionDisabled('youtube', 'watch', !hasYoutubeVideo);
        WorkflowGraph.setActionDisabled('youtube', 'run-upload', !canPost);
        WorkflowGraph.setActionDisabled('youtube', 'edit-caption', !canPost);
        WorkflowGraph.setActionDisabled('youtube', 'reload-caption', !canPost);
    
        WorkflowGraph.setActionDisabled('record', 'redo', rt.busy || !rt.canRedoStep('record', state));
        WorkflowGraph.setActionDisabled('compose', 'redo', rt.busy || !rt.canRedoStep('compose', state));
        WorkflowGraph.setActionDisabled('youtube', 'redo', rt.busy || !rt.canRedoStep('youtube', state));
    
        rt.syncTournamentPhaseState();
        // Pipeline polls must not remount the live tournament loop.
        if (!rt.tournamentLoopIsLive()) rt.showPreview(rt.previewNode);
    }

    rt.refreshPipeline = async function refreshPipeline({ force = false } = {}) {
        if (rt.busy && !force) return;
    
        const epoch = ++rt.pipelineEpoch;
        try {
            const state = await rt.apiGet('/api/pipeline');
            if (epoch !== rt.pipelineEpoch) return;
    
            const prevRaw = rt.pipeline?.active?.raw;
            const prevComposed = rt.pipeline?.active?.composed;
    
            rt.applyTournamentMediaStatus(state.tournament);
            rt.updateUI(state);
    
            if (
                rt.isComputerWorkflow()
                && rt.isLongBracketComplete()
                && !rt.tournamentMedia.finalReady
                && !rt.tournamentMedia.error
                && !rt.busy
            ) {
                rt.stitchTournamentFinal().catch(() => {});
            }
    
            if (state.active.raw && state.active.raw !== prevRaw) {
                rt.log(`detected raw recording: ${state.active.raw}`);
                WorkflowGraph.setNodeStatus('record', 'In raw/', 'success');
                await rt.loadDraftScript(state.active.raw);
                if (epoch === rt.pipelineEpoch && !rt.isComputerWorkflow()) {
                    rt.previewNode = 'record';
                    rt.showPreview('record', { forceReload: true });
                }
            }
    
            if (state.active.composed && state.active.composed !== prevComposed) {
                rt.log(`composed ready: ${state.active.composed}`);
                if (!rt.isComputerWorkflow()) {
                    WorkflowGraph.setNodeStatus('compose', 'In composed/', 'success');
                    rt.previewNode = 'compose';
                    await rt.loadDraftCaption(state.active.composed);
                    if (epoch === rt.pipelineEpoch) {
                        rt.updateUI(rt.pipeline);
                        rt.showPreview('compose', { forceReload: true });
                    }
                } else if (epoch === rt.pipelineEpoch) {
                    rt.syncTournamentPhaseState();
                }
            }
    
            if (rt.els.serverStatus) rt.els.serverStatus.textContent = 'server online';
        } catch (err) {
            if (epoch !== rt.pipelineEpoch) return;
            if (rt.els.serverStatus) rt.els.serverStatus.textContent = 'server offline';
            rt.log(`error: ${err.message} — run python server/workflow_server.py`);
        }
    }

    rt.loadQuota = async function loadQuota() {
        try {
            const data = await rt.apiGet('/api/quota');
            if (rt.els.quotaUploads) rt.els.quotaUploads.textContent = String(data.estimatedUploadsPerDay);
            if (rt.els.quotaBadge) rt.els.quotaBadge.hidden = false;
        } catch {
            /* optional */
        }
    }
}());
