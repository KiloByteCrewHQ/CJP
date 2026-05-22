/* ============================================================
   main.js — landing page menu logic.
   Handles difficulty selection, sound toggle, the Start button,
   and persists the player's preferences in localStorage.
   ============================================================ */

(function () {
  "use strict";

  var STORE_LEVEL = "ck_level";
  var STORE_SOUND = "ck_sound";

  // --- element refs ---
  var startBtn = document.getElementById("startBtn");
  var soundToggle = document.getElementById("soundToggle");
  var levelButtons = document.querySelectorAll(".level-btn");
  var overlay = document.getElementById("overlay");
  var overlayLevel = document.getElementById("overlayLevel");
  var overlayClose = document.getElementById("overlayClose");

  // --- game state ---
  var state = {
    level: localStorage.getItem(STORE_LEVEL) || "medium",
    sound: localStorage.getItem(STORE_SOUND) !== "off", // default ON
  };

  /* ---------- difficulty ---------- */
  function applyLevel(level) {
    state.level = level;
    localStorage.setItem(STORE_LEVEL, level);
    levelButtons.forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.level === level);
    });
  }

  levelButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyLevel(btn.dataset.level);
      GameAudio.select();
    });
    btn.addEventListener("mouseenter", function () {
      if (!btn.classList.contains("is-active")) GameAudio.hover();
    });
  });

  /* ---------- sound toggle ---------- */
  function applySound(on) {
    state.sound = on;
    GameAudio.setEnabled(on);
    localStorage.setItem(STORE_SOUND, on ? "on" : "off");
    soundToggle.classList.toggle("is-on", on);
    soundToggle.setAttribute("aria-pressed", String(on));
    soundToggle.querySelector(".sound-toggle__icon").textContent = on ? "🔊" : "🔇";
    soundToggle.querySelector(".sound-toggle__text").textContent = on ? "On" : "Off";
  }

  soundToggle.addEventListener("click", function () {
    var next = !state.sound;
    applySound(next);
    if (next) GameAudio.on();
    else GameAudio.off(); // GameAudio.off() still plays so the user hears the toggle
  });

  /* ---------- start game ---------- */
  function openOverlay() {
    overlayLevel.textContent =
      state.level.charAt(0).toUpperCase() + state.level.slice(1);
    overlay.hidden = false;
    overlayClose.focus();
  }

  function closeOverlay() {
    overlay.hidden = true;
    startBtn.focus();
  }

  startBtn.addEventListener("click", function () {
    GameAudio.start();
    openOverlay();
    // Placeholder for the next milestone: this is where the Phaser
    // game scene will be launched once gameplay is built.
    console.log("[Cockroach Knockout] Start — difficulty:", state.level);
  });
  startBtn.addEventListener("mouseenter", function () { GameAudio.hover(); });

  overlayClose.addEventListener("click", function () {
    GameAudio.click();
    closeOverlay();
  });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.hidden) closeOverlay();
  });

  /* ---------- generic button click feedback ---------- */
  document.querySelectorAll(".sound-toggle, .level-btn").forEach(function (el) {
    el.addEventListener("mousedown", function () {
      // hover/select sounds already cover these; keeps interactions lively
    });
  });

  /* ---------- init from saved prefs ---------- */
  applyLevel(state.level);
  applySound(state.sound);
})();
