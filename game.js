// "Can you score a try?" — a small WASD touch rugby game for the TRY site.
(function () {
  const canvas = document.getElementById('try-game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 700, H = 500;                 // logical size: 70 m long x 50 m wide
  const FIELD = { left: 20, right: 680, top: 20, bottom: 480 };
  const TRY_X = 630;                      // defending try line (right)
  const OWN_TRY_X = 70;                   // attacking team's try line (left)
  const MID_Y = (FIELD.top + FIELD.bottom) / 2;
  const R = 12;                           // player radius

  const COLORS = {
    pitchA: '#174a32', pitchB: '#123F2A', chalk: 'rgba(245,246,239,.75)',
    chalkSoft: 'rgba(245,246,239,.35)', bib: '#F2C21B', ink: '#16201A',
    defender: '#F5F6EF', defenderText: '#123F2A'
  };

  // Levels: defenders all start on the try line. Middles centre, links outside them, wings outside links.
  const LEVELS = [
    { name: 'One middle', team: [['M', 0]] },
    { name: 'Two middles', team: [['M', -40], ['M', 40]] },
    { name: 'Middles and links', team: [['L', -115], ['M', -40], ['M', 40], ['L', 115]] },
    { name: 'The full six', team: [['W', -195], ['L', -120], ['M', -45], ['M', 45], ['L', 120], ['W', 195]] }
  ];

  const statusEl = document.getElementById('try-game-status');
  const startBtn = document.getElementById('try-game-start');

  let level = 0, tries = 0, state = 'idle';   // idle | playing | touched | scored | won
  let player, defenders, lastT = 0;
  const keys = { up: false, down: false, left: false, right: false };

  function setStatus(text) { statusEl.textContent = text; }

  function resetLevel() {
    player = { x: OWN_TRY_X + 40, y: MID_Y };
    defenders = LEVELS[level].team.map(([role, dy]) => ({
      role, homeY: MID_Y + dy, x: TRY_X, y: MID_Y + dy
    }));
  }

  function start() {
    resetLevel();
    state = 'playing';
    setStatus(`Level ${level + 1} of ${LEVELS.length}: ${LEVELS[level].name}. Get past them and over the try line.`);
    startBtn.hidden = true;
    canvas.focus({ preventScroll: true });
  }

  function endRound(newState) {
    state = newState;
    startBtn.hidden = false;
    if (newState === 'touched') {
      setStatus(`Touched! Level ${level + 1}: ${LEVELS[level].name}. Tries scored: ${tries}.`);
      startBtn.textContent = 'Try again';
    } else if (newState === 'scored') {
      tries++;
      level++;
      setStatus(`Try scored! Next up, level ${level + 1}: ${LEVELS[level].name}.`);
      startBtn.textContent = 'Next level';
    } else if (newState === 'won') {
      tries++;
      setStatus(`You beat the full six! ${tries} tries scored. Think you can do it again?`);
      startBtn.textContent = 'Play again';
      level = 0;
    }
  }

  // ---- Movement ----
  function update(dt) {
    const speed = 200;                          // player px/s
    let vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    player.x = clamp(player.x + vx * speed * dt, FIELD.left + R, FIELD.right - R);
    player.y = clamp(player.y + vy * speed * dt, FIELD.top + R, FIELD.bottom - R);

    // Defence: the line rushes up together and slides with the ball;
    // whoever is closest leaves the line to make the touch.
    const lineSpeed = 70 + level * 6;
    const chaseSpeed = 115;
    const lineX = TRY_X - 100;                 // the line steps up and holds here
    const slide = (player.y - MID_Y) * 0.15;

    let chaser = null, best = Infinity;
    for (const d of defenders) {
      const dist = Math.hypot(d.x - player.x, d.y - player.y);
      if (dist < best) { best = dist; chaser = d; }
    }

    for (const d of defenders) {
      let tx, ty, sp;
      if (d === chaser && best < 75) {
        tx = player.x; ty = player.y; sp = chaseSpeed;
      } else {
        tx = Math.min(lineX, TRY_X);
        ty = clamp(d.homeY + slide, FIELD.top + 85, FIELD.bottom - 85);  // wings hold in from the sideline
        sp = lineSpeed;
      }
      if (d === chaser && best < 75) moveToward(d, tx, ty, sp * dt);
      else moveLine(d, tx, ty, sp * dt, 45 * dt);
    }

    // Separate defenders so they don't stack
    for (let i = 0; i < defenders.length; i++) {
      for (let j = i + 1; j < defenders.length; j++) {
        const a = defenders[i], b = defenders[j];
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
        if (dist < R * 2.4) {
          const push = (R * 2.4 - dist) / 2;
          a.x -= dx / dist * push; a.y -= dy / dist * push;
          b.x += dx / dist * push; b.y += dy / dist * push;
        }
      }
    }

    for (const d of defenders) {
      if (Math.hypot(d.x - player.x, d.y - player.y) < R * 2) { endRound('touched'); return; }
    }
    if (player.x >= TRY_X + R) {
      endRound(level === LEVELS.length - 1 ? 'won' : 'scored');
    }
  }

  function moveToward(o, tx, ty, step) {
    const dx = tx - o.x, dy = ty - o.y, dist = Math.hypot(dx, dy);
    if (dist <= step || dist === 0) { o.x = tx; o.y = ty; return; }
    o.x += dx / dist * step; o.y += dy / dist * step;
  }
  // Line defenders step up at line speed but shuffle sideways more slowly.
  function moveLine(o, tx, ty, stepX, stepY) {
    o.x += clamp(tx - o.x, -stepX, stepX);
    o.y += clamp(ty - o.y, -stepY, stepY);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- Drawing ----
  function draw() {
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 ? COLORS.pitchB : COLORS.pitchA;
      ctx.fillRect(i * 50, 0, 50, H);
    }
    ctx.strokeStyle = COLORS.chalk; ctx.lineWidth = 3; ctx.setLineDash([]);
    ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top);
    line(OWN_TRY_X, COLORS.chalk);
    line(TRY_X, COLORS.chalk);
    ctx.setLineDash([10, 10]);
    line(W / 2, COLORS.chalkSoft);
    line(OWN_TRY_X + 70, COLORS.chalkSoft);   // 7 m lines
    line(TRY_X - 70, COLORS.chalkSoft);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(242,194,27,.10)';
    ctx.fillRect(TRY_X, FIELD.top, FIELD.right - TRY_X, FIELD.bottom - FIELD.top);

    if (!player) return;
    for (const d of defenders) dot(d.x, d.y, COLORS.defender, d.role, COLORS.defenderText);
    dot(player.x, player.y, COLORS.bib, 'You', COLORS.ink, 9);
  }
  function line(x, color) {
    ctx.strokeStyle = color; ctx.beginPath();
    ctx.moveTo(x, FIELD.top); ctx.lineTo(x, FIELD.bottom); ctx.stroke();
  }
  function dot(x, y, fill, label, textColor, size = 13) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = textColor;
    ctx.font = `700 ${size}px Barlow, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 1);
  }

  function loop(t) {
    const dt = Math.min((t - lastT) / 1000 || 0, 0.05);
    lastT = t;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---- Input ----
  const KEYMAP = { w: 'up', a: 'left', s: 'down', d: 'right',
                   arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right' };
  function onKey(e, down) {
    if (state !== 'playing') return;
    const k = KEYMAP[e.key.toLowerCase()];
    if (!k) return;
    keys[k] = down;
    e.preventDefault();
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  document.querySelectorAll('[data-dir]').forEach((btn) => {
    const dir = btn.dataset.dir;
    const on = (e) => { e.preventDefault(); keys[dir] = true; };
    const off = () => { keys[dir] = false; };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });

  startBtn.addEventListener('click', () => {
    for (const k in keys) keys[k] = false;
    start();
  });

  // Pop-up: opened from the "play a mini-game while you wait" buttons
  const dialog = document.getElementById('game-dialog');
  document.querySelectorAll('[data-open-game]').forEach((b) =>
    b.addEventListener('click', () => { dialog.showModal(); startBtn.focus(); }));
  document.querySelectorAll('[data-close-game]').forEach((b) =>
    b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    for (const k in keys) keys[k] = false;
    if (state === 'playing') {
      state = 'idle'; resetLevel();
      startBtn.hidden = false; startBtn.textContent = 'Start';
      setStatus(`Level ${level + 1} of ${LEVELS.length}: ${LEVELS[level].name}.`);
    }
  });

  const testLevel = Number(new URLSearchParams(location.search).get('level'));
  if (testLevel >= 1 && testLevel <= LEVELS.length) level = testLevel - 1;
  if (testLevel) window.__tryGame = () => ({ player, defenders, state });
  setStatus(`Level ${level + 1} of ${LEVELS.length}: ${LEVELS[level].name}.`);
  resetLevel();
  requestAnimationFrame(loop);
})();
