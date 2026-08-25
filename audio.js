/* ===== 42 — Sitewide Persistent Audio Playlist =====
   Loaded exactly ONCE per real page load (pjax.js swaps page content
   via fetch() without ever reloading the document, so this script —
   and the single `audioEngine` Audio object it creates — survives
   every internal navigation untouched. That's what makes playback
   genuinely continuous instead of restarting per page.

   Exposes window.Audio42.reinitWidgets(), which pjax.js calls after
   every content swap to rebind the (freshly swapped-in) widget button
   to this same persistent engine and reflect its current state. */
(function () {
    var TRACKS = ['assets/bg-audio.mp3', 'assets/bg-audio-2.mp3'];
    var STORAGE_KEY = 'audio42State';

    function loadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { trackIndex: 0, currentTime: 0, isOn: true };
            var parsed = JSON.parse(raw);
            return {
                trackIndex: (typeof parsed.trackIndex === 'number' && TRACKS[parsed.trackIndex]) ? parsed.trackIndex : 0,
                currentTime: typeof parsed.currentTime === 'number' ? parsed.currentTime : 0,
                isOn: parsed.isOn !== false
            };
        } catch (e) {
            return { trackIndex: 0, currentTime: 0, isOn: true };
        }
    }

    var state = loadState();
    var audioEngine = new Audio(TRACKS[state.trackIndex]);
    audioEngine.volume = 0.6;

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                trackIndex: state.trackIndex,
                currentTime: audioEngine.currentTime || 0,
                isOn: state.isOn
            }));
        } catch (e) { /* storage unavailable (private mode etc.) */ }
    }

    if (state.currentTime > 0) {
        audioEngine.addEventListener('loadedmetadata', function () {
            if (state.currentTime < audioEngine.duration) {
                audioEngine.currentTime = state.currentTime;
            }
        }, { once: true });
    }

    audioEngine.addEventListener('ended', function () {
        state.trackIndex = (state.trackIndex + 1) % TRACKS.length;
        audioEngine.src = TRACKS[state.trackIndex];
        audioEngine.currentTime = 0;
        saveState();
        if (state.isOn) tryPlay();
    });

    function tryPlay() {
        var p = audioEngine.play();
        if (p && p.catch) p.catch(function () { /* blocked until a user gesture */ });
    }

    function applyWidgetUI() {
        document.querySelectorAll('.audio-widget').forEach(function (w) {
            w.classList.toggle('off', !state.isOn);
            var label = w.querySelector('.audio-label');
            if (label) label.textContent = state.isOn ? 'Audio: On' : 'Audio: Off';
        });
    }

    function setAudioState(on) {
        state.isOn = on;
        applyWidgetUI();
        if (on) {
            tryPlay();
        } else {
            audioEngine.pause();
        }
        saveState();
    }

    // Re-binds click handlers on whatever .audio-widget button currently
    // exists in the DOM. Safe to call repeatedly (every pjax swap) since
    // it always targets the current node, not a stale reference.
    function reinitWidgets() {
        applyWidgetUI();
        document.querySelectorAll('.audio-widget').forEach(function (w) {
            w.onclick = function () { setAudioState(!state.isOn); };
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reinitWidgets);
    } else {
        reinitWidgets();
    }

    // Desktop and mobile both follow the same browser autoplay policy:
    // sound can only start from a real user gesture (click/tap), so we
    // arm playback on the first pointerdown anywhere on the page.
    function firstGestureStart() {
        if (state.isOn) tryPlay();
        document.removeEventListener('pointerdown', firstGestureStart);
    }
    document.addEventListener('pointerdown', firstGestureStart);

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            audioEngine.pause();
        } else if (state.isOn) {
            tryPlay();
        }
    });

    window.addEventListener('pagehide', saveState);
    setInterval(saveState, 2000); // periodic checkpoint as a pagehide fallback

    window.Audio42 = { reinitWidgets: reinitWidgets };
})();
