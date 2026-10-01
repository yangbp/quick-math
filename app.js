/* 速算反应训练 —— 应用逻辑 */

/* ===== 工具函数 ===== */

function $(sel) {
  return document.querySelector(sel);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* 毫秒 -> "12.3" 秒（一位小数） */
function fmtSec(ms) {
  return (ms / 1000).toFixed(1);
}

function fmtPct(ratio) {
  return Math.round(ratio * 100) + '%';
}

function fmtDate(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ===== 题目生成 =====
 * 加法/减法：两个 3~4 位数（100–9999），减法保证结果非负
 * 乘法：两位数 × 两位数（10–99）
 * 除法：被除数 ≤4 位、除数 ≤2 位，除数×商反推被除数，天然整除
 * 占比：加 35 / 减 35 / 乘 22 / 除 8（除法 <10%）
 */

const TYPE_LABELS = { add: '加法', sub: '减法', mul: '乘法', div: '除法' };
const TYPE_WEIGHTS = [['add', 35], ['sub', 35], ['mul', 22], ['div', 8]];
const WEIGHT_TOTAL = TYPE_WEIGHTS.reduce((s, w) => s + w[1], 0);

function pickType(prevType) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let r = Math.random() * WEIGHT_TOTAL;
    let chosen = 'add';
    for (const [type, weight] of TYPE_WEIGHTS) {
      r -= weight;
      if (r < 0) { chosen = type; break; }
    }
    if (!(chosen === 'div' && prevType === 'div')) return chosen;
  }
  return 'add';
}

function genAddition() {
  const a = randInt(100, 9999), b = randInt(100, 9999);
  return { type: 'add', a, b, op: '+', answer: a + b };
}

function genSubtraction() {
  let a = randInt(100, 9999), b = randInt(100, 9999);
  if (a < b) { const t = a; a = b; b = t; } /* 保证结果非负 */
  return { type: 'sub', a, b, op: '−', answer: a - b };
}

function genMultiplication() {
  const a = randInt(10, 99), b = randInt(10, 99);
  return { type: 'mul', a, b, op: '×', answer: a * b };
}

function genDivision() {
  const divisor = randInt(10, 99), quotient = randInt(10, 99);
  const dividend = divisor * quotient; /* 100~9801，恒为 4 位以内且整除 */
  return { type: 'div', a: dividend, b: divisor, op: '÷', answer: quotient };
}

const GENERATORS = { add: genAddition, sub: genSubtraction, mul: genMultiplication, div: genDivision };

function makeQuestion(prevType, prevQuestion) {
  const type = pickType(prevType);
  const q = GENERATORS[type]();
  if (prevQuestion && prevQuestion.type === q.type &&
      prevQuestion.a === q.a && prevQuestion.b === q.b) {
    return makeQuestion(prevType, null); /* 避免与上一题完全相同 */
  }
  q.text = `${q.a} ${q.op} ${q.b}`;
  return q;
}

/* ===== 计分 =====
 * 基础 100 分 + 速度加成（5 秒内答完，每快 1 秒 +10）+ 连击加成（3 题起，+10×连击数，封顶 5）
 */

function calcPoints(reactionMs, streakAfter) {
  const speedBonus = Math.max(0, Math.round(50 - reactionMs / 100));
  const streakBonus = streakAfter >= 3 ? 10 * Math.min(streakAfter, 5) : 0;
  return 100 + speedBonus + streakBonus;
}

/* ===== 本地存储 ===== */

const HISTORY_KEY = 'brainMath.history.v1';
const HISTORY_CAP = 200;

function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveHistoryList(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* 存储不可用时静默降级 */ }
}

/* ===== 全局状态 ===== */

const MODE_INFO = {
  timed: { label: '限时挑战', params: [60, 120, 180], paramLabel: v => v + ' 秒' },
  fixed: { label: '固定题数', params: [20, 50], paramLabel: v => v + ' 题' },
};

let settings = { mode: 'timed', param: 60 };
let session = null;
let tickerId = null;
let sessionSeq = 0;

/* ===== 屏幕切换 ===== */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}

/* ===== 首页 ===== */

function renderParamChips() {
  const wrap = $('#param-chips');
  wrap.innerHTML = '';
  MODE_INFO[settings.mode].params.forEach(v => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (v === settings.param ? ' selected' : '');
    btn.textContent = MODE_INFO[settings.mode].paramLabel(v);
    btn.addEventListener('click', () => {
      settings.param = v;
      renderParamChips();
      renderBestLine();
    });
    wrap.appendChild(btn);
  });
  $('#param-label').textContent = settings.mode === 'timed' ? '时长' : '题数';
}

