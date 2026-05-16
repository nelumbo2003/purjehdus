const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'purjehdus.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== SCHEMA =====
db.exec(`
  CREATE TABLE IF NOT EXISTS competitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    num_sailors INTEGER NOT NULL,
    num_boats INTEGER NOT NULL,
    num_races INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS comp_sailors (
    comp_id INTEGER NOT NULL,
    sailor_key TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (comp_id, sailor_key),
    FOREIGN KEY (comp_id) REFERENCES competitions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS comp_boats (
    comp_id INTEGER NOT NULL,
    boat_key INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (comp_id, boat_key),
    FOREIGN KEY (comp_id) REFERENCES competitions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS comp_schedule (
    comp_id INTEGER NOT NULL,
    race_index INTEGER NOT NULL,
    boat_key INTEGER NOT NULL,
    sailor_key TEXT NOT NULL,
    PRIMARY KEY (comp_id, race_index, boat_key),
    FOREIGN KEY (comp_id) REFERENCES competitions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS comp_results (
    comp_id INTEGER NOT NULL,
    race_index INTEGER NOT NULL,
    sailor_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (comp_id, race_index, sailor_key),
    FOREIGN KEY (comp_id) REFERENCES competitions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS finals_schedule (
    comp_id INTEGER NOT NULL,
    fleet TEXT NOT NULL,
    race_index INTEGER NOT NULL,
    boat_key INTEGER NOT NULL,
    sailor_key TEXT NOT NULL,
    PRIMARY KEY (comp_id, fleet, race_index, boat_key),
    FOREIGN KEY (comp_id) REFERENCES competitions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS finals_results (
    comp_id INTEGER NOT NULL,
    fleet TEXT NOT NULL,
    race_index INTEGER NOT NULL,
    sailor_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (comp_id, fleet, race_index, sailor_key),
    FOREIGN KEY (comp_id) REFERENCES competitions(id) ON DELETE CASCADE
  );
`);

// ===== MIGRAATIO: vanha data → uusi skeema =====
function migrateOldData() {
  const oldTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sailors'").get();
  if (!oldTables) return;

  const existing = db.prepare('SELECT COUNT(*) as c FROM competitions').get();
  if (existing.c > 0) {
    // Already migrated, drop old tables
    db.exec('DROP TABLE IF EXISTS results; DROP TABLE IF EXISTS boats; DROP TABLE IF EXISTS sailors;');
    return;
  }

  console.log('Migrating old data to new schema...');

  // Old schedule (hardcoded in previous server.js)
  const OLD_SCHEDULE = [
    {1:'G',2:'J',3:'I',4:'A'},{1:'H',2:'E',3:'C',4:'G'},{1:'B',2:'A',3:'E',4:'F'},
    {1:'D',2:'I',3:'B',4:'C'},{1:'J',2:'G',3:'F',4:'D'},{1:'I',2:'F',3:'A',4:'H'},
    {1:'E',2:'H',3:'D',4:'J'},{1:'F',2:'C',3:'J',4:'B'},{1:'G',2:'B',3:'H',4:'I'},
    {1:'C',2:'D',3:'A',4:'E'},{1:'C',2:'E',3:'J',4:'I'},{1:'A',2:'F',3:'G',4:'D'},
    {1:'A',2:'B',3:'C',4:'H'},{1:'I',2:'D',3:'B',4:'E'},{1:'F',2:'H',3:'D',4:'J'},
    {1:'B',2:'G',3:'E',4:'F'},{1:'D',2:'A',3:'G',4:'C'},{1:'H',2:'J',3:'B',4:'A'},
    {1:'C',2:'I',3:'F',4:'H'},{1:'E',2:'J',3:'I',4:'G'},
  ];

  const tx = db.transaction(() => {
    // Create competition
    const res = db.prepare(
      'INSERT INTO competitions (name, date, num_sailors, num_boats, num_races) VALUES (?, ?, ?, ?, ?)'
    ).run('Astree Hyppeis Challenge', '2026-05-16', 10, 4, 20);
    const compId = res.lastInsertRowid;

    // Migrate sailors
    const oldSailors = db.prepare('SELECT id, name FROM sailors ORDER BY id').all();
    const insSailor = db.prepare('INSERT INTO comp_sailors (comp_id, sailor_key, name) VALUES (?, ?, ?)');
    oldSailors.forEach(s => insSailor.run(compId, s.id, s.name));

    // Migrate boats
    const oldBoats = db.prepare('SELECT id, name FROM boats ORDER BY id').all();
    const insBoat = db.prepare('INSERT INTO comp_boats (comp_id, boat_key, name) VALUES (?, ?, ?)');
    oldBoats.forEach(b => insBoat.run(compId, b.id, b.name));

    // Insert schedule
    const insSched = db.prepare('INSERT INTO comp_schedule (comp_id, race_index, boat_key, sailor_key) VALUES (?, ?, ?, ?)');
    OLD_SCHEDULE.forEach((race, ri) => {
      Object.entries(race).forEach(([boat, sailor]) => {
        insSched.run(compId, ri, parseInt(boat), sailor);
      });
    });

    // Migrate results
    const oldResults = db.prepare('SELECT race_index, sailor_id, position FROM results').all();
    const insResult = db.prepare('INSERT INTO comp_results (comp_id, race_index, sailor_key, position) VALUES (?, ?, ?, ?)');
    oldResults.forEach(r => insResult.run(compId, r.race_index, r.sailor_id, r.position));

    // Drop old tables
    db.exec('DROP TABLE IF EXISTS results; DROP TABLE IF EXISTS boats; DROP TABLE IF EXISTS sailors;');
  });
  tx();
  console.log('Migration complete.');
}
migrateOldData();

