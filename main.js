async function getData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    const result = await response.json();
    return result
  } catch (error) {
    console.error(error.message);
  }
}

let gameData = await getData("./data.json")
let categories = await getData("./conditions.json")

const allOptions = gameData.map(x => x.name).sort((a, b) => a.localeCompare(b))

const rotationResponse = await fetch("./rotation.txt")
const rotationText = await rotationResponse.text()
const rotationPuzzles = rotationText.trim().split(";")

const startDate = new Date("2026-08-11")
const today = new Date()
const daysSinceStart = Math.floor((today - startDate) / (1000 * 60 * 60 * 24))

const dailyPuzzle = rotationPuzzles[daysSinceStart] || "005316690937"
const dailyPuzzleKey = `poldoku-daily-${daysSinceStart}`
const dailyPuzzleStatus = localStorage.getItem(dailyPuzzleKey)
const isTodayCleared = dailyPuzzleStatus === 'true'

let puzzleString = dailyPuzzle
if (window.location.hash) {
  const hashContent = window.location.hash.slice(1)
  if (hashContent.startsWith('d')) {
    const index = parseInt(hashContent.slice(1))
    if (!isNaN(index)) {
      puzzleString = rotationPuzzles[index] || puzzleString
    }
  } else if (hashContent.startsWith('s')) {
    puzzleString = hashContent.slice(1)
  } else {
    puzzleString = hashContent
  }
}

const puzzleStorageKey = `poldoku-puzzle-${puzzleString}`
const savedFilled = localStorage.getItem(puzzleStorageKey)

const conditions = puzzleString.split(/(..)/g).filter(s => s).map(s => categories.find(x => x.id == s))

const cols = conditions.slice(0, 3)
const colLabes = cols.map(x => ({
  'icon': '', 'text': x.name
}))

const rows = conditions.slice(3, 6)
const rowLabels = rows.map(x => ({
  'icon': '', 'text': x.name
}))

let cells = []
let aotds = gameData
for (let row of rows) {
  for (let col of cols) {
    const colFilter = new Function('x', col.condition)
    const rowFilter = new Function('x', row.condition)
    cells.push({
      correct: gameData.filter(x => colFilter(x) && rowFilter(x)).map(x => x.name)
    })
    aotds = aotds.filter(x => colFilter(x) && rowFilter(x))
  }
}

const minAnswerCount = Math.min(...cells.map(x => x.correct.length))
const difficulty = Math.min(Math.ceil(5/minAnswerCount), 5)

document.querySelector("#difficulty-rating > span").innerHTML = "★".repeat(difficulty)

const PUZZLE = {
  colLabels: colLabes,
  rowLabels: rowLabels,
  cells: cells,
  aotds: aotds.map(x => x.name)
};

const filled = savedFilled ? JSON.parse(savedFilled) : {};
let activeCell = null;
let labelTooltipTimer = null;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Build grid ── */
function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  // Corner
  grid.appendChild(document.createElement('div'));

  // Column labels
  PUZZLE.colLabels.forEach((l, i) => {
    const d = document.createElement('div');
    d.className = 'col-label';
    d.dataset.type = 'col';
    d.dataset.index = i;
    if (cols[i].img) d.innerHTML = `<img class="lbl-icon" src="img/${cols[i].img}.png" onerror="this.onerror=null; this.remove();">`;
    d.innerHTML += `<span class="lbl-text">${l.text}</span>`
    d.addEventListener('mouseenter', showLabelTooltip);
    d.addEventListener('mouseleave', hideLabelTooltip);
    d.addEventListener('mousemove', moveLabelTooltip);
    grid.appendChild(d);
  });

  // Rows
  for (let r = 0; r < 3; r++) {
    // Row label
    const rl = document.createElement('div');
    rl.className = 'row-label';
    rl.dataset.type = 'row';
    rl.dataset.index = r;
    if (rows[r].img) rl.innerHTML = `<img class="lbl-icon" src="img/${rows[r].img}.png" onerror="this.onerror=null; this.remove();">`;
    rl.innerHTML += `<span class="lbl-text">${PUZZLE.rowLabels[r].text}</span>`
    rl.addEventListener('mouseenter', showLabelTooltip);
    rl.addEventListener('mouseleave', hideLabelTooltip);
    rl.addEventListener('mousemove', moveLabelTooltip);
    grid.appendChild(rl);

    // Cells
    for (let c = 0; c < 3; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      const key = `${r},${c}`;
      if (filled[key]) {
        const state = filled[key].state || 'correct';
        renderFilled(cell, filled[key].answer, state);
        if (state === 'wrong') {
          cell.classList.add('wrong');
        }
      } else {
        cell.innerHTML = '<span class="cell-hint">Antwort eingeben</span>';
        cell.addEventListener('click', () => openModal(r, c));
      }

      grid.appendChild(cell);
    }
  }
}

