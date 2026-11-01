// "Can you score a try?" — a small touch rugby scoop-play game for the TRY site.
//
// How a play works (based on FIT touch rules):
//   1. Carry: you run the ball carrier (M) at the defence. Their line comes up
//      staggered, with one marker out in front to make the touch. Wherever
//      you're touched is where you dump the ball (the rollball).
//   2. Set:   every defender must retreat to the onside line ("7 m", really 10 m) back from the
//      mark before they can play. Control switches to your half (the scooper).
//   3. Run:   the half scoops the ball. Defenders still retreating can't touch
//      until they're back onside, so a quick scoop is an advantage. If the half
//      is touched holding the ball, it's a changeover.
//   4. Pass:  press Space to pass to the best-placed teammate (never forward).
//      The half can't score, so if they reach the line they pop it to a
//      teammate. Anyone else who gets the ball can run it in themselves.
(function () {
  'use strict';

  // ---------------------------------------------------------------- engine
  // 10 px = 1 m. Field is 70 m long (try line to try line is 56 m) by 50 m wide.
  const C = {
    W: 700, H: 500, L: 20, RT: 680, T: 20, B: 480,
    TRY_X: 630, OWN_X: 70, MID: 250, R: 12, SEVEN: 70,
    RETREAT: 100   // defenders actually retreat 10 m for a friendlier game; shown to players as 7 m (the FIT rule)
  };

  // Defenders start on their try line: middles centre, links outside, wings outside links.
  const LEVELS = [
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
    setSpeed: 110,     // defence moving to the onside line, and retreating to it
    markSpeed: 165,    // the marker rushing up to make the touch
    lineUp: 135,       // the rest of the line coming up behind the marker
    stagger: 35,       // how far the line sits behind the marker
    line0: 70,         // defensive line speed after release, + lineInc per level
    lineInc: 9,
    lateral: 45,       // how fast the line shuffles sideways
    chase: 115,        // the defender who breaks off to make the touch
    chaseInc: 3,       // extra chase speed per level
    mark: 45,          // how fast a defender shifts sideways to stay on their attacker
    corner: 0.5,       // corner: sideways drift per metre retreated
    engage: 110,       // how close before the defender on the ball steps up to touch
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
      released: false, slowRelease: false, receiver: null, marker: null,
      flight: null, halfRule: true, passes: 0, touches: 0, reason: null
    };
    s.attackers = ATTACK.map(([role, lane]) => ({ role, lane, x: C.OWN_X + 40, y: C.MID + lane }));
    s.dumper = s.attackers[DUMPER];
    s.half = s.attackers[HALF];
    s.half.x -= 30; s.half.y = s.dumper.y + 30;   // the half hovers behind the ball
    s.controlled = s.dumper;
    s.ball = { x: s.dumper.x + 9, y: s.dumper.y, holder: s.dumper };
    s.defenders = LEVELS[level].team.map(([role, dy]) => ({ role, homeY: C.MID + dy, x: C.TRY_X, y: C.MID + dy, onside: true }));
    return s;
  }

  // A touch: the carrier dumps the ball where they were touched. The 6th touch is a changeover.
  function dump(s, carrier, toucher) {
    const d = carrier || s.dumper;
    s.touches++;
    if (s.touches >= 6) { s.phase = 'touched'; s.reason = 'six'; return true; }
    s.dumper = d;
    s.mark = { x: d.x, y: d.y };
    s.flight = null;
    s.ball.holder = null;
    s.ball.x = d.x; s.ball.y = d.y;
    // Defence must retreat from the mark; near their line that means back to their try line.
    s.onsideX = Math.min(d.x + C.RETREAT, C.TRY_X);
    for (const def of s.defenders) def.onside = def.x >= s.onsideX - 1;
    cornerAndShut(s, toucher);
    // New half: the closest teammate who isn't ahead of the ball.
    let best = Infinity;
    for (const a of s.attackers) {
      if (a === d) continue;
      const dd = dist(a, s.mark) + (a.x > s.mark.x + 10 ? 1000 : 0);
      if (dd < best) { best = dd; s.half = a; }
    }
    s.halfRule = true; s.released = false; s.slowRelease = false;
    s.phase = 'set'; s.t = 0;
    s.controlled = s.half;
    return true;
  }

  function moveControlled(s, dt, keys) {
    const p = s.controlled;
    let vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    if (keys.ax || keys.ay) {                   // joystick: analog direction
      const m = Math.hypot(keys.ax, keys.ay);
      vx = m > 1 ? keys.ax / m : keys.ax; vy = m > 1 ? keys.ay / m : keys.ay;
    }
    p.x = clamp(p.x + vx * s.T.speed * dt, C.L + C.R, C.RT - C.R);
    p.y = clamp(p.y + vy * s.T.speed * dt, C.T + C.R, C.B - C.R);
    if (s.phase === 'carry') p.x = Math.min(p.x, C.TRY_X - C.SEVEN);   // the touch comes before their 7 m line
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
      const far = Math.hypot(tx - a.x, ty - a.y) > 40;           // sprint to catch up if left behind
      moveToward(a, tx, clamp(ty, C.T + C.R, C.B - C.R), (far ? s.T.speed + 20 : s.T.support) * dt);
      team.push(a);
    }
    separate(team);
  }

  // Corner/Shut (England Touch defence policy), set up the moment a touch is made.
  // The line splits into two halves by side of the field (with six: the three on each side).
  //  Corner: the half on the toucher's side retreats diagonally toward that side's corner,
  //          protecting the outside ("never give the outside").
  //  Shut:   the other half slides in, each defender taking the spot of the teammate inside
  //          them, which leaves the far attacker free and forces a long pass.
  function cornerAndShut(s, toucher) {
    const ds = s.defenders.slice().sort((p, q) => p.y - q.y);
    const t = toucher && ds.includes(toucher) ? toucher : ds[0];
    const half = Math.ceil(ds.length / 2);
    const topGroup = ds.slice(0, half);
    const touchTop = topGroup.includes(t);
    const cornerDir = touchTop ? -1 : 1;                   // toward the sideline on the touch side
    const lo = C.T + C.R + 8, hi = C.B - C.R - 8;
    const startY = ds.map((d) => d.y);
    ds.forEach((d, k) => {
      d.fromX = d.x; d.fromY = d.y;
      const inTouchHalf = touchTop ? k < half : k >= half;
      if (inTouchHalf) {
        const back = Math.max(0, s.onsideX - d.x);
        d.retreatY = clamp(d.y + cornerDir * back * s.T.corner, lo, hi);   // corner
        d.call = 'Corner';
      } else {
        d.retreatY = clamp(startY[k + cornerDir], lo, hi);  // shut onto the inside spot
        d.call = 'Shut';
      }
    });
  }

  // Once play is on: each defender who's back onside marks an attacker. The defence covers the
  // attackers nearest the ball, short side first, so the far long side is the one left free.
  // Whoever is marking the ball carrier steps up to make the touch.
  function defend(s, dt) {
    const T = s.T, b = s.ball;
    for (const d of s.defenders) if (!d.onside) retreat(s, d, dt);
    const live = s.defenders.filter((d) => d.onside).sort((p, q) => p.y - q.y);
    if (!live.length) return;
    const A = s.attackers.slice().sort((p, q) => p.y - q.y);
    let focus = b.holder || s.flight;
    if (!focus) { let best = Infinity; for (const a of A) { const dd = dist(a, b); if (dd < best) { best = dd; focus = a; } } }
    const bi = A.indexOf(focus), n = Math.min(live.length, A.length);
    const shortTop = bi < (A.length - 1) / 2;
    let start = 0, bestCost = Infinity;
    for (let st = Math.max(0, bi - n + 1); st <= Math.min(bi, A.length - n); st++) {
      let cost = 0;
      for (let j = st; j < st + n; j++) cost += Math.abs(j - bi);
      cost -= 0.01 * (shortTop ? bi - st : st + n - 1 - bi);   // tie: cover the short side
      if (cost < bestCost) { bestCost = cost; start = st; }
    }
    const marks = A.slice(start, start + n);
    // The ball (carrier, receiver, or the ball on the ground) gets the nearest defender: that's
    // the shut defender taking the inside man. Everyone else marks in order across the field.
    let ballMan = live[0], bestD = Infinity;
    const target = focus || b;
    for (const d of live) { const dd = dist(d, target); if (dd < bestD) { bestD = dd; ballMan = d; } }
    const others = live.filter((d) => d !== ballMan);
    const otherMarks = marks.filter((a) => a !== focus);
    const lineSpeed = T.line0 + s.level * T.lineInc;
    const chase = T.chase + s.level * T.chaseInc;
    const carrier = b.holder;
    const markUp = (d, a) => moveLine(d, clamp(a.x + T.gap, C.L + 60, C.TRY_X), clamp(a.y, C.T + C.R, C.B - C.R), lineSpeed * dt, T.mark * dt);
    if (carrier && dist(ballMan, carrier) < T.engage) moveToward(ballMan, carrier.x, carrier.y, chase * dt);
    else markUp(ballMan, focus);
    others.forEach((d, k) => { if (otherMarks[k]) markUp(d, otherMarks[k]); });
  }

  // Back to the onside line along the corner or shut path; a defender only counts once there.
  function retreat(s, d, dt) {
    const ty = d.retreatY == null ? d.y : d.retreatY;
    moveLine(d, s.onsideX, ty, s.T.setSpeed * dt, s.T.setSpeed * s.T.corner * dt);
    if (d.x >= s.onsideX - 1) d.onside = true;
  }

  // Before the touch: the marker rushes the ball carrier, the rest come up staggered behind.
  function rushUp(s, dt) {
    const T = s.T, c = s.dumper;
    let best = Infinity;
    for (const d of s.defenders) { const dd = dist(d, c); if (dd < best) { best = dd; s.marker = d; } }
    const slide = (c.y - C.MID) * T.slide;
    for (const d of s.defenders) {
      if (d === s.marker) { moveToward(d, c.x, c.y, T.markSpeed * dt); continue; }
      const tx = Math.min(s.marker.x + T.stagger, C.TRY_X);
      moveLine(d, tx, clamp(d.homeY + slide, C.T + T.margin, C.B - T.margin), T.lineUp * dt, T.lateral * dt);
    }
    separate(s.defenders);
    if (best < C.R * 2) dump(s, s.dumper, s.marker);
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

  // Who's the best option? Only teammates level with or behind the ball (no forward passes),
  // within passing range. Prefer someone with space around them and a clear run to the line.
  function bestReceiver(s, atLine) {
    const c = s.controlled, live = s.defenders.filter((d) => d.onside);
    let best = null, bestScore = -Infinity;
    for (const a of s.attackers) {
      if (a === c) continue;
      const range = dist(a, c);
      if (!atLine && (a.x > c.x + 6 || range > 300 || range < 20)) continue;
      let space = 220, lane = 160;
      for (const d of live) {
        space = Math.min(space, dist(d, a));
        if (d.x > a.x - C.R) lane = Math.min(lane, Math.abs(d.y - a.y));
      }
      const score = atLine ? -range : space + 0.8 * lane - 0.35 * range;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  function pass(s) {
    if (s.phase !== 'run' || s.flight) return false;
    const r = bestReceiver(s, false);
    if (!r) return false;
    s.ball.holder = null; s.flight = r;
    s.controlled = r;                           // you take over the receiver straight away
    s.halfRule = false;                         // once the half passes, anyone can score
    s.passes++;
    return true;
  }

  function step(s, dt, keys) {
    const T = s.T;
    if (s.phase === 'touched' || s.phase === 'scored') return;
    s.t += dt;

    if (s.phase === 'carry' || s.phase === 'set' || s.phase === 'run') moveControlled(s, dt, keys);

    if (s.phase === 'carry') {
      s.ball.x = s.dumper.x + 9; s.ball.y = s.dumper.y;
      support(s, dt, s.dumper);
      rushUp(s, dt);
      return;
    }

    if (s.phase === 'set') {
      support(s, dt, s.half);
      if (!s.released && s.t > T.release) { s.released = true; s.slowRelease = true; }
      if (s.released) defend(s, dt);
      else for (const d of s.defenders) {
        if (!d.onside) retreat(s, d, dt);
        else moveLine(d, s.onsideX, d.retreatY == null ? d.y : d.retreatY, T.setSpeed * dt, T.mark * dt);
      }
      separate(s.defenders);
      if (dist(s.half, s.ball) < C.R + 4) {     // half touches the ball: play is on
        s.ball.holder = s.half; s.phase = 'run'; s.released = true; s.t = 0;
      }
      return;
    }

    if (s.phase === 'run') {
      const c = s.controlled;
      if (s.flight) {                           // ball in the air: it homes in on the receiver
        const r = s.flight;
        moveToward(s.ball, r.x + 9, r.y, T.pass * dt);
        if (Math.hypot(s.ball.x - r.x - 9, s.ball.y - r.y) < 1) { s.ball.holder = r; s.flight = null; }
      } else {
        s.ball.x = c.x + 9; s.ball.y = c.y;
      }
      support(s, dt, c);
      defend(s, dt);
      separate(s.defenders);
      if (s.flight) return;
      for (const d of s.defenders) {
        if (d.onside && dist(d, c) < C.R * 2) {
          if (c === s.half && s.halfRule) { s.phase = 'touched'; s.reason = 'half'; }
          else dump(s, c, d);                    // touch counted: dump it and go again
          return;
        }
      }
      if (c.x >= C.TRY_X - C.R) {
        if (c === s.half && s.halfRule) {       // the half can't score: pop it to the best teammate
          s.receiver = bestReceiver(s, true);
          s.ball.holder = null; s.phase = 'passing'; s.t = 0;
        } else {
          s.receiver = c; s.phase = 'grounding'; s.t = 0;
        }
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

  const Engine = { C, LEVELS, TUNE, create, dump, pass, bestReceiver, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  if (typeof document === 'undefined') return;

  // -------------------------------------------------------------------- UI
  const canvas = document.getElementById('try-game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('try-game-status');
  const startBtn = document.getElementById('try-game-start');
  const dialog = document.getElementById('game-dialog');
  const passTouch = document.getElementById('try-pass-touch');
  const passBtn = document.getElementById('try-game-pass');
  const tallyEl = document.getElementById('try-game-tally');
  const fullBtn = document.getElementById('try-game-full');
  const stick = document.getElementById('try-stick');
  const knob = stick.querySelector('.stick-knob');

  const COLORS = {
    pitchA: '#174a32', pitchB: '#123F2A', chalk: 'rgba(245,246,239,.75)',
    chalkSoft: 'rgba(245,246,239,.35)', bib: '#F2C21B', ink: '#16201A',
    defender: '#F5F6EF', defenderText: '#123F2A'
  };

  let level = 0, tries = 0, playing = false, s = null, lastPhase = null, lastSlow = false, lastT = 0;
  const keys = { up: false, down: false, left: false, right: false, ax: 0, ay: 0 };

  const testLevel = Number(new URLSearchParams(location.search).get('level'));
  if (testLevel >= 1 && testLevel <= LEVELS.length) level = testLevel - 1;
  if (testLevel) window.__tryGame = () => s;

  const say = (text) => { statusEl.textContent = text; };
  const levelLabel = () => `Level ${level + 1} of ${LEVELS.length}: ${LEVELS[level].name}.`;
  const hasKeyboard = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const spaceTo = (what) => (hasKeyboard ? ` Press Space to ${what}.` : '');
  const clearKeys = () => { for (const k in keys) keys[k] = typeof keys[k] === 'number' ? 0 : false; resetStick(); };

  // Worldwide tally of tries scored, kept by Abacus (a free counting service). If it can't be
  // reached, the line simply stays hidden and the game carries on.
  const TALLY_URL = 'https://abacus.jasoncameron.dev';
  const TALLY_KEY = 'touchrugbyforyou/tries-scored';
  async function tally(op) {
    if (testLevel) return;                      // don't count test runs
    try {
      const res = await fetch(`${TALLY_URL}/${op}/${TALLY_KEY}`);
      if (!res.ok) return;
      const n = (await res.json()).value;
      if (typeof n !== 'number' || !isFinite(n)) return;
      tallyEl.textContent = `${n.toLocaleString()} ${n === 1 ? 'try' : 'tries'} scored by players so far`;
      tallyEl.hidden = false;
    } catch (err) { /* offline or blocked: leave the tally hidden */ }
  }

  function start() {
    s = create(level);
    playing = true; lastPhase = null; lastSlow = false;
    startBtn.hidden = true;
    canvas.focus({ preventScroll: true });
  }

  function onPhase(p) {
    passBtn.hidden = p !== 'run';
    if (p === 'carry') say(`${levelLabel()} Run it up. Wherever their marker touches you is where you dump the ball.`);
    if (p === 'set') say(s.touches >= 5
      ? 'Touch 5! Last chance: scoop it and score before the sixth touch.'
      : `Touch ${s.touches}! Ball dumped and the defence must retreat 7 m. You’re the half: scoop it quickly!`);
    if (p === 'run') say('Scooped! Run for the line, or press Space to pass to the open teammate (circled).');
    if (p === 'passing') say('At the line! The half can’t score, so you pass to your nearest teammate…');
    if (p === 'touched') {
      playing = false;
      say(s.reason === 'six'
        ? `That’s the sixth touch, so it’s a changeover.${spaceTo('try again')}`
        : `Touched! The half was caught with the ball, so it’s a changeover.${spaceTo('try again')}`);
      startBtn.textContent = 'Try again'; startBtn.hidden = false;
    }
    if (p === 'scored') {
      playing = false; tries++;
      tally('hit');
      if (level === LEVELS.length - 1) {
        say(`Try! You beat the full six. ${tries} tries scored.${spaceTo('play again')}`);
        startBtn.textContent = 'Play again'; level = 0;
      } else {
        level++;
        say(`Try! Next up, level ${level + 1}: ${LEVELS[level].name}.${spaceTo('start it')}`);
        startBtn.textContent = 'Next level';
      }
      startBtn.hidden = false;
    }
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
    const retreating = s.defenders.some((d) => !d.onside);
    if (s.phase === 'set' || (s.phase === 'run' && retreating)) {
      ctx.lineWidth = 2; vline(s.onsideX, COLORS.bib, [6, 8]);
      label('Onside line', s.onsideX, C.T + 12, COLORS.bib);
      ctx.strokeStyle = COLORS.bib; ctx.lineWidth = 2.5;
      const m = s.mark;
      ctx.beginPath(); ctx.moveTo(m.x - 6, m.y - 6); ctx.lineTo(m.x + 6, m.y + 6);
      ctx.moveTo(m.x + 6, m.y - 6); ctx.lineTo(m.x - 6, m.y + 6); ctx.stroke();
    }

    for (const d of s.defenders) {
      ctx.globalAlpha = d.onside ? 1 : 0.45;               // still retreating: can't make a touch yet
      dot(d, COLORS.defender, d.role, COLORS.defenderText);
      ctx.globalAlpha = 1;
    }
    // Show each defender's corner (yellow) or shut (white) path as the line resets after a touch.
    if (s.phase === 'set' || (s.phase === 'run' && retreating)) {
      ctx.lineWidth = 2; ctx.setLineDash([3, 5]);
      for (const d of s.defenders) {
        if (d.fromX == null) continue;
        const tx = s.onsideX, ty = d.retreatY;
        ctx.strokeStyle = d.call === 'Corner' ? 'rgba(242,194,27,.9)' : 'rgba(245,246,239,.8)';
        ctx.beginPath(); ctx.moveTo(d.fromX, d.fromY); ctx.lineTo(tx, ty); ctx.stroke();
        const ang = Math.atan2(ty - d.fromY, tx - d.fromX);                 // small arrowhead
        if (Math.hypot(tx - d.fromX, ty - d.fromY) > 10) {
          ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx - 8 * Math.cos(ang - 0.45), ty - 8 * Math.sin(ang - 0.45));
          ctx.lineTo(tx - 8 * Math.cos(ang + 0.45), ty - 8 * Math.sin(ang + 0.45));
          ctx.closePath(); ctx.fill(); ctx.setLineDash([3, 5]);
        }
      }
      ctx.setLineDash([]);
    }
    for (const a of s.attackers) dot(a, COLORS.bib, a.role, COLORS.ink);

    // Circle the teammate a pass would go to.
    if (playing && s.phase === 'run' && !s.flight) {
      const r = bestReceiver(s, false);
      if (r) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = COLORS.defender; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(r.x, r.y, C.R + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

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

    if (playing || s.touches) {                       // touch counter
      ctx.fillStyle = 'rgba(22,32,26,.65)';
      ctx.fillRect(C.L + 8, C.B - 30, 92, 22);
      ctx.fillStyle = COLORS.defender; ctx.font = '600 13px Barlow, Arial, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`Touch ${Math.min(s.touches, 6)} of 6`, C.L + 16, C.B - 19);
    }
  }

  // Overall game speed. Everything (players, defence, ball, timers) scales together,
  // so slowing it down doesn't change the difficulty balance.
  const GAME_SPEED = 0.75;

  function loop(t) {
    const dt = Math.min((t - lastT) / 1000 || 0, 0.05) * GAME_SPEED;
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
    if (!dialog.open) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'enter') {      // Space (or Enter): start / next level when idle, pass when playing
      e.preventDefault();
      if (!down || e.repeat) return;
      if (playing) doPass();
      else if (!startBtn.hidden) { clearKeys(); start(); }
      return;
    }
    if (!playing) return;
    const k = KEYMAP[key];
    if (!k) return;
    keys[k] = down;
    e.preventDefault();
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', clearKeys);

  // Joystick: drag anywhere in the circle; distance from the centre sets speed.
  const STICK_R = 46;
  let stickId = null;
  function resetStick() {
    stickId = null; keys.ax = 0; keys.ay = 0;
    if (knob) knob.style.transform = '';
  }
  function moveStick(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > STICK_R) { dx = dx / m * STICK_R; dy = dy / m * STICK_R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const ax = dx / STICK_R, ay = dy / STICK_R;
    const dead = Math.hypot(ax, ay) < 0.15;
    keys.ax = dead ? 0 : ax; keys.ay = dead ? 0 : ay;
  }
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) =>
    stick.addEventListener(t, (e) => { if (e.pointerId === stickId) resetStick(); }));
  passTouch.addEventListener('pointerdown', (e) => { e.preventDefault(); doPass(); });
  passBtn.addEventListener('click', () => { doPass(); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && playing) doPass(); });

  // Full screen: real full screen where the browser allows it, plus a layout that fills the window.
  function setFull(on) {
    dialog.classList.toggle('is-full', on);
    fullBtn.textContent = on ? 'Exit full screen' : 'Full screen';
  }
  fullBtn.addEventListener('click', async () => {
    const on = !dialog.classList.contains('is-full');
    setFull(on);
    try {
      if (on && dialog.requestFullscreen) {
        await dialog.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
      } else if (!on && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) { /* not allowed here (e.g. iPhone): the full-window layout still applies */ }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && dialog.classList.contains('is-full')) setFull(false);
  });

  function doPass() {
    if (!playing || !s || s.phase !== 'run' || s.flight) return;
    if (!pass(s)) say('No one to pass to yet. Passes can\u2019t go forward, so let a teammate get level or behind you.');
  }
  startBtn.addEventListener('click', () => { clearKeys(); start(); });

  // Pop-up: opened from the "play a mini-game while you wait" buttons.
  document.querySelectorAll('[data-open-game]').forEach((b) =>
    b.addEventListener('click', () => { dialog.showModal(); startBtn.focus(); tally('get'); }));
  document.querySelectorAll('[data-close-game]').forEach((b) =>
    b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    clearKeys();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFull(false);
    if (playing) {
      playing = false; s = create(level);
      passBtn.hidden = true;
      startBtn.hidden = false; startBtn.textContent = 'Start';
      say(levelLabel() + spaceTo('start'));
    }
  });

  s = create(level);
  say(levelLabel() + spaceTo('start'));
  requestAnimationFrame(loop);
})();