// ===== SCHEDULE ALGORITHM =====
const SAILOR_KEYS = 'ABCDEFGHIJKL'.split('');

function generateSchedule(numSailors, numBoats, numRaces) {
  const sailors = SAILOR_KEYS.slice(0, numSailors);
  const boats = Array.from({length: numBoats}, (_, i) => i + 1);
  const racesPerSailor = Math.floor((numRaces * numBoats) / numSailors);
  const idealPairs = (numRaces * numBoats * (numBoats - 1) / 2) /
    (numSailors * (numSailors - 1) / 2);

  let bestSchedule = null;
  let bestScore = Infinity;

  function seedRandom(seed) {
    let s = seed;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  for (let attempt = 0; attempt < 8000; attempt++) {
    const rng = seedRandom(attempt);
    const participation = {};
    const pairs = {};
    const schedule = [];
    sailors.forEach(s => participation[s] = 0);

    for (let ri = 0; ri < numRaces; ri++) {
      const eligible = sailors.filter(s => participation[s] < racesPerSailor);
      const pool = eligible.length >= numBoats ? eligible : [...sailors];

      // Try candidates
      let bestPick = null, bestPickScore = Infinity;
      const tries = pool.length <= numBoats + 3
        ? getCombinations(pool, numBoats)
        : Array.from({length: 40}, () => {
            const shuffled = [...pool].sort(() => rng() - 0.5);
            return shuffled.slice(0, numBoats);
          });

      for (const pick of tries) {
        let score = 0;
        for (let i = 0; i < pick.length; i++) {
          for (let j = i + 1; j < pick.length; j++) {
            const key = pick[i] < pick[j] ? `${pick[i]}-${pick[j]}` : `${pick[j]}-${pick[i]}`;
            const cur = (pairs[key] || 0) + 1;
            if (cur > 3) score += (cur - 2) ** 3;
            else if (cur > 2) score += 1;
            if ((pairs[key] || 0) === 0) score -= 3;
            else if ((pairs[key] || 0) === 1) score -= 1;
          }
        }
        // Streak penalty
        for (const p of pick) {
          let streak = 0;
          for (let k = schedule.length - 1; k >= 0; k--) {
            if (schedule[k].includes(p)) streak++; else break;
          }
          if (streak >= 2) score += (streak - 1) ** 2 * 5;
        }
        if (score < bestPickScore) { bestPickScore = score; bestPick = pick; }
      }

      for (const p of bestPick) participation[p]++;
      for (let i = 0; i < bestPick.length; i++) {
        for (let j = i + 1; j < bestPick.length; j++) {
          const key = bestPick[i] < bestPick[j] ? `${bestPick[i]}-${bestPick[j]}` : `${bestPick[j]}-${bestPick[i]}`;
          pairs[key] = (pairs[key] || 0) + 1;
        }
      }
      schedule.push(bestPick);
    }

    // Score overall
    const pVals = Object.values(participation);
    const pScore = Math.max(...pVals) - Math.min(...pVals);

    const allPairKeys = [];
    for (let i = 0; i < sailors.length; i++)
      for (let j = i + 1; j < sailors.length; j++)
        allPairKeys.push(`${sailors[i]}-${sailors[j]}`);
    const pairVals = allPairKeys.map(k => pairs[k] || 0);
    const missing = pairVals.filter(v => v === 0).length;
    const pairRange = Math.max(...pairVals) - Math.min(...pairVals);
    const pairAvg = pairVals.reduce((a,b)=>a+b,0) / pairVals.length;
    const pairVar = pairVals.reduce((a,v)=>a+(v-pairAvg)**2, 0) / pairVals.length;

    // Scheduling smoothness
    let schedScore = 0;
    for (const s of sailors) {
      const inRace = schedule.map(r => r.includes(s) ? 1 : 0);
      let maxStreak = 0, streak = 0, maxGap = 0, gap = 0;
      for (const m of inRace) { if (m) { streak++; maxStreak = Math.max(maxStreak, streak); gap = 0; } else { gap++; maxGap = Math.max(maxGap, gap); streak = 0; } }
      if (maxStreak >= 3) schedScore += (maxStreak - 2) ** 2;
      if (maxGap >= 5) schedScore += (maxGap - 3) ** 2;
      const idxs = []; inRace.forEach((m, i) => { if (m) idxs.push(i); });
      if (idxs.length >= 2) {
        const ideal = numRaces / racesPerSailor;
        for (let k = 0; k < idxs.length - 1; k++) schedScore += ((idxs[k+1]-idxs[k]) - ideal) ** 2;
      }
    }

    const totalScore = pScore * 500 + missing * 300 + pairRange * 80 + pairVar * 40 + schedScore * 3;
    if (totalScore < bestScore) { bestScore = totalScore; bestSchedule = schedule; }
  }

  // Assign boats optimally
  const boatCount = {};
  sailors.forEach(s => { boatCount[s] = {}; boats.forEach(b => boatCount[s][b] = 0); });
  const result = [];

  for (const raceSailors of bestSchedule) {
    const perms = getPermutations(Array.from({length: numBoats}, (_, i) => i));
    let bestPerm = perms[0], bestPermScore = Infinity;
    for (const perm of perms) {
      let score = 0;
      for (let i = 0; i < numBoats; i++) {
        const sailor = raceSailors[perm[i]];
        score += (boatCount[sailor][boats[i]] + 1) ** 2;
      }
      if (score < bestPermScore) { bestPermScore = score; bestPerm = perm; }
    }
    const race = {};
    for (let i = 0; i < numBoats; i++) {
      const sailor = raceSailors[bestPerm[i]];
      race[boats[i]] = sailor;
      boatCount[sailor][boats[i]]++;
    }
    result.push(race);
  }

  return result;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = getCombinations(arr.slice(i + 1), k - 1);
    rest.forEach(r => result.push([arr[i], ...r]));
  }
  return result;
}

function getPermutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    getPermutations(rest).forEach(p => result.push([arr[i], ...p]));
  }
  return result;
}

// ===== LATIN SQUARE for finals =====
function generateLatinSquare(sailorIds, numBoats) {
  const n = sailorIds.length; // should equal numBoats
  const shuffledSailors = [...sailorIds].sort(() => Math.random() - 0.5);
  const shuffledBoats = Array.from({length: n}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  const races = [];
  for (let r = 0; r < n; r++) {
    const race = {};
    for (let b = 0; b < n; b++) {
      race[shuffledBoats[b]] = shuffledSailors[(r + b) % n];
    }
    races.push(race);
  }
  // Shuffle race order
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [races[i], races[j]] = [races[j], races[i]];
  }
  return races;
}

// ===== STANDINGS =====
function computeStandings(sailorKeys, resultsRows) {
  const pts = {}, counts = {}, posDist = {};
  sailorKeys.forEach(s => { pts[s] = 0; counts[s] = 0; posDist[s] = {}; });

  resultsRows.forEach(r => {
    pts[r.sailor_key] = (pts[r.sailor_key] || 0) + r.position;
    counts[r.sailor_key] = (counts[r.sailor_key] || 0) + 1;
    if (!posDist[r.sailor_key]) posDist[r.sailor_key] = {};
    posDist[r.sailor_key][r.position] = (posDist[r.sailor_key][r.position] || 0) + 1;
  });

  return sailorKeys
    .map(s => ({ key: s, pts: pts[s], races: counts[s], posDist: posDist[s] || {} }))
    .sort((a, b) => {
      if (!a.races && !b.races) return a.key.localeCompare(b.key);
      if (!a.races) return 1;
      if (!b.races) return -1;
      if (a.pts !== b.pts) return a.pts - b.pts;
      for (let p = 1; p <= 10; p++) {
        const ac = a.posDist[p] || 0, bc = b.posDist[p] || 0;
        if (ac !== bc) return bc - ac;
      }
      return a.key.localeCompare(b.key);
    });
}

