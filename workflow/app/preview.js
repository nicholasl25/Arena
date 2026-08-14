/**
 * Workflow app — Preview panel (video/bracket/arena).
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.clearPreviewVideo = function clearPreviewVideo() {
        const video = rt.els.previewVideo;
        if (!video) return;
        video.pause();
        video.removeAttribute('src');
        delete video.dataset.src;
        video.load();
        video.hidden = true;
    }

    rt.hasCuratedTournamentVideo = function hasCuratedTournamentVideo() {
        return Boolean(
            rt.tournamentMedia.finalReady
            || rt.tournamentMedia.previewReady
            || rt.tournamentMedia.doneSegmentCount > 0
            || (rt.matchComposeStore?.size || 0) > 0
        );
    }

    rt.playCuratedVideo = function playCuratedVideo(url, label) {
        rt.stopBracketPreview();
        if (rt.els.previewEmpty) rt.els.previewEmpty.hidden = true;
        if (rt.els.previewFile) rt.els.previewFile.textContent = label || 'Tournament so far';
        const video = rt.els.previewVideo;
        if (!video) return;
        video.hidden = false;
        video.dataset.src = url;
        video.src = url;
        video.load();
        rt.playPreviewWhenReady(video);
    }

    rt.previewTournamentVideo = async function previewTournamentVideo({ autoplay = true } = {}) {
        if (!rt.isComputerWorkflow()) return;
        if (!rt.hasCuratedTournamentVideo()) {
            rt.stopBracketPreview();
            rt.clearPreviewVideo();
            if (rt.els.previewLabel) rt.els.previewLabel.textContent = 'Tournament preview';
            if (rt.els.previewFile) rt.els.previewFile.textContent = 'No curated video yet';
            if (rt.els.previewEmpty) {
                rt.els.previewEmpty.hidden = false;
                rt.els.previewEmpty.textContent = 'Step a match first — preview plays the long video as segments land.';
            }
            rt.log('no curated tournament segments yet');
            return;
        }
        rt.previewNode = 'tournament';
        if (rt.els.previewLabel) rt.els.previewLabel.textContent = 'Tournament preview';
        document.querySelectorAll('.wf-node').forEach((n) => {
            n.classList.toggle('is-previewing', false);
        });
        WorkflowGraph.getGroupEl?.('tournament')?.classList.add('is-previewing');
        rt.setBusy(true);
        rt.log('building tournament video so far…');
        try {
            const result = await rt.apiPost('/api/tournament/preview', {});
            rt.applyTournamentMediaStatus(result.pipeline?.tournament);
            const count = Number(result.segmentCount) || rt.tournamentMedia.doneSegmentCount || 0;
            const bust = `?t=${Date.now()}`;
            const url = `${result.url || `/recordings/composed/${result.preview}`}${bust}`;
            rt.playCuratedVideo(url, result.final
                ? (result.preview || 'tournament-final.mp4')
                : `${count} match${count === 1 ? '' : 'es'} so far`);
            if (!autoplay && rt.els.previewVideo) rt.els.previewVideo.pause();
            rt.log(result.final
                ? `playing final · ${result.preview}`
                : `playing ${count} curated match${count === 1 ? '' : 'es'}`);
        } catch (err) {
            rt.log(err.message || 'Could not build tournament preview');
            if (rt.els.previewFile) rt.els.previewFile.textContent = 'Preview failed';
        } finally {
            rt.setBusy(false);
        }
    }

    rt.playPreviewWhenReady = function playPreviewWhenReady(video) {
        if (!video || video.hidden) return;
        const tryPlay = () => {
            video.play().catch(() => {});
        };
        if (video.readyState >= 2) {
            tryPlay();
            return;
        }
        video.addEventListener('canplay', tryPlay, { once: true });
    }

    rt.showPreview = function showPreview(nodeId, { forceReload = false, autoplay = false } = {}) {
        rt.previewNode = nodeId;
        const label = rt.nodeLabel(nodeId);
    
        if (rt.els.previewLabel) rt.els.previewLabel.textContent = `${label} preview`;
    
        document.querySelectorAll('.wf-node').forEach((n) => {
            n.classList.toggle('is-previewing', n.dataset.id === nodeId);
        });
        WorkflowGraph.getGroupEl?.('tournament')?.classList.toggle('is-previewing', nodeId === 'tournament');
    
        if (rt.isComputerWorkflow() && nodeId === 'tournament') {
            rt.previewTournamentVideo({ autoplay });
            return;
        }
    
        // Long YouTube: live Arena → Bracket → Voice Over demo in the preview pane.
        if (rt.isComputerWorkflow() && (nodeId === 'record' || nodeId === 'bracket' || nodeId === 'compose' || nodeId === 'setup' || nodeId === 'powerup')) {
            const view = nodeId === 'record' ? 'arena' : (nodeId === 'bracket' || nodeId === 'compose' || nodeId === 'powerup' ? 'bracket' : null);
            if (rt.isMatchupReady(rt.setupReady) && rt.startBracketPreview({ force: forceReload, view, run: false })) {
                rt.syncTournamentPhaseState();
                return;
            }
            rt.stopBracketPreview();
            rt.clearPreviewVideo();
            if (rt.els.previewFile) rt.els.previewFile.textContent = 'Save fighters to build the bracket';
            if (rt.els.previewEmpty) {
                rt.els.previewEmpty.hidden = false;
                rt.els.previewEmpty.textContent = 'Save a fighter matchup to preview the bracket tournament loop.';
            }
            return;
        }
    
        rt.stopBracketPreview();
        const clip = rt.videoForNode(nodeId, rt.pipeline);
    
        if (!clip) {
            if (rt.els.previewFile) rt.els.previewFile.textContent = 'No video yet';
            rt.clearPreviewVideo();
            if (rt.els.previewEmpty) {
                rt.els.previewEmpty.hidden = false;
                rt.els.previewEmpty.textContent = 'Record a fight in the arena to preview here.';
            }
            return;
        }
    
        if (rt.els.previewFile) rt.els.previewFile.textContent = clip.name;
        if (rt.els.previewEmpty) rt.els.previewEmpty.hidden = true;
        if (rt.els.previewVideo) {
            const video = rt.els.previewVideo;
            video.hidden = false;
            const missingSrc = !video.getAttribute('src');
            if (forceReload || missingSrc || video.dataset.src !== clip.url) {
                video.dataset.src = clip.url;
                video.src = clip.url;
                video.load();
            }
            if (autoplay) rt.playPreviewWhenReady(video);
        }
    }
}());
