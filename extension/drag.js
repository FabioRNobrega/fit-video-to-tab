// Horizontal drag-to-reposition for whichever single video is currently in
// fill mode. Ported conceptually (not literally) from
// home/deck/Documents/Projects/video-manager's VideoFrameState.ApplyDrag +
// VerticalVideoEditor.razor's pointer wiring, restricted to the horizontal
// axis — see Specs/20260902121618-drag-to-reposition-fill-video/. Only ever
// live while a video is filled: fillTab.js calls attachDrag/detachDrag
// symmetrically with its own enter/exit lifecycle.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});

  const DRAG_THRESHOLD = 6;

  let styleInjected = false;
  let activeVideo = null;
  let session = null; // { pointerId, startClientX, startPositionX, viewportWidth, viewportHeight, videoWidth, videoHeight, hasMoved }

  function injectCursorStyle() {
    if (styleInjected) return;
    const style = document.createElement("style");
    style.textContent = [
      ".fd-fill-active {",
      "  cursor: grab;",
      "}",
      ".fd-fill-active.fd-dragging {",
      "  cursor: grabbing;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
    styleInjected = true;
  }

  function currentPositionX(video) {
    const raw = video.style.objectPosition;
    if (!raw) return 50;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 50;
  }

  function onPointerDown(event) {
    const video = event.currentTarget;
    if (!event.isPrimary || session) return;
    if (!video.videoWidth || !video.videoHeight) return;

    const rect = video.getBoundingClientRect();
    session = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startPositionX: currentPositionX(video),
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      hasMoved: false,
    };
    try {
      video.setPointerCapture(event.pointerId);
    } catch (err) {
      // Ignore — capture is a best-effort reliability aid, not required.
    }
  }

  function onPointerMove(event) {
    const video = event.currentTarget;
    if (!session || session.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - session.startClientX;
    if (!session.hasMoved) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
      session.hasMoved = true;
      video.classList.add("fd-dragging");
    }

    const scale = Math.max(
      session.viewportWidth / session.videoWidth,
      session.viewportHeight / session.videoHeight
    );
    const overflowX = Math.max(0, session.videoWidth * scale - session.viewportWidth);

    const newPositionX =
      overflowX > 0
        ? Math.min(100, Math.max(0, session.startPositionX - (deltaX / overflowX) * 100))
        : session.startPositionX;

    video.style.objectPosition = newPositionX.toFixed(2) + "% 50%";
  }

  function endSession(event) {
    const video = event.currentTarget;
    if (!session || session.pointerId !== event.pointerId) return;

    try {
      video.releasePointerCapture(event.pointerId);
    } catch (err) {
      // Ignore — pointer may already be released (e.g. pointercancel).
    }
    video.classList.remove("fd-dragging");
    session = null;
  }

  function attachDrag(video) {
    if (activeVideo === video) return;
    if (activeVideo) detachDrag(activeVideo);

    injectCursorStyle();
    video.addEventListener("pointerdown", onPointerDown);
    video.addEventListener("pointermove", onPointerMove);
    video.addEventListener("pointerup", endSession);
    video.addEventListener("pointercancel", endSession);
    video.addEventListener("pointerleave", endSession);
    activeVideo = video;
  }

  function detachDrag(video) {
    if (activeVideo !== video) return;

    video.removeEventListener("pointerdown", onPointerDown);
    video.removeEventListener("pointermove", onPointerMove);
    video.removeEventListener("pointerup", endSession);
    video.removeEventListener("pointercancel", endSession);
    video.removeEventListener("pointerleave", endSession);
    video.classList.remove("fd-dragging");
    session = null;
    activeVideo = null;
  }

  FD.attachDrag = attachDrag;
  FD.detachDrag = detachDrag;
})();