function renderFilled(cell, answer, answerState) {
  const isWrong = answerState == 'wrong'
  const ringSpan = isWrong ? '<span class="check-ring wrong">✕</span>' : '<span class="check-ring">✓</span>';
  cell.classList.add('filled');
  if (PUZZLE.aotds.includes(answer)) {
    cell.classList.add('gold');
  }
  cell.innerHTML = `
    <div class="cell-answer">
      ${ringSpan}
      <span>${answer}</span>
    </div>`;
}

function showLabelTooltip(event) {
  const type = event.currentTarget.dataset.type;
  const index = Number(event.currentTarget.dataset.index);
  const source = type === 'col' ? cols : rows;
  const text = source[index]?.more;
  const tooltip = document.getElementById('label-tooltip');

  if (!text) {
    tooltip.classList.remove('visible');
    return;
  }

  tooltip.textContent = text;
  tooltip.classList.add('visible');
  moveLabelTooltip(event);
}

function moveLabelTooltip(event) {
  const tooltip = document.getElementById('label-tooltip');
  if (!tooltip) return;

  // Measure tooltip size
  const tw = tooltip.offsetWidth || tooltip.getBoundingClientRect().width || 0;
  const th = tooltip.offsetHeight || tooltip.getBoundingClientRect().height || 0;

  // Align tooltip's bottom-right corner with the cursor
  let left = event.clientX - tw;
  let top = event.clientY - th;

  // Clamp within viewport with padding
  const pad = 8;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  left = Math.max(pad, Math.min(left, vw - tw - pad));
  top = Math.max(pad, Math.min(top, vh - th - pad));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideLabelTooltip() {
  clearTimeout(labelTooltipTimer);
  const tooltip = document.getElementById('label-tooltip');
  tooltip.classList.remove('visible');
}

function setRowColumnLabelStyle(id, color) {
  const defaultColor = '#5c8494';
  const element = document.getElementById(id);

  color = color || defaultColor;

  const hexToRgb = (hex) => {
    hex = hex.replace('#', '');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  };

  const rgbToHex = (r, g, b) => {
    return '#' + [r, g, b]
      .map(v => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
  };

  const hexToLightness = (hex) => {
    hex = hex.replace('#', '');

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    return (max + min) / 2;
  };

  const lightenHex = (hex, amount) => {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(
      Math.min(255, r + 255 * amount),
      Math.min(255, g + 255 * amount),
      Math.min(255, b + 255 * amount)
    );
  };

  const darkenHex = (hex, amount) => {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(
      r * (1 - amount),
      g * (1 - amount),
      b * (1 - amount)
    );
  };

  element.style.color = color;
  element.style.borderColor = color;

  const lightness = hexToLightness(color);

  // Dark colors get a lighter background, light colors get a darker background
  element.style.backgroundColor = lightness < 0.3
    ? lightenHex(color, 0.6) + '55'
    : darkenHex(color, 0.1) + '55';
}

/* ── Modal ── */
function openModal(r, c) {
  if (filled[`${r},${c}`]) return;
  activeCell = { r, c };

  const data = PUZZLE.cells[r * 3 + c];
  document.getElementById('tag-row').textContent =
    PUZZLE.rowLabels[r].icon + ' ' + PUZZLE.rowLabels[r].text;
  if (rows[r].color) {
    setRowColumnLabelStyle('tag-row', rows[r].color);
  } else {
    setRowColumnLabelStyle('tag-row', '');
  }
  document.getElementById('tag-col').textContent =
    PUZZLE.colLabels[c].icon + ' ' + PUZZLE.colLabels[c].text;
  if (cols[c].color) {
    setRowColumnLabelStyle('tag-col', cols[c].color);
  } else {
    setRowColumnLabelStyle('tag-col', '');
  }

  const inputBox = document.querySelector('.opts-text-box');
  inputBox.textContent = '';
  inputBox.focus();

  const opts = document.getElementById('opts');
  opts.innerHTML = '';

  // Handle input and show filtered matches
  const handleInput = (e) => {
    const input = inputBox.textContent.trim().toLowerCase();
    filterAndDisplayOptions(allOptions, input, opts, r, c);
  };

  // Handle Enter key submission
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const answer = inputBox.textContent.trim();
      if (answer) {
        pick(answer, r, c);
        inputBox.removeEventListener('keypress', handleKeyPress);
        inputBox.removeEventListener('input', handleInput);
      }
    }
  };

  inputBox.addEventListener('input', handleInput);
  inputBox.addEventListener('keypress', handleKeyPress);

  document.getElementById('backdrop').classList.add('open');
}

