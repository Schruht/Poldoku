#!/usr/bin/env node
/**
 * build-puzzle.js
 * ----------------
 * Builds a 3x3 Pokedoku-style puzzle grid.
 *
 * Given:
 *   - answers.json    : an array of possible answers, e.g. [{ id, name, birth: 1985, ... }, ...]
 *   - categories.json : an array of category definitions:
 *                        [{ id, name, condition }]
 *                        where `condition` is the BODY of a JS function taking `x`
 *                        (a single answer object) and returning true/false, e.g.
 *                        "return x.birth > 1970"
 *   - an "answer of the day" (by id or name)
 *
 * It does the following:
 *   1. Compiles every category's condition into a real function.
 *   2. Finds every category the answer-of-the-day (AOTD) satisfies.
 *      (You need at least 6 of these — 3 will become row categories,
 *      3 will become column categories.)
 *   3. Tries random combinations of 6 qualifying categories, split into
 *      3 rows / 3 cols, until it finds one where *every* one of the 9
 *      cells (row-condition AND col-condition) has at least one valid
 *      candidate answer. (Cells are allowed to have more than one valid
 *      answer — those are listed, not treated as an error.)
 *   4. Optionally prints several valid layouts (--listCombos=N) so you
 *      can eyeball which one "feels" best before committing to one.
 *   5. Prints the chosen puzzle to the console as a readable grid.
 *
 * Usage:
 *   node build-puzzle.js <answers.json> <categories.json> <answerOfDayIdOrName> [options]
 *
 * Options:
 *   --attempts=2000       Max random combos to try before giving up (default: 2000)
 *   --listCombos=1        How many valid combos to print before picking the final one (default: 1)
 *   --minPerCell=1        Minimum candidates required in every cell (default: 1)
 *   --maxPerCell=Infinity Optional cap; combos with any cell exceeding this are rejected
 *   --seed=12345          Seed for reproducible randomness (optional)
 *
 * Example:
 *   node build-puzzle.js answers.json categories.json "mewtwo" --listCombos=3
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      opts[key] = val === undefined ? true : val;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const [answersPath, categoriesPath, aotdKey] = positional;

if (!answersPath || !categoriesPath || !aotdKey) {
  console.error(
    'Usage: node build-puzzle.js <answers.json> <categories.json> <answerOfDayIdOrName> [options]'
  );
  process.exit(1);
}

const MAX_ATTEMPTS = opts.attempts ? parseInt(opts.attempts, 10) : 2000;
const LIST_COMBOS = opts.listCombos ? parseInt(opts.listCombos, 10) : 1;
const MIN_PER_CELL = opts.minPerCell ? parseInt(opts.minPerCell, 10) : 1;
const MAX_PER_CELL = opts.maxPerCell ? parseInt(opts.maxPerCell, 10) : Infinity;

// ---------- Seeded RNG (optional, for reproducibility) ----------

function makeRng(seed) {
  if (seed === undefined) return Math.random;
  let s = parseInt(seed, 10) || 1;
  return function () {
    // simple LCG
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
const rng = makeRng(opts.seed);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Load data ----------

function loadJson(p) {
  const full = path.resolve(p);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

const answers = loadJson(answersPath);
const categoriesRaw = loadJson(categoriesPath).filter((cat) => !cat.exclude);

// ---------- Compile category conditions ----------

const categories = categoriesRaw.map((cat) => {
  let fn;
  try {
    fn = new Function('x', cat.condition);
  } catch (err) {
    console.error(`Category "${cat.id}" (${cat.name}) has an invalid condition:`, err.message);
    process.exit(1);
  }
  return { ...cat, test: fn };
});

function safeTest(cat, x) {
  try {
    return !!cat.test(x);
  } catch (err) {
    console.warn(`Warning: category "${cat.id}" threw on answer "${x.id ?? x.name}": ${err.message}`);
    return false;
  }
}

// ---------- Find the answer of the day ----------

const aotd = answers.find(
  (a) => String(a.id) === String(aotdKey) || String(a.name).toLowerCase() === String(aotdKey).toLowerCase()
);

if (!aotd) {
  console.error(`Could not find an answer with id or name "${aotdKey}" in ${answersPath}`);
  process.exit(1);
}

console.log(`Answer of the day: ${aotd.name ?? aotd.id}`);

// ---------- Find categories the AOTD satisfies ----------

const qualifying = categories.filter((cat) => safeTest(cat, aotd));

console.log(
  `Found ${qualifying.length} categories satisfied by the answer of the day:`,
  qualifying.map((c) => c.name).join(', ')
);

if (qualifying.length < 6) {
  console.error(
    `Need at least 6 qualifying categories to build a 3x3 grid, but only found ${qualifying.length}.`
  );
  process.exit(1);
}

// ---------- Precompute, for every qualifying category, which answers satisfy it ----------

const matchCache = new Map(); // cat.id -> Set of answers (by reference) that satisfy it
for (const cat of qualifying) {
  const matched = answers.filter((a) => safeTest(cat, a));
  matchCache.set(cat.id, matched);
}

function candidatesFor(rowCat, colCat) {
  const rowSet = matchCache.get(rowCat.id);
  const colIds = new Set(matchCache.get(colCat.id).map((a) => a.id ?? a.name));
  return rowSet.filter((a) => colIds.has(a.id ?? a.name));
}

function canPickDistinctFromEach(lists) {
  const n = lists.length;
  // matchItem[item] = index of the list currently assigned to it
  const matchItem = new Map();

  function tryAssign(listIndex, visited) {
    for (const item of lists[listIndex]) {
      if (visited.has(item)) continue;
      visited.add(item);

      // item is free, or the list currently holding it can find another item
      if (!matchItem.has(item) || tryAssign(matchItem.get(item), visited)) {
        matchItem.set(item, listIndex);
        return true;
      }
    }
    return false;
  }

  for (let i = 0; i < n; i++) {
    const visited = new Set();
    if (!tryAssign(i, visited)) {
      return false; // list i can't get a distinct item -> no valid assignment
    }
  }
  return true;
}

// ---------- Try random combos of 6 categories -> 3 rows / 3 cols ----------

function evaluateCombo(rows, cols) {
  const grid = [];
  for (const r of rows) {
    const rowCells = [];
    for (const c of cols) {
      const cands = candidatesFor(r, c);
      rowCells.push(cands);
    }
    grid.push(rowCells);
  }
  const ok = grid.every((row) => row.every((cell) => cell.length >= MIN_PER_CELL && cell.length <= MAX_PER_CELL)) && canPickDistinctFromEach(grid.flat());
  const minCell = Math.min(...grid.flat().map((c) => c.length));
  const maxCell = Math.max(...grid.flat().map((c) => c.length));
  const totalCands = grid.flat().reduce((s, c) => s + c.length, 0);
  return { ok, grid, minCell, maxCell, totalCands };
}

const validCombos = [];
const seenSignatures = new Set();

for (let attempt = 0; attempt < MAX_ATTEMPTS && validCombos.length < LIST_COMBOS; attempt++) {
  const shuffled = shuffle(qualifying).slice(0, 6);
  const signature = shuffled.map((c) => c.id).sort().join('|');
  // avoid re-testing the exact same set of 6 categories repeatedly
  if (seenSignatures.has(signature)) continue;
  seenSignatures.add(signature);

  const rows = shuffled.slice(0, 3);
  const cols = shuffled.slice(3, 6);
  const result = evaluateCombo(rows, cols);
  if (result.ok) {
    validCombos.push({ rows, cols, ...result });
  }
}

if (validCombos.length === 0) {
  console.error(
    `Could not find a valid 3x3 combo (every cell needs >= ${MIN_PER_CELL} candidate(s)) after ${MAX_ATTEMPTS} attempts.\n` +
      `Try increasing --attempts, lowering --minPerCell, or adding more categories.`
  );
  process.exit(1);
}

// Sort candidate combos: prefer higher minCell (fewer near-impossible cells), then more total candidates
validCombos.sort((a, b) => b.minCell - a.minCell || b.totalCands - a.totalCands);

// ---------- Print the combos found (if listCombos > 1) ----------

function printGrid(rows, cols, grid) {
  console.log('\n     ' + cols.map((c) => c.name.padEnd(18)).join(''));
  rows.forEach((r, i) => {
    const line = grid[i]
      .map((cell) => {
        const names = cell.map((a) => a.name ?? a.id).join(', ');
        return (names.length > 16 ? names.slice(0, 15) + '…' : names).padEnd(18);
      })
      .join('');
    console.log(r.name.padEnd(20) + line);
  });
}

validCombos.forEach((combo, i) => {
  console.log(`\n=== Combo ${i + 1} (min cell = ${combo.minCell}, total candidates = ${combo.totalCands}) ===`);
  printGrid(combo.rows, combo.cols, combo.grid);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("Enter a number to choose a combination");

rl.on('line', (line) => {
  const idx = line.trim();

  // ---------- Pick the best combo and output it ----------

  const best = validCombos[idx];

  // Concatenated string of category ids, row ids first then col ids, in grid order
  // (e.g. row1,row2,row3,col1,col2,col3). Each id is zero-padded to 2 digits and
  // joined with no separator (e.g. ids 3, 12, 7 -> "030712"). Useful as a compact
  // puzzle identifier/seed.
  const categoryIdString = [...best.rows, ...best.cols]
    .map((c) => String(c.id).padStart(2, '0'))
    .join('');

  /*const outputObj = {
    rowIds = best.rows.map((c) => c.id),
    colIds = best.cols.map((c) => c.id),
    aotd = aotd
  }*/

  console.log(`\nCategory IDs: ${categoryIdString}`);
  console.log(`Rows: ${best.rows.map((c) => c.id).join(', ')}`);
  console.log(`Cols: ${best.cols.map((c) => c.id).join(', ')}`);
  console.log('\nFinal grid:');
  printGrid(best.rows, best.cols, best.grid);
  process.exit(0);
});

