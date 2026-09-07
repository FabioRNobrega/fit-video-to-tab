// Bottom control bar shown only while a video is in fill mode: progress
// scrubber, play/pause, mute, playback speed, standard repeat, A/B loop,
// exit. A peer module to drag.js — attached/detached symmetrically with
// fillTab.js's own enter/exit lifecycle (FD.attachControls/FD.detachControls),
// never running on a video that isn't filled. See
// Specs/20260902151129-fill-mode-control-bar/ and
// Specs/20260903123733-playback-speed-control/. Icons are inline SVG (path
// data from Bootstrap Icons, MIT-licensed) — FD.ICONS is also used by
// content.js/fillTab.js for the floating fill/exit icon button.
(function () {
  const FD = (window.__fdExt = window.__fdExt || {});

  const HIDE_DELAY_MS = 2000;

  FD.ICONS = {
    fullscreen:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5M.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5"/></svg>',
    fullscreenExit:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5m5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5M0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5m10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0z"/></svg>',
    play: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/></svg>',
    pause:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/></svg>',
    markerA:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M11.854 3.646a.5.5 0 0 1 0 .708L8.207 8l3.647 3.646a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 0 1 .708 0M4.5 1a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 1 0v-13a.5.5 0 0 0-.5-.5"/></svg>',
    markerB:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4.146 3.646a.5.5 0 0 0 0 .708L7.793 8l-3.647 3.646a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708 0M11.5 1a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-1 0v-13a.5.5 0 0 1 .5-.5"/></svg>',
    skipBack:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8.354 1.646a.5.5 0 0 1 0 .708L2.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/><path fill-rule="evenodd" d="M12.354 1.646a.5.5 0 0 1 0 .708L6.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/></svg>',
    skipForward:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L13.293 8 7.646 2.354a.5.5 0 0 1 0-.708"/><path fill-rule="evenodd" d="M3.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L9.293 8 3.646 2.354a.5.5 0 0 1 0-.708"/></svg>',
    abLoop:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M5.68 5.792 7.345 7.75 5.681 9.708a2.75 2.75 0 1 1 0-3.916ZM8 6.978 6.416 5.113l-.014-.015a3.75 3.75 0 1 0 0 5.304l.014-.015L8 8.522l1.584 1.865.014.015a3.75 3.75 0 1 0 0-5.304l-.014.015zm.656.772 1.663-1.958a2.75 2.75 0 1 1 0 3.916z"/></svg>',
    clear:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/></svg>',
    repeat:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/><path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/></svg>',
    reset:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/></svg>',
  };

  let styleInjected = false;
  let activeVideo = null;
  let bar = null;
  let rail = null;
  let elements = null;
  let loopMode = "none"; // "none" | "repeat" | "ab"
  let markerA = null;
  let markerB = null;
  let isDraggingScrub = false;
  let hideTimer = null;
  let videoHandlers = null; // { onPlayPause, onTimeUpdate, onDuration, onVolume }
  let controlHandlers = null;

  function injectStyle(shadow) {
    if (styleInjected) return;
    const style = document.createElement("style");
    style.textContent = [
      ".fd-controls {",
      "  position: fixed;",
      "  left: 0;",
      "  right: 0;",
      "  bottom: 0;",
      "  z-index: 2147483647;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 6px;",
      "  padding: 8px 14px 14px;",
      "  background: linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0));",
      "  font: 12px sans-serif;",
      "  opacity: 0;",
      "  pointer-events: none;",
      "  transition: opacity 0.2s ease;",
      "  box-sizing: border-box;",
      "}",
      ".fd-controls.is-visible {",
      "  opacity: 1;",
      "  pointer-events: auto;",
      "}",
      ".fd-scrub-wrap {",
      "  position: relative;",
      "}",
      ".fd-scrub {",
      "  display: block;",
      "  width: 100%;",
      "  margin: 0;",
      "  accent-color: #fff;",
      "}",
      ".fd-marker {",
      "  position: absolute;",
      "  top: 0;",
      "  bottom: 0;",
      "  width: 2px;",
      "  pointer-events: none;",
      "  z-index: 1;",
      "  transform: translateX(-50%);",
      "}",
      ".fd-marker[hidden] {",
      "  display: none;",
      "}",
      ".fd-marker-a {",
      "  background: #2ecc71;",
      "}",
      ".fd-marker-b {",
      "  background: #f1c40f;",
      "}",
      ".fd-controls-row {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 4px;",
      "}",
      ".fd-spacer {",
      "  flex: 1 1 auto;",
      "}",
      ".fd-ctrl-btn {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  width: 28px;",
      "  height: 28px;",
      "  background: transparent;",
      "  border: none;",
      "  color: #fff;",
      "  cursor: pointer;",
      "  border-radius: 4px;",
      "  padding: 0;",
      "  font-size: 14px;",
      "}",
      ".fd-ctrl-btn:hover {",
      "  background: rgba(255, 255, 255, 0.15);",
      "}",
      ".fd-ctrl-btn.is-active {",
      "  background: rgba(255, 255, 255, 0.3);",
      "}",
      ".fd-ctrl-btn[disabled] {",
      "  opacity: 0.35;",
      "  cursor: default;",
      "  pointer-events: none;",
      "}",
      ".fd-ctrl-btn svg {",
      "  width: 16px;",
      "  height: 16px;",
      "}",
      ".fd-speed {",
      "  height: 28px;",
      "  background: transparent;",
      "  border: 1px solid rgba(255, 255, 255, 0.4);",
      "  color: #fff;",
      "  cursor: pointer;",
      "  border-radius: 4px;",
      "  padding: 0 4px;",
      "  font: inherit;",
      "}",
      ".fd-speed:hover {",
      "  background: rgba(255, 255, 255, 0.15);",
      "}",
      ".fd-speed option {",
      "  color: #000;",
      "}",
      ".fd-saturation-rail {",
      "  position: fixed;",
      "  top: 50%;",
      "  right: 12px;",
      "  z-index: 2147483647;",
      "  display: flex;",
      "  flex-direction: column;",
      "  align-items: center;",
      "  gap: 8px;",
      "  width: 38px;",
      "  min-height: 208px;",
      "  padding: 10px 6px;",
      "  background: rgba(0, 0, 0, 0.75);",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  border-radius: 6px;",
      "  color: #fff;",
      "  font: 11px sans-serif;",
      "  opacity: 0;",
      "  pointer-events: none;",
      "  transform: translateY(-50%);",
      "  transition: opacity 0.2s ease;",
      "  box-sizing: border-box;",
      "}",
      ".fd-saturation-rail.is-visible {",
      "  opacity: 1;",
      "  pointer-events: auto;",
      "}",
      ".fd-saturation-range {",
      "  width: 140px;",
      "  margin: 56px 0;",
      "  accent-color: #fff;",
      "  transform: rotate(-90deg);",
      "}",
      ".fd-saturation-value {",
      "  line-height: 1;",
      "  white-space: nowrap;",
      "}",
      ".fd-saturation-reset {",
      "  flex: 0 0 auto;",
      "}",
    ].join("\n");
    shadow.appendChild(style);
    styleInjected = true;
  }

  function durationKnown() {
    return (
      !!activeVideo &&
      Number.isFinite(activeVideo.duration) &&
      activeVideo.duration > 0
    );
  }

  function refreshMarkerAvailability() {
    const known = durationKnown();
    elements.markerA.disabled = !known;
    elements.markerB.disabled = !known;
    elements.skipBack.disabled = !known;
    elements.skipForward.disabled = !known;
  }

  function refreshLoopButtons() {
    const validRange = markerA !== null && markerB !== null && markerA < markerB;
    elements.abLoop.disabled = !validRange;
    elements.clearLoop.disabled = markerA === null && markerB === null;
  }

  function positionMarkerIndicator(el, time) {
    if (time === null || !durationKnown()) {
      el.hidden = true;
      return;
    }
    const pct = Math.min(100, Math.max(0, (time / activeVideo.duration) * 100));
    el.style.left = pct + "%";
    el.hidden = false;
  }

  function refreshMarkerIndicators() {
    positionMarkerIndicator(elements.markerAIndicator, markerA);
    positionMarkerIndicator(elements.markerBIndicator, markerB);
  }

  function setLoopMode(mode) {
    loopMode = mode;
    activeVideo.loop = mode === "repeat";
    elements.repeat.classList.toggle("is-active", mode === "repeat");
    elements.abLoop.classList.toggle("is-active", mode === "ab");
  }

  function toggleRepeat() {
    setLoopMode(loopMode === "repeat" ? "none" : "repeat");
  }

  function toggleAbLoop() {
    if (elements.abLoop.disabled) return;
    setLoopMode(loopMode === "ab" ? "none" : "ab");
  }

  function setMarkerA() {
    if (!durationKnown()) return;
    markerA = activeVideo.currentTime;
    positionMarkerIndicator(elements.markerAIndicator, markerA);
    refreshLoopButtons();
  }

  function setMarkerB() {
    if (!durationKnown()) return;
    markerB = activeVideo.currentTime;
    positionMarkerIndicator(elements.markerBIndicator, markerB);
    refreshLoopButtons();
  }

  function clearLoopPoints() {
    markerA = null;
    markerB = null;
    elements.markerAIndicator.hidden = true;
    elements.markerBIndicator.hidden = true;
    if (loopMode === "ab") setLoopMode("none");
    refreshLoopButtons();
  }

  function updatePlayPauseIcon() {
    const paused = activeVideo.paused;
    elements.playPause.innerHTML = paused ? FD.ICONS.play : FD.ICONS.pause;
    elements.playPause.setAttribute("aria-label", paused ? "Play" : "Pause");
  }

  function updateMuteIcon() {
    elements.mute.textContent = activeVideo.muted ? "🔇" : "🔊";
  }

  function updateSpeedSelect() {
    elements.speed.value = String(activeVideo.playbackRate);
  }

  function syncDuration() {
    const known = durationKnown();
    elements.scrub.max = known ? activeVideo.duration : 0;
    elements.scrub.disabled = !known;
    refreshMarkerAvailability();
    refreshMarkerIndicators();
  }

  function onTimeUpdate() {
    if (!isDraggingScrub) elements.scrub.value = activeVideo.currentTime;
    if (loopMode === "ab" && markerB !== null && activeVideo.currentTime >= markerB) {
      activeVideo.currentTime = markerA;
    }
  }

  function showBar() {
    bar.classList.add("is-visible");
    if (rail) rail.classList.add("is-visible");
  }

  function hideBar() {
    bar.classList.remove("is-visible");
    if (rail) rail.classList.remove("is-visible");
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!isDraggingScrub) hideBar();
    }, HIDE_DELAY_MS);
  }

  function onActivity() {
    showBar();
    scheduleHide();
  }

  function buildBar(shadow) {
    const el = document.createElement("div");
    el.className = "fd-controls";
    el.innerHTML = [
      '<div class="fd-scrub-wrap">',
      '<span class="fd-marker fd-marker-a" data-fd-role="marker-a-indicator" hidden></span>',
      '<span class="fd-marker fd-marker-b" data-fd-role="marker-b-indicator" hidden></span>',
      '<input type="range" class="fd-scrub" data-fd-role="scrub" min="0" max="0" step="0.01" value="0" aria-label="Playback position" />',
      "</div>",
      '<div class="fd-controls-row">',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="play-pause" aria-label="Play"></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="mute" aria-label="Mute"></button>',
      '<select class="fd-speed" data-fd-role="speed" aria-label="Playback speed">',
      '<option value="0.25">0.25x</option>',
      '<option value="0.5">0.5x</option>',
      '<option value="0.7">0.7x</option>',
      '<option value="0.8">0.8x</option>',
      '<option value="0.9">0.9x</option>',
      '<option value="1" selected>1x</option>',
      '<option value="1.1">1.1x</option>',
      '<option value="1.2">1.2x</option>',
      '<option value="1.3">1.3x</option>',
      '<option value="1.5">1.5x</option>',
      '<option value="2">2x</option>',
      "</select>",
      '<button type="button" class="fd-ctrl-btn" data-fd-role="skip-back" aria-label="Back 10 seconds" disabled></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="skip-forward" aria-label="Forward 10 seconds" disabled></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="repeat" aria-label="Repeat current video"></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="marker-a" aria-label="Set point A" disabled></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="marker-b" aria-label="Set point B" disabled></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="ab-loop" aria-label="Loop between A and B" disabled></button>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="clear-loop" aria-label="Clear loop points" disabled></button>',
      '<span class="fd-spacer"></span>',
      '<button type="button" class="fd-ctrl-btn" data-fd-role="exit" aria-label="Exit fill mode"></button>',
      "</div>",
    ].join("");
    shadow.appendChild(el);
    return el;
  }

  function buildSaturationRail(shadow) {
    const el = document.createElement("div");
    el.className = "fd-saturation-rail";
    el.setAttribute("data-fd-role", "saturation-rail");
    el.innerHTML = [
      '<button type="button" class="fd-ctrl-btn fd-saturation-reset" data-fd-role="saturation-reset" aria-label="Reset saturation" title="Reset saturation"></button>',
      '<input type="range" class="fd-saturation-range" data-fd-role="saturation" min="0" max="300" step="1" value="100" aria-label="Saturation" />',
      '<span class="fd-saturation-value" data-fd-role="saturation-value">100%</span>',
    ].join("");
    shadow.appendChild(el);
    return el;
  }

  function attachControls(video, controls) {
    if (activeVideo === video) return;
    if (activeVideo) detachControls(activeVideo);

    const shadow = controls && controls.shadowRoot;
    if (!shadow) return;

    injectStyle(shadow);

    activeVideo = video;
    loopMode = "none";
    markerA = null;
    markerB = null;
    isDraggingScrub = false;
    video.playbackRate = 1;
    video.style.filter = "saturate(100%)";
    video.muted = true;

    bar = buildBar(shadow);
    rail = buildSaturationRail(shadow);
    elements = {
      scrub: bar.querySelector('[data-fd-role="scrub"]'),
      markerAIndicator: bar.querySelector('[data-fd-role="marker-a-indicator"]'),
      markerBIndicator: bar.querySelector('[data-fd-role="marker-b-indicator"]'),
      playPause: bar.querySelector('[data-fd-role="play-pause"]'),
      mute: bar.querySelector('[data-fd-role="mute"]'),
      speed: bar.querySelector('[data-fd-role="speed"]'),
      skipBack: bar.querySelector('[data-fd-role="skip-back"]'),
      skipForward: bar.querySelector('[data-fd-role="skip-forward"]'),
      repeat: bar.querySelector('[data-fd-role="repeat"]'),
      markerA: bar.querySelector('[data-fd-role="marker-a"]'),
      markerB: bar.querySelector('[data-fd-role="marker-b"]'),
      abLoop: bar.querySelector('[data-fd-role="ab-loop"]'),
      clearLoop: bar.querySelector('[data-fd-role="clear-loop"]'),
      exit: bar.querySelector('[data-fd-role="exit"]'),
      saturationReset: rail.querySelector('[data-fd-role="saturation-reset"]'),
      saturation: rail.querySelector('[data-fd-role="saturation"]'),
      saturationValue: rail.querySelector('[data-fd-role="saturation-value"]'),
    };

    elements.repeat.innerHTML = FD.ICONS.repeat;
    elements.skipBack.innerHTML = FD.ICONS.skipBack;
    elements.skipForward.innerHTML = FD.ICONS.skipForward;
    elements.markerA.innerHTML = FD.ICONS.markerA;
    elements.markerB.innerHTML = FD.ICONS.markerB;
    elements.abLoop.innerHTML = FD.ICONS.abLoop;
    elements.clearLoop.innerHTML = FD.ICONS.clear;
    elements.exit.innerHTML = FD.ICONS.fullscreenExit;
    elements.saturationReset.innerHTML = FD.ICONS.reset;
    updatePlayPauseIcon();
    updateMuteIcon();
    updateSpeedSelect();
    elements.saturation.value = "100";
    elements.saturationValue.textContent = "100%";
    syncDuration();
    refreshLoopButtons();

    videoHandlers = {
      onPlayPause: updatePlayPauseIcon,
      onVolume: updateMuteIcon,
      onRateChange: updateSpeedSelect,
      onTimeUpdate,
      onDuration: syncDuration,
    };
    video.addEventListener("play", videoHandlers.onPlayPause);
    video.addEventListener("pause", videoHandlers.onPlayPause);
    video.addEventListener("volumechange", videoHandlers.onVolume);
    video.addEventListener("ratechange", videoHandlers.onRateChange);
    video.addEventListener("timeupdate", videoHandlers.onTimeUpdate);
    video.addEventListener("loadedmetadata", videoHandlers.onDuration);
    video.addEventListener("durationchange", videoHandlers.onDuration);

    video.addEventListener("pointermove", onActivity);
    video.addEventListener("mousemove", onActivity);
    bar.addEventListener("pointermove", onActivity);
    bar.addEventListener("mousemove", onActivity);
    bar.addEventListener("pointerenter", onActivity);
    bar.addEventListener("pointerleave", scheduleHide);
    rail.addEventListener("pointermove", onActivity);
    rail.addEventListener("mousemove", onActivity);
    rail.addEventListener("pointerenter", onActivity);
    rail.addEventListener("pointerleave", scheduleHide);

    controlHandlers = {
      onScrubPointerDown: () => {
        isDraggingScrub = true;
        clearTimeout(hideTimer);
        showBar();
      },
      onScrubInput: () => {
        video.currentTime = Number(elements.scrub.value);
      },
      onScrubEnd: () => {
        if (!isDraggingScrub) return;
        isDraggingScrub = false;
        scheduleHide();
      },
      onPlayPauseClick: () => {
        if (video.paused) video.play();
        else video.pause();
      },
      onMuteClick: () => {
        video.muted = !video.muted;
      },
      onSpeedChange: () => {
        video.playbackRate = Number(elements.speed.value);
      },
      onSkipBackClick: () => {
        video.currentTime = Math.max(0, video.currentTime - 10);
      },
      onSkipForwardClick: () => {
        video.currentTime = durationKnown()
          ? Math.min(video.duration, video.currentTime + 10)
          : video.currentTime + 10;
      },
      onSaturationInput: () => {
        const value = elements.saturation.value;
        video.style.filter = "saturate(" + value + "%)";
        elements.saturationValue.textContent = value + "%";
      },
      onSaturationResetClick: () => {
        elements.saturation.value = "100";
        controlHandlers.onSaturationInput();
      },
      onExitClick: () => {
        if (controls.onExit) controls.onExit();
      },
    };

    elements.scrub.addEventListener("pointerdown", controlHandlers.onScrubPointerDown);
    elements.scrub.addEventListener("input", controlHandlers.onScrubInput);
    elements.scrub.addEventListener("pointerup", controlHandlers.onScrubEnd);
    elements.scrub.addEventListener("pointercancel", controlHandlers.onScrubEnd);
    elements.playPause.addEventListener("click", controlHandlers.onPlayPauseClick);
    elements.mute.addEventListener("click", controlHandlers.onMuteClick);
    elements.speed.addEventListener("change", controlHandlers.onSpeedChange);
    elements.skipBack.addEventListener("click", controlHandlers.onSkipBackClick);
    elements.skipForward.addEventListener("click", controlHandlers.onSkipForwardClick);
    elements.repeat.addEventListener("click", toggleRepeat);
    elements.markerA.addEventListener("click", setMarkerA);
    elements.markerB.addEventListener("click", setMarkerB);
    elements.abLoop.addEventListener("click", toggleAbLoop);
    elements.clearLoop.addEventListener("click", clearLoopPoints);
    elements.saturation.addEventListener("input", controlHandlers.onSaturationInput);
    elements.saturationReset.addEventListener(
      "click",
      controlHandlers.onSaturationResetClick
    );
    // The exit action is caller-supplied (controls.onExit) rather than
    // hardcoded to FD.toggleFill, since fillControls.js is also reused by
    // redditFill.js's embed-iframe frame, where FD.toggleFill (fillTab.js)
    // isn't loaded at all — see extension/redditFill.js.
    elements.exit.addEventListener("click", controlHandlers.onExitClick);
  }

  function detachControls(video) {
    if (activeVideo !== video) return;

    clearTimeout(hideTimer);
    hideTimer = null;

    video.removeEventListener("play", videoHandlers.onPlayPause);
    video.removeEventListener("pause", videoHandlers.onPlayPause);
    video.removeEventListener("volumechange", videoHandlers.onVolume);
    video.removeEventListener("ratechange", videoHandlers.onRateChange);
    video.removeEventListener("timeupdate", videoHandlers.onTimeUpdate);
    video.removeEventListener("loadedmetadata", videoHandlers.onDuration);
    video.removeEventListener("durationchange", videoHandlers.onDuration);
    video.removeEventListener("pointermove", onActivity);
    video.removeEventListener("mousemove", onActivity);

    bar.removeEventListener("pointermove", onActivity);
    bar.removeEventListener("mousemove", onActivity);
    bar.removeEventListener("pointerenter", onActivity);
    bar.removeEventListener("pointerleave", scheduleHide);
    rail.removeEventListener("pointermove", onActivity);
    rail.removeEventListener("mousemove", onActivity);
    rail.removeEventListener("pointerenter", onActivity);
    rail.removeEventListener("pointerleave", scheduleHide);
    elements.scrub.removeEventListener("pointerdown", controlHandlers.onScrubPointerDown);
    elements.scrub.removeEventListener("input", controlHandlers.onScrubInput);
    elements.scrub.removeEventListener("pointerup", controlHandlers.onScrubEnd);
    elements.scrub.removeEventListener("pointercancel", controlHandlers.onScrubEnd);
    elements.playPause.removeEventListener("click", controlHandlers.onPlayPauseClick);
    elements.mute.removeEventListener("click", controlHandlers.onMuteClick);
    elements.speed.removeEventListener("change", controlHandlers.onSpeedChange);
    elements.skipBack.removeEventListener("click", controlHandlers.onSkipBackClick);
    elements.skipForward.removeEventListener("click", controlHandlers.onSkipForwardClick);
    elements.repeat.removeEventListener("click", toggleRepeat);
    elements.markerA.removeEventListener("click", setMarkerA);
    elements.markerB.removeEventListener("click", setMarkerB);
    elements.abLoop.removeEventListener("click", toggleAbLoop);
    elements.clearLoop.removeEventListener("click", clearLoopPoints);
    elements.saturation.removeEventListener("input", controlHandlers.onSaturationInput);
    elements.saturationReset.removeEventListener(
      "click",
      controlHandlers.onSaturationResetClick
    );
    elements.exit.removeEventListener("click", controlHandlers.onExitClick);

    video.loop = false;
    video.style.filter = "";

    bar.remove();
    bar = null;
    rail.remove();
    rail = null;
    elements = null;
    videoHandlers = null;
    controlHandlers = null;
    activeVideo = null;
    loopMode = "none";
    markerA = null;
    markerB = null;
    isDraggingScrub = false;
  }

  FD.attachControls = attachControls;
  FD.detachControls = detachControls;
})();