function getFleetNames(numSailors, numBoats) {
  const numFleets = Math.ceil(numSailors / numBoats);
  const names = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
  return names.slice(0, numFleets);
}

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== COMPETITIONS API =====

app.get('/api/competitions', (req, res) => {
  res.json(db.prepare('SELECT * FROM competitions ORDER BY date DESC').all());
});

app.post('/api/competitions', (req, res) => {
  const { name, date, num_sailors, num_boats, num_races, sailors, boats } = req.body;
  if (!name || !date || !num_sailors || !num_boats) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const ns = Math.max(4, Math.min(12, parseInt(num_sailors)));
  const nb = Math.max(2, Math.min(4, parseInt(num_boats)));
  const nr = parseInt(num_races) || Math.max(10, ns * 2);

  const tx = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO competitions (name, date, num_sailors, num_boats, num_races) VALUES (?,?,?,?,?)'
    ).run(name, date, ns, nb, nr);
    const compId = r.lastInsertRowid;

    // Insert sailors
    const sailorKeys = SAILOR_KEYS.slice(0, ns);
    const insSailor = db.prepare('INSERT INTO comp_sailors (comp_id, sailor_key, name) VALUES (?,?,?)');
    sailorKeys.forEach((key, i) => {
      const sname = (sailors && sailors[i]) ? sailors[i] : key;
      insSailor.run(compId, key, sname);
    });

    // Insert boats
    const insBoat = db.prepare('INSERT INTO comp_boats (comp_id, boat_key, name) VALUES (?,?,?)');
    for (let i = 1; i <= nb; i++) {
      const bname = (boats && boats[i-1]) ? boats[i-1] : `Vene ${i}`;
      insBoat.run(compId, i, bname);
    }

    // Generate schedule
    const schedule = generateSchedule(ns, nb, nr);
    const insSched = db.prepare('INSERT INTO comp_schedule (comp_id, race_index, boat_key, sailor_key) VALUES (?,?,?,?)');
    schedule.forEach((race, ri) => {
      Object.entries(race).forEach(([boat, sailor]) => {
        insSched.run(compId, ri, parseInt(boat), sailor);
      });
    });

    return { id: compId };
  });

  const result = tx();
  res.json(result);
});