function bestFor(mode, param) {
  const list = loadHistory().filter(s => s.mode === mode && s.param === param);
  if (!list.length) return null;
  return {
    score: Math.max(...list.map(s => s.score)),
    fastestAvg: Math.min(...list.map(s => s.avgReactionMs)),
    count: list.length,
  };
}

function renderBestLine() {
  const el = $('#best-line');
  const best = bestFor(settings.mode, settings.param);
  if (!best) {
    el.classList.remove('has-record');
    el.textContent = '该模式还没有记录，完成一轮训练后这里会显示最佳成绩';
    return;
  }
  el.classList.add('has-record');
  el.textContent = `该模式最佳：${best.score} 分 · 最快平均反应 ${fmtSec(best.fastestAvg)} 秒（共 ${best.count} 次）`;
}

/* ===== 训练流程 ===== */

function startSession() {
  const timed = settings.mode === 'timed';
  session = {
    token: ++sessionSeq,
    mode: settings.mode,
    param: settings.param,
    startPerf: performance.now(),
    deadline: timed ? performance.now() + settings.param * 1000 : null,
    index: 0,        /* 已出现的题数（含当前） */
    score: 0,
    streak: 0,
    maxStreak: 0,
    records: [],     /* { type, ms, correct } */
    wrong: [],       /* { text, given, answer } */
    current: null,
    shownAt: 0,
    locked: false,
    ended: false,
  };

  $('#score-value').textContent = '0';
  $('#streak-badge').hidden = true;
  $('#feedback').className = 'feedback';
  $('#feedback-text').textContent = '';
  $('#metric-value').classList.remove('urgent');
  $('#metric-label').textContent = timed ? '剩余秒数' : '已完成';
  $('#progress-track').hidden = timed;
  $('#progress-fill').style.width = '0%';

  stopTicker();
  showScreen('screen-quiz');
  if (timed) {
    $('#metric-value').textContent = settings.param.toFixed(1);
    startTicker();
  }
  nextQuestion();
}

function startTicker() {
  tickerId = setInterval(() => {
    if (!session || session.ended) return;
    const remain = session.deadline - performance.now();
    $('#metric-value').textContent = Math.max(0, remain / 1000).toFixed(1);
    $('#metric-value').classList.toggle('urgent', remain <= 10000);
    if (remain <= 0) endSession();
  }, 100);
}

function stopTicker() {
  if (tickerId) { clearInterval(tickerId); tickerId = null; }
}

function nextQuestion() {
  if (!session || session.ended) return;
  session.current = makeQuestion(session.current && session.current.type, session.current);
  session.index++;
  session.shownAt = performance.now();
  session.locked = false;

  $('#question-text').textContent = session.current.text + ' = ?';
  const card = $('#question-card');
  card.classList.remove('correct', 'wrong');
  void card.offsetWidth; /* 重置动画 */

  const input = $('#answer-input');
  input.value = '';
  input.disabled = false;
  input.focus();

  $('#feedback').className = 'feedback';
  $('#feedback-text').textContent = '';
  updateStreakBadge();

  if (session.mode === 'fixed') {
    $('#metric-value').textContent = `${session.records.length} / ${session.param}`;
    $('#progress-fill').style.width = (session.records.length / session.param * 100) + '%';
  }
}

function updateStreakBadge() {
  const badge = $('#streak-badge');
  if (session.streak >= 3) {
    badge.hidden = false;
    badge.textContent = `连击 ×${session.streak}`;
  } else {
    badge.hidden = true;
  }
}

function submitAnswer() {
  if (!session || session.ended || session.locked) return;
  const input = $('#answer-input');
  const given = input.value.trim();
  if (!given) { input.focus(); return; }

  /* 限时模式：提交时时间已到 */
  if (session.mode === 'timed' && performance.now() >= session.deadline) {
    endSession();
    return;
  }

  session.locked = true;
  const reaction = Math.round(performance.now() - session.shownAt);
  const q = session.current;
  const correct = Number(given) === q.answer;
  session.records.push({ type: q.type, ms: reaction, correct });
  if (correct) handleCorrect(reaction);
  else handleWrong(q, given);
}

function handleCorrect(reactionMs) {
  session.streak++;
  session.maxStreak = Math.max(session.maxStreak, session.streak);
  const points = calcPoints(reactionMs, session.streak);
  session.score += points;
  $('#score-value').textContent = session.score;

  const card = $('#question-card');
  card.classList.add('correct');
  const pf = $('#points-float');
  pf.textContent = '+' + points;
  pf.classList.remove('show');
  void pf.offsetWidth;
  pf.classList.add('show');

  updateStreakBadge();
  advanceAfter(280);
}