function filterAndDisplayOptions(correctAnswers, input, optsContainer, r, c) {
  optsContainer.innerHTML = '';

  if (!input) return;

  // Filter answers that contain the input text
  const filtered = correctAnswers.filter(answer =>
    answer.toLowerCase().includes(input)
  );

  // Display filtered options as buttons
  filtered.forEach(option => {
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.innerHTML = `<span class="dot"></span>${option}`;
    btn.addEventListener('click', () => {
      const inputBox = document.querySelector('.opts-text-box');
      pick(option, r, c);
      inputBox.removeEventListener('input', () => {});
    });
    optsContainer.appendChild(btn);
  });
}

function closeModal() {
  document.getElementById('backdrop').classList.remove('open');
  activeCell = null;
}

function pick(answer, r, c) {
  const correct = PUZZLE.cells[r * 3 + c].correct;

  if (Object.values(filled).some(f => f.answer === answer)) {
    // Already filled - show error feedback
    const inputBox = document.querySelector('.opts-text-box');
    inputBox.classList.add('wrong');
    inputBox.setAttribute('placeholder', 'Bereits verwendet!');
    setTimeout(() => {
      inputBox.classList.remove('wrong')
      inputBox.setAttribute('placeholder', 'Antwort eingeben...');
    }, 660);
    // Clear the input for retry
    inputBox.textContent = '';
    inputBox.focus();
    return;
  }

  if (correct.includes(answer)) {
    // Correct answer - close and accept
    setTimeout(() => {
      closeModal();
      accept(r, c, answer);
    }, 360);
  } else {
    // Wrong answer - show error feedback
    const inputBox = document.querySelector('.opts-text-box');
    inputBox.classList.add('wrong');
    setTimeout(() => {
      inputBox.classList.remove('wrong')
        closeModal();
        reject(r, c, answer);
    }, 520);
  }
}

/* ── Accept correct answer ── */
function accept(r, c, answer) {
  const key = `${r},${c}`;
  filled[key] = { answer, state: 'correct' };

  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) {
    cell.classList.remove('wrong');
  }
  renderFilled(cell, answer, 'correct');

  const count = Object.values(filled).filter(f => f.state === 'correct').length;
  document.getElementById('fill').style.width = `${(count / 9) * 100}%`;
  document.getElementById('prog-label').textContent = `${count} / 9`;

  localStorage.setItem(puzzleStorageKey, JSON.stringify(filled))

  if (count === 9) {
    if (puzzleString === dailyPuzzle) {
      localStorage.setItem(dailyPuzzleKey, 'true')
    }
    setTimeout(() => document.getElementById('win').classList.add('show'), 380);
  }
}

function reject(r, c, answer) {
  const key = `${r},${c}`;
  filled[key] = { answer, state: 'wrong' };

  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) {
    cell.classList.add('wrong');
  }
  renderFilled(cell, answer, 'wrong');

  document.getElementById('wrong-answers-label').textContent = parseInt(document.getElementById('wrong-answers-label').textContent) + 1;

  localStorage.setItem(puzzleStorageKey, JSON.stringify(filled))
}

/* ── Events ── */
document.getElementById('backdrop').addEventListener('click', e => {
  if (e.target.id === 'backdrop') closeModal();
});
document.getElementById('x-btn').addEventListener('click', closeModal);

document.getElementById('again-btn').addEventListener('click', () => {
  for (const k in filled) delete filled[k];
  localStorage.removeItem(puzzleStorageKey)
  document.getElementById('win').classList.remove('show');
  document.getElementById('fill').style.width = '0%';
  document.getElementById('prog-label').textContent = '0 / 9';
  buildGrid();
});

window.addEventListener('hashchange', () => {
  window.location.reload()
})

/* ── Init ── */
buildGrid();

const count = Object.values(filled).filter(f => f.state === 'correct').length;
const wrongCount = Object.values(filled).filter(f => f.state === 'wrong').length

if (count > 0) {
  document.getElementById('fill').style.width = `${(count / 9) * 100}%`;
  document.getElementById('prog-label').textContent = `${count} / 9`;
}

document.getElementById('wrong-answers-label').textContent = wrongCount;