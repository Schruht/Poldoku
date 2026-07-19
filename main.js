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

let puzzleString = new URLSearchParams(window.location.search).get("seed");
console.log(puzzleString)
if (puzzleString == null) {
  console.log("Klammer");
 puzzleString = "005316690937"
}

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
for (let row of rows) {
  for (let col of cols) {
    const colFilter = new Function('x', col.condition)
    const rowFilter = new Function('x', row.condition)
    cells.push({
      correct: gameData.filter(x => colFilter(x) && rowFilter(x)).map(x => x.name)
    })
  }
}

const PUZZLE = {
  colLabels: colLabes,
  rowLabels: rowLabels,
  cells: cells,
};

const filled = {};
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
    d.innerHTML = `<img class="lbl-icon" src="img/${cols[i].id}.png"><span class="lbl-text">${l.text}</span>`;
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
    rl.innerHTML = `<img class="lbl-icon" src="img/${rows[r].id}.png"><span class="lbl-text">${PUZZLE.rowLabels[r].text}</span>`;
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
        renderFilled(cell, filled[key]);
      } else {
        cell.innerHTML = '<span class="cell-hint">Antwort eingeben</span>';
        cell.addEventListener('click', () => openModal(r, c));
      }

      grid.appendChild(cell);
    }
  }
}

function renderFilled(cell, answer, isWrong = false) {
  const ringSpan = isWrong ? '<span class="check-ring wrong">✕</span>' : '<span class="check-ring">✓</span>';
  cell.classList.add('filled');
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
  document.getElementById(id).style.color = color;
  document.getElementById(id).style.borderColor = color;
  document.getElementById(id).style.backgroundColor = color ? color + '33' : '';
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

  if (Object.values(filled).includes(answer)) {
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
  filled[key] = answer;

  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) {
    cell.classList.remove('wrong');
  }
  renderFilled(cell, answer);

  const count = Object.keys(filled).length;
  document.getElementById('fill').style.width = `${(count / 9) * 100}%`;
  document.getElementById('prog-label').textContent = `${count} / 9`;

  if (count === 9) {
    setTimeout(() => document.getElementById('win').classList.add('show'), 380);
  }
}

function reject(r, c, answer) {
  const cell = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  if (cell) {
    cell.classList.add('wrong');
  }
  renderFilled(cell, answer, true);

  document.getElementById('wrong-answers-label').textContent = parseInt(document.getElementById('wrong-answers-label').textContent) + 1;
}

/* ── Events ── */
document.getElementById('backdrop').addEventListener('click', e => {
  if (e.target.id === 'backdrop') closeModal();
});
document.getElementById('x-btn').addEventListener('click', closeModal);

document.getElementById('again-btn').addEventListener('click', () => {
  for (const k in filled) delete filled[k];
  document.getElementById('win').classList.remove('show');
  document.getElementById('fill').style.width = '0%';
  document.getElementById('prog-label').textContent = '0 / 9';
  buildGrid();
});

/* ── Init ── */
buildGrid();
