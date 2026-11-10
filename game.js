(() => {
  'use strict';

  // ====== Konfigurasi ======
  const COLS = 16, ROWS = 12, TS = 50;
  const T = { FOREST: 0, PEAT: 1, VILLAGE: 2, RIVER: 3, BREAK: 4, BURNT: 5 };
  const DIFF = {
    mudah:  { name: 'Mudah',  spawn: 0.18, spread: 0.75, dur: 90 },
    normal: { name: 'Normal', spawn: 0.28, spread: 1.0,  dur: 90 },
    sulit:  { name: 'Sulit',  spawn: 0.40, spread: 1.3,  dur: 100 }
  };
  const COST = { water: 10, break: 8, wet: 15, wetBurning: 20 };
  const TICK = 0.7; // detik per "langkah" simulasi api
  const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // utara, timur, selatan, barat
  const WIND_ARROW = ['↑', '→', '↓', '←'];
  const WIND_NAME = ['Utara', 'Timur', 'Selatan', 'Barat'];

  const TIPS = [
    'Membuka lahan dengan cara membakar memang murah, tapi api mudah merambat tak terkendali, apalagi saat kemarau.',
    'Lahan gambut menyimpan banyak karbon. Kalau terbakar, apinya bisa membara di bawah tanah dan sulit dipadamkan.',
    'Asap karhutla bisa memicu gangguan pernapasan seperti ISPA, terutama pada anak-anak dan lansia.',
    'Hutan Papua punya keanekaragaman hayati tinggi, termasuk burung cendrawasih dan banyak satwa endemik.',
    'Membasahi gambut (misalnya dengan menyekat kanal) membantu menjaga gambut tetap lembap dan sulit terbakar.',
    'Sekat bakar membantu memutus rambatan api, tetapi membukanya berarti ada vegetasi yang hilang. Gunakan seperlunya.',
    'Masyarakat adat punya peran penting menjaga hutan. Kearifan lokal bisa jadi benteng pertama pencegahan karhutla.',
    'Arah angin sangat memengaruhi ke mana api menyebar. Perhatikan indikator angin di atas.',
    'Kemarau panjang, termasuk saat fenomena El Nino, meningkatkan risiko karhutla.',
    'Pencegahan lebih murah dan efektif daripada pemadaman. Laporkan titik api sedini mungkin ke BPBD atau Manggala Agni.'
  ];

  // ====== Elemen DOM ======
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * TS;
  canvas.height = ROWS * TS;

  let S = null;            // state permainan
  let hover = null;        // petak yang sedang di-hover
  let toastTimer = null;
  let last = performance.now();

  // ====== Utilitas ======
  const rand = (a, b) => a + Math.random() * (b - a);
  const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const flammable = (t) => (t.type === T.FOREST || t.type === T.PEAT);

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function setTip(i) {
    $('tip').textContent = TIPS[i % TIPS.length];
  }

  // ====== Pembuatan state & peta ======
  function newState(key) {
    const d = DIFF[key];
    const grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        row.push({ type: T.FOREST, fire: 0, wet: 0, hits: 0, seed: Math.random() });
      }
      grid.push(row);
    }

    // Gambut: beberapa bercak
    for (let i = 0; i < 3; i++) {
      const cr = Math.floor(Math.random() * ROWS);
      const cc = Math.floor(Math.random() * COLS);
      const rad = 1.6 + Math.random() * 1.2;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (Math.hypot(r - cr, c - cc) <= rad) grid[r][c].type = T.PEAT;
        }
      }
    }

    // Sungai berkelok dari atas ke bawah
    let rc = 3 + Math.floor(Math.random() * (COLS - 6));
    for (let r = 0; r < ROWS; r++) {
      grid[r][rc].type = T.RIVER;
      if (Math.random() < 0.45) {
        rc = Math.max(1, Math.min(COLS - 2, rc + (Math.random() < 0.5 ? -1 : 1)));
        grid[r][rc].type = T.RIVER;
      }
    }

    // Kampung
    let placed = 0, guard = 0;
    while (placed < 3 && guard++ < 300) {
      const r = Math.floor(Math.random() * ROWS);
      const c = Math.floor(Math.random() * COLS);
      const t = grid[r][c];
      if (t.type === T.RIVER || t.type === T.VILLAGE) continue;
      t.type = T.VILLAGE;
      placed++;
    }

    let totalVeg = 0;
    for (const row of grid) for (const t of row) if (flammable(t)) totalVeg++;

    const state = {
      d, grid, totalVeg,
      time: 0, tickAcc: 0,
      water: 100, haze: 0, village: 100,
      extinguished: 0,
      running: false, paused: false,
      tool: 'water',
      rain: 0, nextRain: rand(18, 28),
      wind: Math.floor(Math.random() * 4), windT: 14,
      particles: [],
      tipT: 0, tipI: 0
    };
    return state;
  }

  function ignite(t) {
    t.fire = t.type === T.PEAT ? 9 : 5;
    t.hits = 0;
  }

  function igniteRandom() {
    const pool = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = S.grid[r][c];
        if (flammable(t) && t.fire === 0 && t.wet <= 0) pool.push(t);
      }
    }
    if (!pool.length) return false;
    ignite(pool[Math.floor(Math.random() * pool.length)]);
    return true;
  }

  // ====== Logika per langkah ======
  function tick() {
    const g = S.grid;
    const burning = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (g[r][c].fire > 0) burning.push([r, c]);
    }

    const toIgnite = new Set();
    let hazeAdd = 0, villageHit = 0;

    for (const [r, c] of burning) {
      const src = g[r][c];
      hazeAdd += src.type === T.PEAT ? 0.5 : 0.2;

      for (let k = 0; k < 4; k++) {
        const nr = r + DIRS[k][0], nc = c + DIRS[k][1];
        if (!inBounds(nr, nc)) continue;
        const n = g[nr][nc];

        if (n.type === T.VILLAGE) { villageHit += 1.5; continue; }
        if (!flammable(n) || n.fire > 0 || n.wet > 0) continue;

        let p = (n.type === T.PEAT ? 0.26 : 0.17) * S.d.spread;
        if (k === S.wind) p *= 1.8;
        else if (k === (S.wind + 2) % 4) p *= 0.5;
        if (S.rain > 0) p *= 0.2;
        if (Math.random() < p) toIgnite.add(n);
      }
    }

    // Hujan memadamkan sebagian api
    if (S.rain > 0) {
      for (const [r, c] of burning) {
        if (Math.random() < 0.2) { g[r][c].fire = 0; g[r][c].hits = 0; }
      }
    }

    // Api membakar habis
    for (const [r, c] of burning) {
      const t = g[r][c];
      if (t.fire > 0) {
        t.fire--;
        if (t.fire === 0) t.type = T.BURNT;
      }
    }

    // Api baru merambat
    for (const n of toIgnite) if (n.fire === 0 && flammable(n)) ignite(n);

    // Titik api baru (misalnya dari pembukaan lahan dengan membakar)
    const spawnP = S.d.spawn * (1 + (S.time / S.d.dur) * 0.8);
    if (Math.random() < spawnP) {
      if (igniteRandom() && Math.random() < 0.35) toast('🔥 Titik api baru muncul dari pembukaan lahan dengan cara dibakar!');
    }

    // Pembasahan menyusut
    for (const row of g) for (const t of row) if (t.wet > 0) t.wet--;

    // Kabut asap & warga
    S.haze = Math.max(0, S.haze + hazeAdd - (S.rain > 0 ? 1.2 : 0.4));
    S.village = Math.max(0, S.village - villageHit);
  }

  function counts() {
    let veg = 0, fires = 0;
    for (const row of S.grid) {
      for (const t of row) {
        if (flammable(t)) veg++;
        if (t.fire > 0) fires++;
      }
    }
    return { veg, fires, vegPct: Math.round((veg / S.totalVeg) * 100) };
  }

  // ====== Update per frame ======
  function update(dt) {
    S.time += dt;
    S.water = Math.min(100, S.water + 7 * dt);

    // Hujan
    S.nextRain -= dt;
    if (S.nextRain <= 0 && S.rain <= 0) {
      S.rain = 6;
      S.nextRain = rand(25, 40);
      toast('🌧️ Hujan turun! Api melemah sementara.');
    }
    if (S.rain > 0) S.rain -= dt;

    // Angin
    S.windT -= dt;
    if (S.windT <= 0) {
      S.wind = Math.floor(Math.random() * 4);
      S.windT = 14;
      toast('💨 Arah angin berubah ke ' + WIND_NAME[S.wind] + '.');
    }

    // Tip bergilir
    S.tipT += dt;
    if (S.tipT > 12) { S.tipT = 0; S.tipI++; setTip(S.tipI); }

    // Langkah simulasi
    S.tickAcc += dt;
    while (S.tickAcc >= TICK) { S.tickAcc -= TICK; tick(); }

    // Partikel asap
    const drift = DIRS[S.wind][1] * 14;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = S.grid[r][c];
        if (t.fire > 0 && S.particles.length < 160 && Math.random() < dt * (t.type === T.PEAT ? 5 : 2.5)) {
          S.particles.push({
            x: c * TS + rand(10, 40), y: r * TS + rand(10, 30),
            vx: drift + rand(-6, 6), vy: rand(-28, -14),
            life: 0, max: rand(1.2, 2.2), r: rand(6, 12)
          });
        }
      }
    }
    for (const p of S.particles) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 6 * dt;
    }
    S.particles = S.particles.filter((p) => p.life < p.max);

    updateHud();

    // Cek menang / kalah
    const { vegPct } = counts();
    if (S.haze >= 100) return endGame(false, 'Kabut asap menyelimuti wilayah dan membahayakan kesehatan warga.');
    if (S.village <= 0) return endGame(false, 'Api sampai ke permukiman dan keselamatan warga terancam.');
    if (vegPct < 30) return endGame(false, 'Lebih dari 70% hutan dan gambut sudah hilang.');
    if (S.time >= S.d.dur) return endGame(true, 'Musim kemarau berhasil kamu lewati. Hutan Papua selamat!');
  }

  function updateHud() {
    const { vegPct, fires } = counts();
    $('hud-time').textContent = Math.max(0, Math.ceil(S.d.dur - S.time));
    $('hud-veg').textContent = vegPct + '%';
    $('hud-fires').textContent = fires;
    $('hud-wind').textContent = WIND_ARROW[S.wind] + ' ' + WIND_NAME[S.wind];
    $('bar-water').firstElementChild.style.width = S.water + '%';
    $('bar-haze').firstElementChild.style.width = Math.min(100, S.haze) + '%';
    $('bar-village').firstElementChild.style.width = S.village + '%';
  }

  // ====== Aksi pemain ======
  function extinguish(t) {
    t.fire = 0; t.hits = 0; t.wet = 3;
    S.extinguished++;
  }

  function act(r, c) {
    const t = S.grid[r][c];
    const tool = S.tool;

    if (tool === 'water') {
      if (t.fire <= 0) return toast('Tidak ada api di petak ini.');
      if (S.water < COST.water) return toast('Air habis! Tunggu terisi lagi.');
      S.water -= COST.water;
      if (t.type === T.PEAT && t.hits < 1) {
        t.hits++;
        return toast('Api gambut membara di bawah tanah. Siram sekali lagi!');
      }
      extinguish(t);
      return;
    }

    if (tool === 'break') {
      if (!flammable(t) || t.fire > 0) return toast('Sekat api hanya untuk hutan/gambut yang belum terbakar.');
      if (S.water < COST.break) return toast('Tenaga/air belum cukup.');
      S.water -= COST.break;
      t.type = T.BREAK;
      return;
    }

    if (tool === 'wet') {
      if (t.type !== T.PEAT) return toast('Pembasahan khusus untuk lahan gambut (petak cokelat).');
      const cost = t.fire > 0 ? COST.wetBurning : COST.wet;
      if (S.water < cost) return toast('Air belum cukup.');
      S.water -= cost;
      if (t.fire > 0) { extinguish(t); }
      t.wet = 30;
      t.hits = 0;
    }
  }

  // ====== Input ======
  function tileAt(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / TS), r = Math.floor(y / TS);
    return inBounds(r, c) ? { r, c } : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!S || !S.running || S.paused) return;
    const p = tileAt(e);
    if (p) act(p.r, p.c);
  });
  canvas.addEventListener('pointermove', (e) => { hover = tileAt(e); });
  canvas.addEventListener('pointerleave', () => { hover = null; });

  function setTool(name) {
    if (!S) return;
    S.tool = name;
    document.querySelectorAll('.tool[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === name);
    });
  }
  document.querySelectorAll('.tool[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });

  function togglePause() {
    if (!S || !S.running) return;
    S.paused = !S.paused;
    $('btn-pause').textContent = S.paused ? '▶️ Lanjut (P)' : '⏸️ Jeda (P)';
    if (S.paused) toast('Permainan dijeda');
  }
  $('btn-pause').addEventListener('click', togglePause);

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') setTool('water');
    else if (e.key === '2') setTool('break');
    else if (e.key === '3') setTool('wet');
    else if (e.key.toLowerCase() === 'p') togglePause();
  });

  // ====== Overlay (mulai & selesai) ======
  const overlay = $('overlay');

  function showStart() {
    S = newState('normal'); // peta latar belakang saja
    S.running = false;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="card">
        <h2>🌳 Jaga Hutan Papua</h2>
        <p>Musim kemarau tiba dan titik api bermunculan. Selamatkan hutan, gambut, dan kampung sampai waktu habis.</p>
        <ul>
          <li><b>💧 Padamkan:</b> klik petak yang terbakar (gambut perlu 2 kali siram).</li>
          <li><b>🪓 Sekat api:</b> ubah petak hutan jadi pembatas supaya api tidak menjalar.</li>
          <li><b>🌊 Basahi gambut:</b> gambut basah sulit terbakar.</li>
          <li>Perhatikan <b>arah angin</b>, <b>air</b>, dan <b>kabut asap</b>.</li>
        </ul>
        <p>Pilih tingkat kesulitan:</p>
        <div class="btn-row">
          <button class="btn alt" data-diff="mudah">Mudah</button>
          <button class="btn" data-diff="normal">Normal</button>
          <button class="btn hard" data-diff="sulit">Sulit</button>
        </div>
      </div>`;
  }

  function startGame(key) {
    S = newState(key);
    S.running = true;
    igniteRandom();
    igniteRandom();
    overlay.classList.add('hidden');
    $('btn-pause').textContent = '⏸️ Jeda (P)';
    setTool('water');
    setTip(0);
    toast('Mulai! Padamkan api secepat mungkin 🔥');
    updateHud();
  }

  function endGame(win, reason) {
    S.running = false;
    const { vegPct } = counts();
    const score = Math.round(vegPct * 10 + S.extinguished * 8 + S.village * 3 + (100 - Math.min(100, S.haze)) * 2);
    let rank = 'Relawan Pemula';
    if (score > 1300) rank = 'Penjaga Hutan Legendaris';
    else if (score > 1000) rank = 'Pemadam Handal';
    else if (score > 700) rank = 'Pejuang Lingkungan';
    if (!win) rank = 'Perlu Coba Lagi';

    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="card">
        <h2>${win ? '🎉 Hutan Terselamatkan!' : '😢 Karhutla Tak Terkendali'}</h2>
        <p>${reason}</p>
        <p>🌳 Hutan tersisa: <b>${vegPct}%</b> · 🔥 Api dipadamkan: <b>${S.extinguished}</b><br>
           🏠 Keselamatan warga: <b>${Math.round(S.village)}%</b> · 🌫️ Kabut asap: <b>${Math.round(Math.min(100, S.haze))}%</b></p>
        <p>Skor: <b>${score}</b> · Peringkat: <b>${rank}</b></p>
        <p>💡 ${tip}</p>
        <div class="btn-row">
          <button class="btn" data-diff="${Object.keys(DIFF).find((k) => DIFF[k] === S.d)}">Main lagi</button>
          <button class="btn alt" data-menu="1">Menu utama</button>
        </div>
      </div>`;
  }

  overlay.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.diff) startGame(b.dataset.diff);
    else if (b.dataset.menu) showStart();
  });

  // ====== Render ======
  function tree(cx, cy, rad) {
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(cx - 1.5, cy + 3, 3, 7);
    ctx.fillStyle = '#1b5e20';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#43a047';
    ctx.beginPath(); ctx.arc(cx - rad * 0.25, cy - rad * 0.25, rad * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawTile(r, c, t, time) {
    const x = c * TS, y = r * TS;
    switch (t.type) {
      case T.FOREST:
        ctx.fillStyle = '#2f6b2f'; ctx.fillRect(x, y, TS, TS);
        tree(x + 14, y + 16, 8 + t.seed * 3);
        tree(x + 36, y + 20, 8 + ((t.seed * 7) % 1) * 3);
        tree(x + 25, y + 37, 8 + ((t.seed * 13) % 1) * 3);
        break;
      case T.PEAT:
        ctx.fillStyle = '#5d4037'; ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#3e2723';
        for (let i = 0; i < 6; i++) {
          const px = x + (((t.seed * (i + 3) * 97) % 1) * (TS - 8)) + 2;
          const py = y + (((t.seed * (i + 5) * 53) % 1) * (TS - 8)) + 2;
          ctx.fillRect(px, py, 5, 3);
        }
        break;
      case T.VILLAGE:
        ctx.fillStyle = '#c9b27c'; ctx.fillRect(x, y, TS, TS);
        ctx.font = '28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🏠', x + TS / 2, y + TS / 2 + 2);
        break;
      case T.RIVER:
        ctx.fillStyle = '#1976d2'; ctx.fillRect(x, y, TS, TS);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          const yy = y + 10 + i * 14;
          ctx.moveTo(x + 6, yy);
          ctx.quadraticCurveTo(x + 18, yy + Math.sin(time * 2 + i + c) * 4, x + 30, yy);
          ctx.quadraticCurveTo(x + 38, yy - Math.sin(time * 2 + i) * 4, x + 44, yy);
          ctx.stroke();
        }
        break;
      case T.BREAK:
        ctx.fillStyle = '#bca27a'; ctx.fillRect(x, y, TS, TS);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
        for (let i = -TS; i < TS; i += 12) {
          ctx.beginPath(); ctx.moveTo(x + i, y + TS); ctx.lineTo(x + i + TS, y); ctx.stroke();
        }
        break;
      case T.BURNT:
        ctx.fillStyle = '#1c1c1c'; ctx.fillRect(x, y, TS, TS);
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(x + 6, y + 8, 14, 8);
        ctx.fillRect(x + 26, y + 26, 16, 10);
        break;
    }

    // Gambut/hutan basah
    if (t.wet > 0 && t.fire === 0) {
      ctx.fillStyle = 'rgba(41,182,246,0.35)';
      ctx.fillRect(x, y, TS, TS);
    }

    // Api
    if (t.fire > 0) {
      ctx.fillStyle = t.type === T.PEAT ? 'rgba(200,40,0,0.45)' : 'rgba(255,87,34,0.35)';
      ctx.fillRect(x, y, TS, TS);
      for (let i = 0; i < 3; i++) {
        const fx = x + 10 + i * 15;
        const h = 12 + 7 * Math.sin(time * 8 + t.seed * 10 + i * 2) + (t.type === T.PEAT ? 3 : 0);
        ctx.fillStyle = '#ff5722';
        ctx.beginPath();
        ctx.moveTo(fx - 7, y + TS - 6);
        ctx.quadraticCurveTo(fx, y + TS - 6 - h * 2.2, fx + 7, y + TS - 6);
        ctx.fill();
        ctx.fillStyle = '#ffca28';
        ctx.beginPath();
        ctx.moveTo(fx - 4, y + TS - 6);
        ctx.quadraticCurveTo(fx, y + TS - 6 - h * 1.3, fx + 4, y + TS - 6);
        ctx.fill();
      }
      if (t.type === T.PEAT && t.hits > 0) {
        ctx.strokeStyle = '#29b6f6'; ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, TS - 4, TS - 4);
      }
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
  }

  function draw(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!S) return;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) drawTile(r, c, S.grid[r][c], time);
    }

    // Asap
    for (const p of S.particles) {
      const a = (1 - p.life / p.max) * 0.35;
      ctx.fillStyle = `rgba(90,90,90,${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }

    // Kabut
    if (S.haze > 0) {
      ctx.fillStyle = `rgba(130,130,130,${Math.min(1, S.haze / 100) * 0.55})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Hujan
    if (S.rain > 0) {
      ctx.strokeStyle = 'rgba(180,220,255,0.6)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 90; i++) {
        const x = (i * 97 + time * 220) % canvas.width;
        const y = (i * 53 + time * 520) % canvas.height;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 12); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,40,80,0.18)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Sorotan petak
    if (hover && S.running && !S.paused) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.strokeRect(hover.c * TS + 1, hover.r * TS + 1, TS - 2, TS - 2);
    }

    if (S.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⏸️ Dijeda', canvas.width / 2, canvas.height / 2);
    }
  }

  // ====== Loop utama ======
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (S && S.running && !S.paused) update(dt);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  showStart();
  requestAnimationFrame(frame);
})();
