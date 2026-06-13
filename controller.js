// Memoko demo controller — a faithful, trimmed port of src/content/ui/pill.ts
// that runs outside the extension. It builds the shadow-DOM pill, then layers
// on the three new features: idle behaviors, the Konami easter egg, and the
// lifetime stats footer. Exposes window.MemokoDemo.init(opts) -> control API.
(function () {
  'use strict';

  var SPRITE_SIZE = 30;
  var STATE_LABEL = { fresh: 'Fresh', healthy: 'Healthy', heavy: 'Heavy', critical: 'Critical' };
  var STATS_KEY = 'memoko-demo-stats-v1';

  // HP thresholds mirror src/core/health.ts ordering (fresh→critical).
  function stateForHp(hp) {
    if (hp >= 80) return 'fresh';
    if (hp >= 50) return 'healthy';
    if (hp >= 22) return 'heavy';
    return 'critical';
  }

  function seg(n) { return '<span class="seg"></span>'.repeat(n); }

  function fmtTok(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(Math.round(n));
  }

  var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

  var CONFETTI_COLORS = ['#ff5d8f', '#ffd166', '#34d399', '#5db3e8', '#b794f6', '#ffffff'];

  async function loadCss() {
    var parts = await Promise.all([
      fetch('memoko/pill.css').then(function (r) { return r.text(); }),
      fetch('memoko/memoko-extra.css').then(function (r) { return r.text(); }),
    ]);
    return parts.join('\n');
  }

  function loadStats() {
    try {
      var raw = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
      return {
        chats: raw.chats | 0,
        handoffs: raw.handoffs | 0,
        saved: raw.saved | 0,
      };
    } catch (e) {
      return { chats: 0, handoffs: 0, saved: 0 };
    }
  }

  function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  async function init(opts) {
    opts = opts || {};
    var Memoko = window.Memoko;
    var cssText = await loadCss();

    var host = document.createElement('div');
    host.setAttribute('data-chathp', '');
    host.style.cssText =
      'position:fixed;z-index:2147483646;right:28px;bottom:28px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;';

    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + cssText + '</style>' +
      '<div class="root" data-state="fresh" data-theme="' + (opts.theme || 'dark') + '">' +
        '<div class="panel" hidden>' +
          '<div class="panel-head">' +
            '<span class="avatar"></span>' +
            '<span class="title">MEMOKO</span>' +
            '<span class="badge">Fresh</span>' +
          '</div>' +
          '<div class="hpline"><span>HP</span><b class="v-hp">–</b><i>/ 100</i></div>' +
          '<div class="segbar large">' + seg(10) + '</div>' +
          '<div class="status"></div>' +
          '<div class="rows">' +
            '<div class="row"><span>Context used</span><i class="dots"></i><b class="v-pct">–</b></div>' +
            '<div class="row"><span>Est. tokens</span><i class="dots"></i><b class="v-tokens">–</b></div>' +
            '<div class="row"><span>Messages</span><i class="dots"></i><b class="v-msgs">–</b></div>' +
            '<div class="row"><span>Watching</span><i class="dots"></i><b class="v-age">–</b></div>' +
          '</div>' +
          '<div class="handoff-box"></div>' +
          // ---- NEW: lifetime stats footer ----
          '<div class="stats">' +
            '<div class="stats-cap">LIFETIME</div>' +
            '<div class="srow"><span>Chats watched</span><i class="dots"></i><b class="s-chats">0</b></div>' +
            '<div class="srow"><span>Handoffs done</span><i class="dots"></i><b class="s-hand">0</b></div>' +
            '<div class="srow"><span>Tokens saved</span><i class="dots"></i><b class="s-saved">~0</b></div>' +
            '<div class="stats-hero"><span class="heart">&#9829;</span><span class="hero-text">Memoko has saved you <b class="s-hero">~0</b> tokens.</span></div>' +
          '</div>' +
          '<div class="foot">Estimates only &middot; 100% local</div>' +
        '</div>' +
        '<div class="pillspot">' +
          '<span class="speech" role="status" hidden><span class="speech-text"></span></span>' +
          '<span class="zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>' +
          '<span class="sprite" aria-hidden="true"><span class="pop"><span class="trk"><span class="flip"></span></span></span></span>' +
          '<button class="pill" title="Memoko — estimated context health" aria-label="Memoko context health" aria-expanded="false">' +
            '<span class="hp-tag">HP</span>' +
            '<span class="segs">' + seg(7) + '</span>' +
            '<span class="pct">–</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    var $ = function (s) { return shadow.querySelector(s); };
    var root = $('.root');
    var panel = $('.panel');
    var pill = $('.pill');
    var pillspot = $('.pillspot');
    var badge = $('.badge');
    var pct = $('.pct');
    var avatar = $('.avatar');
    var flip = $('.flip');
    var statusEl = $('.status');
    var vHp = $('.v-hp');
    var vPct = $('.v-pct');
    var vTokens = $('.v-tokens');
    var vMsgs = $('.v-msgs');
    var vAge = $('.v-age');
    var pillSegs = $('.segs');
    var panelSegs = $('.segbar');
    var speech = $('.speech');
    var speechText = $('.speech-text');
    var sChats = $('.s-chats');
    var sHand = $('.s-hand');
    var sSaved = $('.s-saved');
    var sHero = $('.s-hero');

    document.documentElement.appendChild(host);

    var reduced = function () {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    };

    // ---- state ----
    var hp = 92;
    var lastState = 'fresh';
    var streaming = false;
    var celebrating = false;
    var idleStage = null; // null | 'sit' | 'laptop' | 'doodle' | 'kick' | 'peek' | 'yawn' | 'nap'
    var konamiActive = false;
    var waving = false;
    var attentive = false;
    var petting = false;
    var mkTrack = null;
    var mkEyes = null;
    var cursor = { x: -9999, y: -9999 };
    var spritePose = null;
    var faceState = null;
    var collapsed = true;
    var msgs = 6;
    var watchStart = Date.now();

    var stats = loadStats();

    // ---- pose ----
    function setSprite(pose) {
      if (pose === spritePose) return;
      spritePose = pose;
      flip.innerHTML = '<span class="mk-swap">' + Memoko.spriteSvg(pose, SPRITE_SIZE) + '</span>';
    }
    function setFace(state) {
      if (state === faceState) return;
      faceState = state;
      avatar.innerHTML = Memoko.faceSvg(state, 24);
    }
    function syncPose() {
      var pose;
      if (konamiActive || celebrating) pose = 'cheer';
      else if (waving) pose = 'wave';
      else if (idleStage) pose = (idleStage === 'kick' || idleStage === 'peek') ? 'sit' : idleStage;
      else if (attentive) pose = 'watch';
      else if (streaming && lastState !== 'critical') pose = 'watch';
      else pose = lastState;
      setSprite(pose);
      setFace(lastState);
      root.classList.toggle('idle', !!idleStage);
      root.classList.toggle('idle-nap', idleStage === 'nap');
      root.classList.toggle('idle-kick', idleStage === 'kick');
      root.classList.toggle('idle-peek', idleStage === 'peek');
    }

    // ---- segments / hp ----
    function setSegs(wrap, h) {
      var cells = wrap.querySelectorAll('.seg');
      var filled = h > 0 ? Math.max(1, Math.round((h / 100) * cells.length)) : 0;
      cells.forEach(function (el, i) { el.classList.toggle('on', i < filled); });
    }

    function formatAge(ms) {
      var min = Math.floor(ms / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return min + 'm';
      return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    }

    function render() {
      var state = stateForHp(hp);
      lastState = state;
      root.dataset.state = state;
      root.classList.toggle('streaming', streaming && !idleStage);

      setSegs(pillSegs, hp);
      setSegs(panelSegs, hp);
      pct.textContent = String(hp);
      vHp.textContent = String(hp);
      badge.textContent = STATE_LABEL[state];
      statusEl.textContent = Memoko.STATUS[state];

      var usage = Math.max(0, Math.min(999, 100 - hp));
      var tokens = Math.round(usage / 100 * 190000);
      vPct.textContent = '~' + usage + '%';
      vTokens.textContent = '~' + fmtTok(tokens) + ' / 190k';
      vMsgs.textContent = String(msgs);
      vAge.textContent = formatAge(Date.now() - watchStart) + ' (this tab)';

      syncPose();
    }

    // ---- speech bubble (tracks her head so it travels with her) ----
    var trk = $('.trk');
    var speechTimer = 0;
    var bubbleRaf = 0;
    // Read the live horizontal offset the patrol animation applies to .trk.
    function trkX() {
      var st = getComputedStyle(trk).transform;
      if (!st || st === 'none') return 0;
      var m = st.match(/\(([^)]+)\)/);
      if (!m) return 0;
      var v = m[1].split(',').map(parseFloat);
      return v.length === 6 ? v[4] : (v.length === 16 ? v[12] : 0);
    }
    function positionBubble() {
      var headX = 22 + trkX();            // sprite home head ≈ 22px + patrol offset
      var pw = pillspot.offsetWidth || 100;
      var right = Math.max(0, pw - headX - 30);
      speech.style.left = 'auto';
      speech.style.right = right.toFixed(1) + 'px';
      if (!speech.hidden) bubbleRaf = window.requestAnimationFrame(positionBubble);
    }
    function hideBubble() {
      speech.hidden = true;
      window.cancelAnimationFrame(bubbleRaf);
    }
    function showBubble(text) {
      speechText.textContent = text;
      speech.hidden = false;
      speech.classList.remove('pop');
      void speech.offsetWidth;
      speech.classList.add('pop');
      window.cancelAnimationFrame(bubbleRaf);
      positionBubble();
      window.clearTimeout(speechTimer);
      speechTimer = window.setTimeout(hideBubble, 6000);
    }
    speech.addEventListener('click', function () {
      window.clearTimeout(speechTimer);
      hideBubble();
    });

    // ---- stats footer ----
    function bump(el) {
      if (reduced()) return;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    function renderStats(bumpKey) {
      sChats.textContent = String(stats.chats);
      sHand.textContent = String(stats.handoffs);
      sSaved.textContent = '~' + fmtTok(stats.saved);
      sHero.textContent = '~' + fmtTok(stats.saved);
      if (bumpKey === 'chats') bump(sChats);
      if (bumpKey === 'handoffs') { bump(sHand); }
      if (bumpKey === 'saved') { bump(sSaved); bump(sHero); }
      saveStats(stats);
    }

    // ---- celebration (handoff done) ----
    var celebrateTimer = 0;
    function celebrate() {
      window.clearTimeout(celebrateTimer);
      root.classList.remove('celebrate');
      void root.offsetWidth;
      celebrating = true;
      root.classList.add('celebrate');
      syncPose();
      celebrateTimer = window.setTimeout(function () {
        celebrating = false;
        root.classList.remove('celebrate');
        syncPose();
      }, 1700);
    }

    // ---- damage numbers ----
    function spawnDamage(amount) {
      if (reduced()) return;
      var d = document.createElement('span');
      d.className = 'dmg';
      d.textContent = '-' + amount + ' HP';
      pillspot.appendChild(d);
      window.setTimeout(function () { d.remove(); }, 1600);
    }

    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

    // ====================== IDLE STATE MACHINE ======================
    // Real extension: first idle ~2 min. For the demo the delays are short so
    // the behavior is observable. After she sits, she runs through a small,
    // randomized rotation of activities, then yawns and naps.
    var IDLE_DELAY = opts.idleDelay != null ? opts.idleDelay : 16000;
    var DWELL = { sit: 3600, laptop: 7000, doodle: 6200, kick: 4200, peek: 3400, yawn: 1700 };
    var ACTIVITIES = ['laptop', 'doodle', 'kick', 'peek'];
    var SEATED = { sit: 1, laptop: 1, doodle: 1, kick: 1, peek: 1, yawn: 1 };
    var idleTimer = 0;
    var stageTimer = 0;
    var suppressWakeUntil = 0;
    var idleActsLeft = 0;

    function clearIdleTimers() {
      window.clearTimeout(idleTimer);
      window.clearTimeout(stageTimer);
    }

    function enterStage(stage, hold) {
      setAttentive(false);
      var wasSeated = !!SEATED[idleStage];
      idleStage = stage;
      // the sit-down drop only plays going from standing → seated, not on
      // seated → seated activity swaps (the swap cushion handles those).
      if (SEATED[stage] && !wasSeated) {
        root.classList.remove('idle-enter');
        void root.offsetWidth;
        root.classList.add('idle-enter');
        window.setTimeout(function () { root.classList.remove('idle-enter'); }, 600);
      }
      render();
      // a little personality for the cuter beats (kept sparse so she's not chatty)
      if (Math.random() < 0.55) {
        if (stage === 'kick') showBubble('🎵 dum de dum…');
        else if (stage === 'peek') showBubble('still there? 👀');
        else if (stage === 'doodle') showBubble('just doodling ✏️');
      }
      notifyStage(stage);
      window.clearTimeout(stageTimer);
      if (hold) return;            // forced single stage — stay put
      if (stage === 'nap') return; // terminal
      if (stage === 'yawn') {
        stageTimer = window.setTimeout(function () { enterStage('nap'); }, DWELL.yawn);
        return;
      }
      stageTimer = window.setTimeout(nextIdle, DWELL[stage]);
    }

    function notifyStage(stage) {
      if (typeof opts.onStage === 'function') opts.onStage(stage);
    }

    function nextIdle() {
      if (idleActsLeft <= 0) { enterStage('yawn'); return; }
      idleActsLeft--;
      enterStage(pick(ACTIVITIES));
    }

    function goIdle() {
      if (idleStage) return;
      idleActsLeft = 2 + Math.floor(Math.random() * 2); // 2–3 activities before bed
      enterStage('sit');
    }

    // ---- welcome-back wave (plays on a natural wake from idle) ----
    var waveTimer = 0;
    function playWave() {
      waving = true;
      syncPose();
      showBubble(pick(['welcome back! 🌸', 'missed you~', 'oh, hi again!', 'yay, you’re back!']));
      window.clearTimeout(waveTimer);
      waveTimer = window.setTimeout(function () {
        waving = false;
        syncPose();
        scheduleIdle();
      }, 1300);
    }

    function wake(force) {
      if (!idleStage && !force) return;
      if (!force && Date.now() < suppressWakeUntil) return;
      var wasIdle = !!idleStage;
      clearIdleTimers();
      idleStage = null;
      render();
      if (wasIdle && !force) playWave();
      else scheduleIdle();
      if (wasIdle && typeof opts.onStage === 'function') opts.onStage(null);
    }

    function scheduleIdle() {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(goIdle, IDLE_DELAY);
    }

    function noteActivity() {
      if (idleStage) wake(false);
      else scheduleIdle();
    }

    // ====================== CURSOR ATTENTION ======================
    // Mouse comes near → she stops pacing, faces forward, and her head + eyes
    // follow the pointer. Mouse leaves → back to patrol.
    var ZONE_IN = opts.zone != null ? opts.zone : 235;
    var ZONE_OUT = ZONE_IN + 65; // hysteresis so the boundary doesn't flicker
    function canAttend() {
      return !idleStage && !waving && !celebrating && !konamiActive && !petting &&
        lastState !== 'critical';
    }
    function attTarget() {
      var r = host.getBoundingClientRect();
      return { x: r.right - 48, y: r.bottom - 46 };
    }
    function driveAttention() {
      if (!attentive || reduced()) return;
      var t = attTarget();
      var dx = Math.max(-1, Math.min(1, (cursor.x - t.x) / 170));
      var dy = Math.max(-1, Math.min(1, (cursor.y - t.y) / 150));
      if (mkTrack) mkTrack.style.transform =
        'rotate(' + (dx * 12).toFixed(1) + 'deg) translate(' + (dx * 1.4).toFixed(2) + 'px,' + (dy * 1.0 - 0.2).toFixed(2) + 'px)';
      if (mkEyes) mkEyes.style.transform =
        'translate(' + (dx * 1.2).toFixed(2) + 'px,' + (dy * 1.0).toFixed(2) + 'px)';
    }
    function setAttentive(on) {
      if (on === attentive) return;
      attentive = on;
      root.classList.toggle('attentive', on);
      syncPose();
      if (on) {
        mkTrack = flip.querySelector('.mk-track');
        mkEyes = flip.querySelector('.mk-eyes');
        driveAttention();
      } else {
        if (mkTrack) mkTrack.style.transform = '';
        mkTrack = null;
        mkEyes = null;
      }
    }
    function onPointer(e) {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      if (canAttend()) {
        var t = attTarget();
        var dist = Math.hypot(cursor.x - t.x, cursor.y - t.y);
        var near = attentive ? dist < ZONE_OUT : dist < ZONE_IN;
        setAttentive(near);
        if (near) driveAttention();
      } else if (attentive) {
        setAttentive(false);
      }
    }

    // ====================== PET INTERACTION ======================
    var petTimer = 0;
    var PET_LINES = ['ehehe~', '♪ ♫', 'hehe, hi!', '*happy wiggle*', 'yay! 💕', 'boop!'];
    function spawnHearts() {
      if (reduced()) return;
      var n = 3 + Math.floor(Math.random() * 2);
      for (var i = 0; i < n; i++) {
        (function (k) {
          var h = document.createElement('span');
          h.className = 'heart';
          h.textContent = '♥';
          h.style.left = (28 + (Math.random() * 26 - 13)).toFixed(0) + 'px';
          h.style.animationDelay = (k * 0.08).toFixed(2) + 's';
          h.style.setProperty('--r', (Math.random() * 30 - 15).toFixed(0) + 'deg');
          h.style.fontSize = (10 + Math.random() * 5).toFixed(0) + 'px';
          pillspot.appendChild(h);
          window.setTimeout(function () { h.remove(); }, 1500);
        })(i);
      }
    }
    function pet() {
      var wasIdle = !!idleStage;
      if (wasIdle) {
        clearIdleTimers();
        idleStage = null;
        if (typeof opts.onStage === 'function') opts.onStage(null);
      }
      petting = true;
      setAttentive(false);
      render();
      root.classList.remove('petted');
      void root.offsetWidth;
      root.classList.add('petted');
      spawnHearts();
      showBubble(pick(PET_LINES));
      window.clearTimeout(petTimer);
      petTimer = window.setTimeout(function () {
        petting = false;
        scheduleIdle();
      }, 720);
    }
    $('.sprite').addEventListener('click', function (e) {
      e.stopPropagation();
      pet();
    });

    ['pointerdown', 'keydown', 'scroll', 'wheel'].forEach(function (ev) {
      window.addEventListener(ev, noteActivity, { passive: true });
    });
    window.addEventListener('pointermove', function (e) {
      noteActivity();
      onPointer(e);
    }, { passive: true });
    scheduleIdle();

    // ====================== KONAMI EASTER EGG ======================
    var konamiIdx = 0;
    var konamiTimer = 0;
    function fireKonami() {
      // wake from idle, cancel timers; the party takes precedence
      clearIdleTimers();
      idleStage = null;
      konamiActive = true;
      root.classList.remove('konami');
      void root.offsetWidth;
      root.classList.add('konami');
      syncPose();
      showBubble('1-UP! ▲▲▼▼◀▶◀▶ B A — you found me ✨');

      if (!reduced()) {
        // 1-UP text
        var up = document.createElement('span');
        up.className = 'oneup';
        up.textContent = '1-UP!';
        pillspot.appendChild(up);
        window.setTimeout(function () { up.remove(); }, 1600);

        // confetti rain
        var box = document.createElement('span');
        box.className = 'kfetti';
        var n = 18;
        for (var i = 0; i < n; i++) {
          var p = document.createElement('i');
          var leftPct = Math.round((i / (n - 1)) * 100);
          p.style.left = leftPct + '%';
          p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
          p.style.setProperty('--d', (Math.random() * 0.35).toFixed(2) + 's');
          p.style.setProperty('--fall', (52 + Math.random() * 34).toFixed(0) + 'px');
          p.style.setProperty('--spin', (260 + Math.random() * 360).toFixed(0) + 'deg');
          box.appendChild(p);
        }
        pillspot.appendChild(box);
        window.setTimeout(function () { box.remove(); }, 2100);
      }

      window.clearTimeout(konamiTimer);
      konamiTimer = window.setTimeout(function () {
        konamiActive = false;
        root.classList.remove('konami');
        syncPose();
        scheduleIdle();
      }, 1700);
      if (typeof opts.onKonami === 'function') opts.onKonami();
    }

    window.addEventListener('keydown', function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === KONAMI[konamiIdx]) {
        konamiIdx++;
        if (konamiIdx === KONAMI.length) {
          konamiIdx = 0;
          fireKonami();
        }
      } else {
        // allow restart if the mismatched key is the sequence's first key
        konamiIdx = (k === KONAMI[0]) ? 1 : 0;
      }
    });

    // ---- pill click toggles panel ----
    function syncExpanded() { pill.setAttribute('aria-expanded', String(!collapsed)); }
    pill.addEventListener('click', function () {
      collapsed = !collapsed;
      panel.hidden = collapsed;
      syncExpanded();
    });
    panel.hidden = collapsed;
    syncExpanded();

    // ---- first paint ----
    setSprite('fresh');
    setFace('fresh');
    render();
    renderStats();

    // ====================== PUBLIC CONTROL API ======================
    var api = {
      el: host,
      setHealth: function (h) {
        h = Math.max(0, Math.min(100, Math.round(h)));
        var prev = hp;
        hp = h;
        if (h < prev - 1 && !idleStage && !konamiActive) spawnDamage(prev - h);
        render();
      },
      damage: function (amount) {
        api.setHealth(hp - amount);
      },
      heal: function (amount) {
        hp = Math.min(100, hp + amount);
        render();
      },
      setStreaming: function (b) {
        streaming = !!b;
        render();
      },
      openPanel: function () { collapsed = false; panel.hidden = false; syncExpanded(); },
      // idle controls
      forceIdle: function (stage) {
        clearIdleTimers();
        suppressWakeUntil = Date.now() + 700;
        waving = false;
        enterStage(stage || 'sit', true);
      },
      startIdleSequence: function () {
        clearIdleTimers();
        suppressWakeUntil = Date.now() + 700;
        waving = false;
        idleActsLeft = 2 + Math.floor(Math.random() * 2);
        enterStage('sit');
      },
      pet: function () { pet(); },
      wave: function () {
        clearIdleTimers();
        idleStage = null;
        setAttentive(false);
        render();
        playWave();
      },
      wake: function () { waving = false; wake(true); scheduleIdle(); },
      isIdle: function () { return !!idleStage; },
      idleStage: function () { return idleStage; },
      // konami
      konami: function () { fireKonami(); },
      // handoff celebration + lifetime stats
      handoff: function (savedTokens) {
        savedTokens = savedTokens || (28000 + Math.round(Math.random() * 24000));
        celebrate();
        stats.handoffs += 1;
        stats.saved += savedTokens;
        renderStats('saved');
        window.setTimeout(function () { bump(sHand); }, 60);
        api.openPanel();
        showBubble('Handoff ready — saved you ~' + fmtTok(savedTokens) + ' tokens!');
        return savedTokens;
      },
      newChat: function () {
        stats.chats += 1;
        watchStart = Date.now();
        renderStats('chats');
      },
      resetStats: function () {
        stats = { chats: 0, handoffs: 0, saved: 0 };
        renderStats();
      },
      getStats: function () { return Object.assign({}, stats); },
      getState: function () { return lastState; },
      getHealth: function () { return hp; },
      isStreaming: function () { return streaming; },
      setTheme: function (t) { root.dataset.theme = t; },
      bubble: showBubble,
    };
    return api;
  }

  window.MemokoDemo = { init: init };
})();