function handleWrong(q, given) {
  session.streak = 0;
  session.wrong.push({ text: q.text, given, answer: q.answer });

  $('#question-card').classList.add('wrong');
  $('#feedback').className = 'feedback wrong';
  $('#feedback-text').innerHTML = `✗ 正确答案 <b>${q.answer}</b>`;
  $('#answer-input').disabled = true;

  updateStreakBadge();
  advanceAfter(1000);
}

/* 统一调度"进入下一题 / 结束"，带会话令牌防止旧定时器干扰新会话 */
function advanceAfter(ms) {
  const token = session.token;
  setTimeout(() => {
    if (!session || session.token !== token || session.ended) return;
    if (session.mode === 'timed' && performance.now() >= session.deadline) { endSession(); return; }
    if (session.mode === 'fixed' && session.records.length >= session.param) { endSession(); return; }
    nextQuestion();
  }, ms);
}

function endSession() {
  if (!session || session.ended) return;
  session.ended = true;
  stopTicker();

  const summary = buildSummary();
  if (summary.answered > 0) {
    const list = loadHistory();
    list.unshift(summary);
    if (list.length > HISTORY_CAP) list.length = HISTORY_CAP;
    saveHistoryList(list);
    renderResult(summary);
    showScreen('screen-result');
  } else {
    renderBestLine();
    showScreen('screen-home');
  }
}

function buildSummary() {
  const recs = session.records;
  const correctRecs = recs.filter(r => r.correct);
  const totalMs = recs.reduce((s, r) => s + r.ms, 0);

  const perType = {};
  for (const r of recs) {
    const t = perType[r.type] || (perType[r.type] = { type: r.type, total: 0, correct: 0, ms: 0 });
    t.total++;
    t.ms += r.ms;
    if (r.correct) t.correct++;
  }

  return {
    date: new Date().toISOString(),
    mode: session.mode,
    param: session.param,
    score: session.score,
    answered: recs.length,
    correct: correctRecs.length,
    accuracy: recs.length ? correctRecs.length / recs.length : 0,
    avgReactionMs: recs.length ? Math.round(totalMs / recs.length) : 0,
    fastestMs: correctRecs.length ? Math.min(...correctRecs.map(r => r.ms)) : null,
    maxStreak: session.maxStreak,
    durationMs: Math.round(performance.now() - session.startPerf),
    perType: Object.values(perType),
    wrong: session.wrong,
    records: recs,
  };
}

/* ===== 结果页 ===== */

function renderResult(s) {
  const info = MODE_INFO[s.mode];
  let sub = `${info.label} · ${info.paramLabel(s.param)} · ${fmtDate(s.date)}`;
  if (s.mode === 'fixed') sub += ` · 用时 ${fmtSec(s.durationMs)} 秒`;
  $('#result-sub').textContent = sub;
  $('#r-score').textContent = s.score;

  const kpis = [
    { label: '正确率', value: s.answered ? fmtPct(s.accuracy) : '—' },
    { label: '平均反应', value: s.answered ? fmtSec(s.avgReactionMs) + ' 秒' : '—' },
    { label: '最快反应', value: s.fastestMs !== null ? fmtSec(s.fastestMs) + ' 秒' : '—' },
    { label: '最高连击', value: '×' + s.maxStreak },
  ];
  $('#r-kpis').innerHTML = kpis.map(k =>
    `<div class="stat-tile"><div class="stat-label">${k.label}</div><div class="stat-value">${k.value}</div></div>`
  ).join('');

  $('#r-type-table').innerHTML =
    `<thead><tr><th>题型</th><th class="num">答题</th><th class="num">答对</th><th class="num">正确率</th><th class="num">平均反应</th></tr></thead>
     <tbody>` +
    s.perType.map(t => `
      <tr>
        <td>${TYPE_LABELS[t.type]}</td>
        <td class="num">${t.total}</td>
        <td class="num">${t.correct}</td>
        <td class="num">${fmtPct(t.correct / t.total)}</td>
        <td class="num">${fmtSec(t.ms / t.total)} 秒</td>
      </tr>`).join('') +
    `</tbody>`;

  const wrongCard = $('#r-wrong-card');
  if (s.wrong.length) {
    wrongCard.hidden = false;
    $('#r-wrong-list').innerHTML = s.wrong.map(w => `
      <li>
        <span class="wrong-eq">${escapeHtml(w.text)}</span>
        <span class="wrong-ans">你答 ${escapeHtml(w.given)} · 正确 ${w.answer}</span>
      </li>`).join('');
  } else {
    wrongCard.hidden = true;
  }
}

/* ===== 历史页 ===== */

