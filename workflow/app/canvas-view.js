/**
 * Workflow app — Canvas zoom/pan.
 * Extends window.WorkflowRuntime.
 */
(function () {
    'use strict';

    const rt = window.WorkflowRuntime;
    if (!rt) throw new Error('WorkflowRuntime missing — load state.js first');

    rt.clampCanvasScale = function clampCanvasScale(scale) {
        return Math.min(rt.canvasView.maxScale, Math.max(rt.canvasView.minScale, scale));
    }

    rt.applyCanvasView = function applyCanvasView() {
        if (!rt.els.canvas) return;
        rt.els.canvas.style.transform = `translate(${rt.canvasView.x}px, ${rt.canvasView.y}px) scale(${rt.canvasView.scale})`;
        if (rt.els.canvasWrap) {
            const size = rt.canvasView.dot * rt.canvasView.scale;
            rt.els.canvasWrap.style.backgroundSize = `${size}px ${size}px`;
            rt.els.canvasWrap.style.backgroundPosition = `${rt.canvasView.x}px ${rt.canvasView.y}px`;
        }
    }

    rt.resetCanvasView = function resetCanvasView() {
        rt.canvasView.x = 0;
        rt.canvasView.y = 0;
        rt.canvasView.scale = 1;
        rt.applyCanvasView();
    }

    rt.zoomCanvasAt = function zoomCanvasAt(nextScale, pivotX, pivotY) {
        const wrap = rt.els.canvasWrap;
        if (!wrap) return;
        const prev = rt.canvasView.scale;
        const scale = rt.clampCanvasScale(nextScale);
        if (scale === prev) return;
        const rect = wrap.getBoundingClientRect();
        const px = pivotX == null ? rect.width / 2 : pivotX;
        const py = pivotY == null ? rect.height / 2 : pivotY;
        rt.canvasView.x = px - (px - rt.canvasView.x) * (scale / prev);
        rt.canvasView.y = py - (py - rt.canvasView.y) * (scale / prev);
        rt.canvasView.scale = scale;
        rt.applyCanvasView();
    }

    rt.zoomCanvasBy = function zoomCanvasBy(factor) {
        rt.zoomCanvasAt(rt.canvasView.scale * factor);
    }

    rt.bindCanvasViewport = function bindCanvasViewport() {
        const wrap = rt.els.canvasWrap;
        if (!wrap || !rt.els.canvas) return;
    
        rt.applyCanvasView();
    
        wrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Pinch (ctrl/meta) or plain wheel both zoom toward cursor.
            const rect = wrap.getBoundingClientRect();
            const factor = Math.exp(-e.deltaY * 0.0015);
            rt.zoomCanvasAt(rt.canvasView.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
        }, { passive: false });
    
        let panning = false;
        let panPointerId = null;
        let lastX = 0;
        let lastY = 0;
        let spaceDown = false;
    
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Space' || e.repeat) return;
            if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            spaceDown = true;
            wrap.classList.add('is-pan-ready');
            e.preventDefault();
        });
        window.addEventListener('keyup', (e) => {
            if (e.code !== 'Space') return;
            spaceDown = false;
            wrap.classList.remove('is-pan-ready');
        });
    
        wrap.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.wf-act-btn, .workflow-actions, input, textarea, select, button')) return;
            const onChrome = e.target.closest('.wf-node-card, .wf-group-head');
            const canPan = e.button === 1
                || (e.button === 0 && (spaceDown || !onChrome));
            if (!canPan) return;
            e.preventDefault();
            panning = true;
            panPointerId = e.pointerId;
            lastX = e.clientX;
            lastY = e.clientY;
            wrap.classList.add('is-panning');
            try {
                wrap.setPointerCapture(e.pointerId);
            } catch { /* ignore */ }
        });
    
        wrap.addEventListener('auxclick', (e) => {
            // Stop middle-click autoscroll / open-in-new-tab on the board.
            if (e.button === 1) e.preventDefault();
        });
    
        wrap.addEventListener('pointermove', (e) => {
            if (!panning || e.pointerId !== panPointerId) return;
            rt.canvasView.x += e.clientX - lastX;
            rt.canvasView.y += e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            rt.applyCanvasView();
        });
    
        const endPan = (e) => {
            if (!panning || (e && e.pointerId !== panPointerId)) return;
            panning = false;
            panPointerId = null;
            wrap.classList.remove('is-panning');
        };
        wrap.addEventListener('pointerup', endPan);
        wrap.addEventListener('pointercancel', endPan);
        wrap.addEventListener('lostpointercapture', endPan);
    }
}());
