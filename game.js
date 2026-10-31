// "Can you score a try?" — a small touch rugby scoop-play game for the TRY site.
//
// How a play works (based on FIT touch rules):
//   1. Carry: you run the ball carrier (M) to the spot you want, then dump the
//      ball (the rollball). You can dump anywhere up to the defence's 7 m line.
//   2. Set:   the defence must set 7 m back from the mark, so their line moves
//      up to that onside line. Control switches to your half (the scooper).
//   3. Run:   once the half touches the ball, the defence is released. If the
//      half is touched holding the ball, it's a changeover.
//   4. Pass:  the half can't score, so on reaching the try line they pass to
//      the nearest teammate, who grounds it for the try.
(function () {
  'use strict';

  // ---------------------------------------------------------------- engine
  // 10 px = 1 m. Field is 70 m long (try line to try line is 56 m) by 50 m wide.
  const C = {
    W: 700, H: 500, L: 20, RT: 680, T: 20, B: 480,
    TRY_X: 630, OWN_X: 70, MID: 250, R: 12, SEVEN: 70
  };

  // Defenders start on their try line: middles centre, links outside, wings outside links.
  const LEVELS = [
    { name: 'One middle', team: [['M', 0]] },
    { name: 'Two middles', team: [['M', -40], ['M', 40]] },
    { name: 'Middles and links', team: [['L', -115], ['M', -40], ['M', 40], ['L', 115]] },
    { name: 'The full six', team: [['W', -195], ['L', -120], ['M', -45], ['M', 45], ['L', 120], ['W', 195]] }
  ];

  // Your six. Index 2 (top middle) carries and dumps; index 3 (bottom middle) scoops.
  const ATTACK = [['W', -195], ['L', -120], ['M', -45], ['M', 45], ['L', 120], ['W', 195]];
  const DUMPER = 2, HALF = 3;

  const TUNE = {
    speed: 200,        // you, px/s
    support: 170,      // teammates
    setSpeed: 110,     // defence moving up to the onside line
    line0: 70,         // defensive line speed after release, + lineInc per level
    lineInc: 6,
    lateral: 45,       // how fast the line shuffles sideways
    chase: 115,        // the defender who breaks off to make the touch
    engage: 75,        // how close before someone breaks off
    gap: 60,           // line tries to keep 6 m off the ball
    slide: 0.15,       // how much the line slides toward the ball
    margin: 85,        // line holds this far in from the sidelines
    release: 3,        // seconds before a slow scoop lets the defence advance
    pass: 520          // ball speed on the pass
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function moveToward(o, tx, ty, step) {
    const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
    if (d <= step || d === 0) { o.x = tx; o.y = ty; return; }
    o.x += dx / d * step; o.y += dy / d * step;
  }
  function moveLine(o, tx, ty, stepX, stepY) {
    o.x += clamp(tx - o.x, -stepX, stepX);
    o.y += clamp(ty - o.y, -stepY, stepY);
  }

  function create(level, tune) {
    const T = Object.assign({}, TUNE, tune || {});
    const s = {
      level, T, phase: 'carry', t: 0, mark: null, onsideX: null,
      released: false, slowRelease: false, receiver: null
    };
    s.attackers = ATTACK.map(([role, lane]) => ({ role, lane, x: C.OWN_X + 40, y: C.MID + lane }));
    s.dumper = s.attackers[DUMPER];
    s.half = s.attackers[HALF];
    s.half.x -= 30; s.half.y = s.dumper.y + 30;   // the half hovers behind the ball
    s.controlled = s.dumper;
    s.ball = { x: s.dumper.x + 9, y: s.dumper.y, holder: s.dumper };
    s.defenders = LEVELS[level].team.map(([role, dy]) => ({ role, homeY: C.MID + dy, x: C.TRY_X, y: C.MID + dy }));
    return s;
  }

  function dump(s) {
    if (s.phase !== 'carry') return false;
    const d = s.dumper;
    s.mark = { x: d.x, y: d.y };
    s.ball.holder = null;
    s.ball.x = d.x; s.ball.y = d.y;
    // Defence sets 7 m from the mark; inside their 7 m zone that means their try line.
    s.onsideX = Math.min(d.x + C.SEVEN, C.TRY_X);
    s.phase = 'set'; s.t = 0;
    s.controlled = s.half;
    return true;
  }

  function moveControlled(s, dt, keys) {
    const p = s.controlled;
    let vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    p.x = clamp(p.x + vx * s.T.speed * dt, C.L + C.R, C.RT - C.R);
    p.y = clamp(p.y + vy * s.T.speed * dt, C.T + C.R, C.B - C.R);
    if (s.phase === 'carry') p.x = Math.min(p.x, C.TRY_X - C.SEVEN);   // dump before their 7 m line
  }

  // Teammates hold their width across the field, drift toward the ball, and stay a few metres
  // behind it so any pass goes backwards.
  function support(s, dt, anchor) {
    const team = [];
    for (const a of s.attackers) {
      if (a === s.controlled || a === anchor) continue;
      if (s.phase === 'set' && a === s.dumper && s.t < 0.5) {     // stepping over the ball
        moveToward(a, s.mark.x + 18, s.mark.y, 60 * dt);
        continue;
      }
      let tx = anchor.x - 28, ty = C.MID + a.lane + (anchor.y - C.MID) * 0.35;
      if (s.phase === 'carry' && a === s.half) { tx = anchor.x - 30; ty = anchor.y + (anchor.y > C.MID ? -30 : 30); }
      moveToward(a, tx, clamp(ty, C.T + C.R, C.B - C.R), s.T.support * dt);
      team.push(a);
    }
    separate(team);
  }

  function defend(s, dt) {
    const T = s.T, b = s.ball;
    const lineSpeed = T.line0 + s.level * T.lineInc;
    const lineX = clamp(b.x + T.gap, C.L + 60, C.TRY_X);
    const slide = (b.y - C.MID) * T.slide;
    const carrier = b.holder;
    let chaser = null, best = Infinity;
    if (carrier) for (const d of s.defenders) { const dd = dist(d, carrier); if (dd < best) { best = dd; chaser = d; } }
    for (const d of s.defenders) {
      if (d === chaser && best < T.engage) moveToward(d, carrier.x, carrier.y, T.chase * dt);
      else moveLine(d, lineX, clamp(d.homeY + slide, C.T + T.margin, C.B - T.margin), lineSpeed * dt, T.lateral * dt);
    }
  }

  function separate(list) {
    const min = C.R * 2.4;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        if (d < min) {
          const push = (min - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push;
          b.x += dx / d * push; b.y += dy / d * push;
        }
      }
    }
  }

  function step(s, dt, keys) {
    const T = s.T;
    if (s.phase === 'touched' || s.phase === 'scored') return;
    s.t += dt;

    if (s.phase === 'carry' || s.phase === 'set' || s.phase === 'run') moveControlled(s, dt, keys);

    if (s.phase === 'carry') {
      s.ball.x = s.dumper.x + 9; s.ball.y = s.dumper.y;
      support(s, dt, s.dumper);
      return;                                   // defence holds its try line
    }

    if (s.phase === 'set') {
      support(s, dt, s.half);
      if (!s.released && s.t > T.release) { s.released = true; s.slowRelease = true; }
      if (s.released) defend(s, dt);
      else for (const d of s.defenders) moveLine(d, s.onsideX, d.homeY, T.setSpeed * dt, T.lateral * dt);
      separate(s.defenders);
      if (dist(s.half, s.ball) < C.R + 4) {     // half touches the ball: play is on
        s.ball.holder = s.half; s.phase = 'run'; s.released = true; s.t = 0;
      }
      return;
    }

    if (s.phase === 'run') {
      s.ball.x = s.half.x + 9; s.ball.y = s.half.y;
      support(s, dt, s.half);
      defend(s, dt);
      separate(s.defenders);
      for (const d of s.defenders) {
        if (dist(d, s.half) < C.R * 2) { s.phase = 'touched'; return; }
      }
      if (s.half.x >= C.TRY_X - C.R) {          // half reaches the line: pass to the nearest teammate
        let best = Infinity;
        for (const a of s.attackers) {
          if (a === s.half) continue;
          const dd = dist(a, s.half);
          if (dd < best) { best = dd; s.receiver = a; }
        }
        s.ball.holder = null; s.phase = 'passing'; s.t = 0;
      }
      return;
    }

    if (s.phase === 'passing') {
      const r = s.receiver;
      moveToward(s.ball, r.x + 9, r.y, T.pass * dt);
      if (Math.hypot(s.ball.x - r.x - 9, s.ball.y - r.y) < 1) { s.ball.holder = r; s.phase = 'grounding'; s.t = 0; }
      return;
    }

    if (s.phase === 'grounding') {
      const r = s.receiver;
      moveToward(r, C.TRY_X + 25, r.y, 230 * dt);
      s.ball.x = r.x + 9; s.ball.y = r.y;
      if (r.x >= C.TRY_X + 24) s.phase = 'scored';
    }
  }

  const Engine = { C, LEVELS, TUNE, create, dump, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  if (typeof document === 'undefined') return;

  // -------------------------------------------------------------------- UI
  const canvas = document.getElementById('try-game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('try-game-status');
  const startBtn = document.getElementById('try-game-start');
  const dumpBtn = document.getElementById('try-game-dump');
  const dialog = document.getElementById('game-dialog');

  const COLORS = {
    pitchA: '#174a32', pitchB: '#123F2A', chalk: 'rgba(245,246,239,.75)',
    chalkSoft: 'rgba(245,246,239,.35)', bib: '#F2C21B', ink: '#16201A',
    defender: '#F5F6EF', defenderText: '#123F2A'
  };

  let level = 0, tries = 0, playing = false, s = null, lastPhase = null, lastSlow = false, lastT = 0;
  const keys = { up: false, down: false, left: false, right: false };

  const testLevel = Number(new URLSearchParams(location.search).get('level'));
  if (testLevel >= 1 && testLevel <= LEVELS.length) level = testLevel - 1;
  if (testLevel) window.__tryGame = () => s;

  const say = (text) => { statusEl.textContent = text; };
  const levelLabel = () => `Level ${level + 1} of ${LEVELS.length}: ${LEVELS[level].name}.`;
  const clearKeys = () => { for (const k in keys) keys[k] = false; };

  function start() {
    s = create(level);
    playing = true; lastPhase = null; lastSlow = false;
    startBtn.hidden = true;
    canvas.focus({ preventScroll: true });
  }

  function onPhase(p) {
    dumpBtn.hidden = p !== 'carry';
    if (p === 'carry') say(`${levelLabel()} Run to your spot, then press Space to dump the ball.`);
    if (p === 'set') say('Defence must set 7 m back. You’re the half now: run onto the ball to scoop it.');
    if (p === 'run') say('Scooped! Get the half to the try line.');
    if (p === 'passing') say('At the line! The half can’t score, so you pass to your nearest teammate…');
    if (p === 'touched') {
      playing = false;
      say(`Touched! The half was caught with the ball, so it’s a changeover. ${levelLabel()}`);
      startBtn.textContent = 'Try again'; startBtn.hidden = false;
    }
    if (p === 'scored') {
      playing = false; tries++;
      if (level === LEVELS.length - 1) {
        say(`Try! You beat the full six. ${tries} tries scored. Think you can do it again?`);
        startBtn.textContent = 'Play again'; level = 0;
      } else {
        level++;
        say(`Try! Next up, level ${level + 1}: ${LEVELS[level].name}.`);
        startBtn.textContent = 'Next level';
      }
      startBtn.hidden = false;
    }
  }

  function doDump() {
    if (playing && s && dump(s)) clearKeys();
  }

  // ---- Drawing ----
  function vline(x, color, dash) {
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color; ctx.beginPath();
    ctx.moveTo(x, C.T); ctx.lineTo(x, C.B); ctx.stroke();
    ctx.setLineDash([]);
  }
  function label(text, x, y, color) {
    ctx.fillStyle = color; ctx.font = '600 12px Barlow, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }
  function dot(p, fill, text, textColor) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(p.x, p.y, C.R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = textColor; ctx.font = '700 13px Barlow, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, p.y + 1);
  }
  function ball(b) {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(-0.5);
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 ? COLORS.pitchB : COLORS.pitchA;
      ctx.fillRect(i * 50, 0, 50, C.H);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.chalk;
    ctx.strokeRect(C.L, C.T, C.RT - C.L, C.B - C.T);
    vline(C.OWN_X, COLORS.chalk);
    vline(C.TRY_X, COLORS.chalk);
    vline(C.W / 2, COLORS.chalkSoft, [10, 10]);
    vline(C.OWN_X + C.SEVEN, COLORS.chalkSoft, [10, 10]);
    vline(C.TRY_X - C.SEVEN, COLORS.chalkSoft, [10, 10]);
    ctx.fillStyle = 'rgba(242,194,27,.10)';
    ctx.fillRect(C.TRY_X, C.T, C.RT - C.TRY_X, C.B - C.T);

    if (!s) return;

    // Where the defence would have to set if you dumped here, and where it is setting now.
    if (s.phase === 'carry') {
      const x = Math.min(s.dumper.x + C.SEVEN, C.TRY_X);
      ctx.lineWidth = 2; vline(x, 'rgba(242,194,27,.45)', [6, 8]);
      label('7 m', x, C.T + 12, 'rgba(242,194,27,.85)');
    }
    if (s.phase === 'set') {
      ctx.lineWidth = 2; vline(s.onsideX, COLORS.bib, [6, 8]);
      label('Onside line', s.onsideX, C.T + 12, COLORS.bib);
      ctx.strokeStyle = COLORS.bib; ctx.lineWidth = 2.5;
      const m = s.mark;
      ctx.beginPath(); ctx.moveTo(m.x - 6, m.y - 6); ctx.lineTo(m.x + 6, m.y + 6);
      ctx.moveTo(m.x + 6, m.y - 6); ctx.lineTo(m.x - 6, m.y + 6); ctx.stroke();
    }

    for (const d of s.defenders) dot(d, COLORS.defender, d.role, COLORS.defenderText);
    for (const a of s.attackers) dot(a, COLORS.bib, a.role, COLORS.ink);

    // Highlight the player you're controlling.
    if (playing && s.controlled) {
      const p = s.controlled;
      ctx.strokeStyle = COLORS.defender; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, C.R + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = COLORS.defender;
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - C.R - 14); ctx.lineTo(p.x + 6, p.y - C.R - 14);
      ctx.lineTo(p.x, p.y - C.R - 7); ctx.closePath(); ctx.fill();
    }
    ball(s.ball);
  }

  function loop(t) {
    const dt = Math.min((t - lastT) / 1000 || 0, 0.05);
    lastT = t;
    if (playing && s) {
      step(s, dt, keys);
      if (s.phase !== lastPhase) { lastPhase = s.phase; onPhase(s.phase); }
      if (s.phase === 'set' && s.slowRelease && !lastSlow) {
        lastSlow = true; say('Too slow! The defence is allowed to come up now. Scoop it!');
      }
    }
    draw();
    requestAnimationFrame(loop);
  }

  // ---- Input ----
  const KEYMAP = { w: 'up', a: 'left', s: 'down', d: 'right',
                   arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right' };
  function onKey(e, down) {
    if (!playing || !dialog.open) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'enter') {
      if (down) doDump();
      e.preventDefault();
      return;
    }
    const k = KEYMAP[key];
    if (!k) return;
    keys[k] = down;
    e.preventDefault();
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', clearKeys);

  document.querySelectorAll('[data-dir]').forEach((btn) => {
    const dir = btn.dataset.dir;
    const on = (e) => { e.preventDefault(); keys[dir] = true; };
    const off = () => { keys[dir] = false; };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });
  dumpBtn.addEventListener('click', () => { doDump(); canvas.focus({ preventScroll: true }); });
  startBtn.addEventListener('click', () => { clearKeys(); start(); });

  // Pop-up: opened from the "play a mini-game while you wait" buttons.
  document.querySelectorAll('[data-open-game]').forEach((b) =>
    b.addEventListener('click', () => { dialog.showModal(); startBtn.focus(); }));
  document.querySelectorAll('[data-close-game]').forEach((b) =>
    b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    clearKeys();
    if (playing) {
      playing = false; s = create(level);
      dumpBtn.hidden = true;
      startBtn.hidden = false; startBtn.textContent = 'Start';
      say(levelLabel());
    }
  });

  s = create(level);
  say(levelLabel());
  requestAnimationFrame(loop);
})();