function renderHistory() {
  const list = loadHistory();
  const empty = $('#h-empty');
  const body = $('#h-body');

  if (!list.length) {
    empty.hidden = false;
    body.hidden = true;
    return;
  }
  empty.hidden = true;
  body.hidden = false;

  const totalAnswered = list.reduce((s, x) => s + x.answered, 0);
  const totalCorrect = list.reduce((s, x) => s + x.correct, 0);
  const kpis = [
    { label: '训练场次', value: String(list.length) },
    { label: '累计答题', value: String(totalAnswered) },
    { label: '总体正确率', value: totalAnswered ? fmtPct(totalCorrect / totalAnswered) : '—' },
  ];
  $('#h-kpis').innerHTML = kpis.map(k =>
    `<div class="stat-tile"><div class="stat-label">${k.label}</div><div class="stat-value">${k.value}</div></div>`
  ).join('');

  /* 分题型聚合，找出正确率最低的薄弱项（样本 ≥5 才标注） */
  const agg = {};
  for (const x of list) {
    for (const r of (x.records || [])) {
      const t = agg[r.type] || (agg[r.type] = { total: 0, correct: 0, ms: 0 });
      t.total++;
      t.ms += r.ms;
      if (r.correct) t.correct++;
    }
  }
  const present = Object.keys(agg);
  let weakest = null;
  for (const type of present) {
    if (agg[type].total < 5) continue;
    const acc = agg[type].correct / agg[type].total;
    if (!weakest || acc < weakest.acc) weakest = { type, acc };
  }
  $('#h-type-table').innerHTML =
    `<thead><tr><th>题型</th><th class="num">答题数</th><th class="num">正确率</th><th class="num">平均反应</th></tr></thead>
     <tbody>` +
    ['add', 'sub', 'mul', 'div'].filter(t => agg[t]).map(t => {
      const a = agg[t];
      const weakTag = weakest && weakest.type === t ? '<span class="tag-weak">待加强</span>' : '';
      return `
      <tr>
        <td>${TYPE_LABELS[t]}${weakTag}</td>
        <td class="num">${a.total}</td>
        <td class="num">${fmtPct(a.correct / a.total)}</td>
        <td class="num">${fmtSec(a.ms / a.total)} 秒</td>
      </tr>`;
    }).join('') +
    `</tbody>`;

  $('#h-session-table').innerHTML =
    `<thead><tr><th>日期</th><th>模式</th><th class="num">得分</th><th class="num">正确率</th><th class="num">平均反应</th></tr></thead>
     <tbody>` +
    list.slice(0, 50).map(x => `
      <tr>
        <td class="nowrap">${fmtDate(x.date)}</td>
        <td>${MODE_INFO[x.mode].label} ${x.param}${x.mode === 'timed' ? '秒' : '题'}</td>
        <td class="num">${x.score}</td>
        <td class="num">${fmtPct(x.accuracy)}</td>
        <td class="num">${fmtSec(x.avgReactionMs)} 秒</td>
      </tr>`).join('') +
    `</tbody>`;
}

/* ===== 初始化 ===== */

function init() {
  document.querySelectorAll('#mode-chips .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.mode = btn.dataset.mode;
      settings.param = MODE_INFO[settings.mode].params[0];
      document.querySelectorAll('#mode-chips .chip').forEach(b => b.classList.toggle('selected', b === btn));
      renderParamChips();
      renderBestLine();
    });
  });
  renderParamChips();
  renderBestLine();

  $('#btn-start').addEventListener('click', startSession);
  $('#btn-again').addEventListener('click', startSession);

  $('#btn-history').addEventListener('click', () => { renderHistory(); showScreen('screen-history'); });
  $('#btn-home').addEventListener('click', () => { renderBestLine(); showScreen('screen-home'); });
  $('#btn-home2').addEventListener('click', () => { renderBestLine(); showScreen('screen-home'); });

  $('#btn-clear').addEventListener('click', () => {
    if (!loadHistory().length) return;
    if (confirm('确定清空全部历史记录吗？此操作不可恢复。')) {
      try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
      renderHistory();
    }
  });

  $('#btn-quit').addEventListener('click', () => {
    if (!session || session.ended) { renderBestLine(); showScreen('screen-home'); return; }
    const answered = session.records.length;
    const ok = confirm(answered ? '确定结束本次训练吗？将保存并查看当前成绩。' : '确定退出本次训练吗？');
    if (!ok) return;
    if (answered) endSession();
    else {
      session.ended = true;
      stopTicker();
      renderBestLine();
      showScreen('screen-home');
    }
  });

  $('#answer-form').addEventListener('submit', e => {
    e.preventDefault();
    submitAnswer();
  });

  $('#answer-input').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
  });
}

document.addEventListener('DOMContentLoaded', init);