app.get('/api/competitions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(id);
  if (!comp) return res.status(404).json({ error: 'Not found' });

  const sailors = db.prepare('SELECT sailor_key, name FROM comp_sailors WHERE comp_id = ? ORDER BY sailor_key').all(id);
  const boats = db.prepare('SELECT boat_key, name FROM comp_boats WHERE comp_id = ? ORDER BY boat_key').all(id);

  // Schedule as array of {boat_key: sailor_key}
  const schedRows = db.prepare('SELECT race_index, boat_key, sailor_key FROM comp_schedule WHERE comp_id = ? ORDER BY race_index, boat_key').all(id);
  const schedule = [];
  schedRows.forEach(r => {
    if (!schedule[r.race_index]) schedule[r.race_index] = {};
    schedule[r.race_index][r.boat_key] = r.sailor_key;
  });

  // Results as {race_index: {sailor_key: position}}
  const resRows = db.prepare('SELECT race_index, sailor_key, position FROM comp_results WHERE comp_id = ?').all(id);
  const results = {};
  resRows.forEach(r => {
    if (!results[r.race_index]) results[r.race_index] = {};
    results[r.race_index][r.sailor_key] = r.position;
  });

  // Finals schedule
  const fSchedRows = db.prepare('SELECT fleet, race_index, boat_key, sailor_key FROM finals_schedule WHERE comp_id = ? ORDER BY fleet, race_index, boat_key').all(id);
  const finalsSchedule = {};
  fSchedRows.forEach(r => {
    if (!finalsSchedule[r.fleet]) finalsSchedule[r.fleet] = [];
    if (!finalsSchedule[r.fleet][r.race_index]) finalsSchedule[r.fleet][r.race_index] = {};
    finalsSchedule[r.fleet][r.race_index][r.boat_key] = r.sailor_key;
  });

  // Finals results
  const fResRows = db.prepare('SELECT fleet, race_index, sailor_key, position FROM finals_results WHERE comp_id = ?').all(id);
  const finalsResults = {};
  fResRows.forEach(r => {
    if (!finalsResults[r.fleet]) finalsResults[r.fleet] = {};
    if (!finalsResults[r.fleet][r.race_index]) finalsResults[r.fleet][r.race_index] = {};
    finalsResults[r.fleet][r.race_index][r.sailor_key] = r.position;
  });

  res.json({ ...comp, sailors, boats, schedule, results, finalsSchedule, finalsResults });
});

app.delete('/api/competitions/:id', (req, res) => {
  db.prepare('DELETE FROM competitions WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// ===== SAILORS & BOATS =====

app.put('/api/competitions/:id/sailors', (req, res) => {
  const id = parseInt(req.params.id);
  const upd = db.prepare('UPDATE comp_sailors SET name = ? WHERE comp_id = ? AND sailor_key = ?');
  const tx = db.transaction(() => {
    req.body.forEach(s => upd.run(s.name, id, s.sailor_key));
  });
  tx();
  res.json({ ok: true });
});

app.put('/api/competitions/:id/boats', (req, res) => {
  const id = parseInt(req.params.id);
  const upd = db.prepare('UPDATE comp_boats SET name = ? WHERE comp_id = ? AND boat_key = ?');
  const tx = db.transaction(() => {
    req.body.forEach(b => upd.run(b.name, id, b.boat_key));
  });
  tx();
  res.json({ ok: true });
});

// ===== RESULTS =====

app.put('/api/competitions/:id/results/:raceIndex', (req, res) => {
  const compId = parseInt(req.params.id);
  const ri = parseInt(req.params.raceIndex);
  const comp = db.prepare('SELECT num_boats FROM competitions WHERE id = ?').get(compId);
  if (!comp) return res.status(404).json({ error: 'Competition not found' });

  const positions = req.body;
  const entries = Object.entries(positions);
  if (entries.length !== comp.num_boats) return res.status(400).json({ error: `${comp.num_boats} sailors required` });
  const posVals = entries.map(e => e[1]).sort((a,b) => a-b);
  const expected = Array.from({length: comp.num_boats}, (_, i) => i + 1);
  if (JSON.stringify(posVals) !== JSON.stringify(expected)) {
    return res.status(400).json({ error: `Positions must be 1-${comp.num_boats}` });
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM comp_results WHERE comp_id = ? AND race_index = ?').run(compId, ri);
    const ins = db.prepare('INSERT INTO comp_results (comp_id, race_index, sailor_key, position) VALUES (?,?,?,?)');
    entries.forEach(([sailor, pos]) => ins.run(compId, ri, sailor, pos));
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/results/:raceIndex', (req, res) => {
  db.prepare('DELETE FROM comp_results WHERE comp_id = ? AND race_index = ?')
    .run(parseInt(req.params.id), parseInt(req.params.raceIndex));
  res.json({ ok: true });
});

// ===== FINALS =====

app.post('/api/competitions/:id/finals/generate/:fleet', (req, res) => {
  const compId = parseInt(req.params.id);
  const fleet = req.params.fleet;
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(compId);
  if (!comp) return res.status(404).json({ error: 'Competition not found' });

  const fleetNames = getFleetNames(comp.num_sailors, comp.num_boats);
  if (!fleetNames.includes(fleet)) return res.status(400).json({ error: 'Invalid fleet' });

  // Check prerequisites
  const allResults = db.prepare('SELECT race_index, sailor_key, position FROM comp_results WHERE comp_id = ?').all(compId);
  const racesDone = new Set(allResults.map(r => r.race_index)).size;

  if (fleet === fleetNames[0]) {
    // Lowest fleet: need all qualifying races done
    if (racesDone < comp.num_races) return res.status(400).json({ error: `Alkusarja kesken (${racesDone}/${comp.num_races})` });
  } else {
    // Higher fleet: need previous fleet's results complete
    const prevFleet = fleetNames[fleetNames.indexOf(fleet) - 1];
    const prevResults = db.prepare('SELECT race_index FROM finals_results WHERE comp_id = ? AND fleet = ?').all(compId, prevFleet);
    const prevRacesDone = new Set(prevResults.map(r => r.race_index)).size;
    if (prevRacesDone < comp.num_boats) {
      return res.status(400).json({ error: `${prevFleet} fleet kesken` });
    }
  }

  // Determine fleet sailors
  const sailorKeys = db.prepare('SELECT sailor_key FROM comp_sailors WHERE comp_id = ? ORDER BY sailor_key').all(compId).map(s => s.sailor_key);
  const qualStandings = computeStandings(sailorKeys, allResults);
  const fleetSailors = getFleetSailors(comp, fleetNames, fleet, qualStandings, compId);

  if (fleetSailors.length !== comp.num_boats) {
    return res.status(400).json({ error: `Fleet size mismatch: got ${fleetSailors.length}, expected ${comp.num_boats}` });
  }

  // Generate Latin square
  const latinSquare = generateLatinSquare(fleetSailors, comp.num_boats);

  // Store
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM finals_schedule WHERE comp_id = ? AND fleet = ?').run(compId, fleet);
    db.prepare('DELETE FROM finals_results WHERE comp_id = ? AND fleet = ?').run(compId, fleet);
    const ins = db.prepare('INSERT INTO finals_schedule (comp_id, fleet, race_index, boat_key, sailor_key) VALUES (?,?,?,?,?)');
    latinSquare.forEach((race, ri) => {
      Object.entries(race).forEach(([boat, sailor]) => {
        ins.run(compId, fleet, ri, parseInt(boat), sailor);
      });
    });
  });
  tx();

  res.json({ schedule: latinSquare, sailors: fleetSailors });
});

function getFleetSailors(comp, fleetNames, fleet, qualStandings, compId) {
  const nb = comp.num_boats;
  const numFleets = fleetNames.length;
  const fleetIdx = fleetNames.indexOf(fleet);

  // Collect all sailors already assigned to lower fleets (including those who advanced)
  const usedSailors = new Set();
  for (let fi = 0; fi < fleetIdx; fi++) {
    const fSailors = db.prepare('SELECT DISTINCT sailor_key FROM finals_schedule WHERE comp_id = ? AND fleet = ?')
      .all(compId, fleetNames[fi]).map(r => r.sailor_key);
    fSailors.forEach(s => usedSailors.add(s));
  }

  // Get winner from previous fleet (advances to this fleet)
  let prevWinner = null;
  if (fleetIdx > 0) {
    const prevFleet = fleetNames[fleetIdx - 1];
    const prevResults = db.prepare('SELECT race_index, sailor_key, position FROM finals_results WHERE comp_id = ? AND fleet = ?').all(compId, prevFleet);
    const prevSched = db.prepare('SELECT DISTINCT sailor_key FROM finals_schedule WHERE comp_id = ? AND fleet = ?').all(compId, prevFleet).map(r => r.sailor_key);
    const prevStandings = computeStandings(prevSched, prevResults);
    prevWinner = prevStandings[0].key;
  }

  if (fleetIdx === 0) {
    // Lowest fleet: bottom N sailors from qualifying
    return qualStandings.slice(-nb).map(s => s.key);
  }

  // This fleet gets the next best qualifying sailors who haven't been used yet
  // (excluding the advancing winner from prev fleet — they're added separately)
  const qualSailorsAvailable = qualStandings
    .map(s => s.key)
    .filter(s => !usedSailors.has(s) && s !== prevWinner);

  // Take the best (nb-1) available from qualifying, plus the winner from prev fleet
  // qualSailorsAvailable is already sorted best-first
  const fromQual = qualSailorsAvailable.slice(0, nb - 1);
  return [...fromQual, prevWinner];
}

app.put('/api/competitions/:id/finals/results/:fleet/:raceIndex', (req, res) => {
  const compId = parseInt(req.params.id);
  const fleet = req.params.fleet;
  const ri = parseInt(req.params.raceIndex);
  const comp = db.prepare('SELECT num_boats FROM competitions WHERE id = ?').get(compId);
  if (!comp) return res.status(404).json({ error: 'Not found' });

  const positions = req.body;
  const entries = Object.entries(positions);
  if (entries.length !== comp.num_boats) return res.status(400).json({ error: `${comp.num_boats} sailors required` });
  const posVals = entries.map(e => e[1]).sort((a,b) => a-b);
  const expected = Array.from({length: comp.num_boats}, (_, i) => i + 1);
  if (JSON.stringify(posVals) !== JSON.stringify(expected)) {
    return res.status(400).json({ error: `Positions must be 1-${comp.num_boats}` });
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM finals_results WHERE comp_id = ? AND fleet = ? AND race_index = ?').run(compId, fleet, ri);
    const ins = db.prepare('INSERT INTO finals_results (comp_id, fleet, race_index, sailor_key, position) VALUES (?,?,?,?,?)');
    entries.forEach(([sailor, pos]) => ins.run(compId, fleet, ri, sailor, pos));
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/finals/results/:fleet/:raceIndex', (req, res) => {
  db.prepare('DELETE FROM finals_results WHERE comp_id = ? AND fleet = ? AND race_index = ?')
    .run(parseInt(req.params.id), req.params.fleet, parseInt(req.params.raceIndex));
  res.json({ ok: true });
});

app.get('/api/competitions/:id/finals/standings', (req, res) => {
  const compId = parseInt(req.params.id);
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(compId);
  if (!comp) return res.status(404).json({ error: 'Not found' });

  const fleetNames = getFleetNames(comp.num_sailors, comp.num_boats);
  const overall = [];

  // Process fleets top-down for final standings
  for (let fi = fleetNames.length - 1; fi >= 0; fi--) {
    const fleet = fleetNames[fi];
    const fSailors = db.prepare('SELECT DISTINCT sailor_key FROM finals_schedule WHERE comp_id = ? AND fleet = ?')
      .all(compId, fleet).map(r => r.sailor_key);
    if (fSailors.length === 0) continue;

    const fResults = db.prepare('SELECT race_index, sailor_key, position FROM finals_results WHERE comp_id = ? AND fleet = ?')
      .all(compId, fleet);
    const standings = computeStandings(fSailors, fResults);

    // The winner of non-top fleets has advanced — they're ranked in a higher fleet
    const isTopFleet = fi === fleetNames.length - 1;
    standings.forEach((s, idx) => {
      if (!isTopFleet && idx === 0) return; // Winner advanced
      overall.push({ key: s.key, fleet, pts: s.pts, races: s.races, posDist: s.posDist });
    });
  }

  res.json({ fleetNames, overall });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Purjehdus running on port ${PORT}`);
});
