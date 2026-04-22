// ─── Date utilities ──────────────────────────────────────────────────────────

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

const WEEKDAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a, b) {
  return Math.floor((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

function parseDate(str) {
  // Parse YYYY-MM-DD as local midnight
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// Advance d forward until it lands on targetDay (0=Sun…6=Sat). If already there, stay.
function advanceToWeekday(d, targetDay) {
  const r = new Date(d);
  while (r.getDay() !== targetDay) r.setDate(r.getDate() + 1);
  return r;
}

// Most recent past occurrence of targetDay (including today)
function prevWeekday(now, targetDay) {
  const r = startOfDay(now);
  while (r.getDay() !== targetDay) r.setDate(r.getDate() - 1);
  return r;
}

// ─── Scheduling engine ────────────────────────────────────────────────────────

function computeSchedule(task, now) {
  const s = task.schedule;

  if (s.type === 'monthly') return computeMonthly(s, now);
  if (s.type === 'daily')   return computeDaily(s, now, task);
  if (s.type === 'once')    return computeOnce(s, now);
  // weekly (interval 1 or >1)
  const interval = s.interval || 1;
  if (interval === 1) return computeWeeklySimple(s, now);
  return computeWeeklyAnchored(s, now, task);
}

function computeWeeklySimple(s, now) {
  const targetDay = WEEKDAY_MAP[s.weekday.toLowerCase()];
  const lastOccurrence = prevWeekday(now, targetDay);
  const daysSinceLast = daysBetween(lastOccurrence, now);

  if (daysSinceLast === 1) {
    // Grace period: show as overdue for the day after the due date.
    // cycleStart must stay as lastOccurrence (not shifted back) so completion keys stay valid.
    const nextDue = lastOccurrence;
    return { cycleStart: lastOccurrence, nextDue, pct: 100, inactive: false };
  }

  // Normal: new cycle
  const cycleStart = lastOccurrence;
  const nextDue = addDays(cycleStart, 7);
  return { cycleStart, nextDue, pct: progressPct(cycleStart, nextDue, now), inactive: false };
}

function computeWeeklyAnchored(s, now, task) {
  const anchor = parseDate(s.anchor_date);
  const targetDay = WEEKDAY_MAP[s.weekday.toLowerCase()];
  const interval = s.interval;

  const weeksSinceAnchor = Math.floor(daysBetween(anchor, now) / 7);
  const cycleIndex = Math.floor(weeksSinceAnchor / interval);

  // Start of the current interval window
  const windowStart = addDays(anchor, cycleIndex * interval * 7);
  // The due date is the target weekday within (or starting from) that window
  let nextDue = advanceToWeekday(windowStart, targetDay);

  // If the due date is more than 1 day in the past, roll to the next cycle (1-day grace)
  if (addDays(startOfDay(nextDue), 1) < startOfDay(now)) {
    const nextWindowStart = addDays(anchor, (cycleIndex + 1) * interval * 7);
    nextDue = advanceToWeekday(nextWindowStart, targetDay);
  }

  // Cycle start = the target weekday of the current window
  let cycleStart = advanceToWeekday(windowStart, targetDay);
  if (cycleStart > now) {
    // cycleStart is in the future — use window start's weekday from prev cycle
    const prevWindowStart = addDays(anchor, (cycleIndex - 1) * interval * 7);
    cycleStart = advanceToWeekday(prevWindowStart, targetDay);
  }

  // Alternating group logic
  let inactive = false;
  if (s.group !== undefined && s.phase !== undefined) {
    const currentPhase = cycleIndex % 2;
    if (s.phase !== currentPhase) {
      inactive = true;
      // Inactive tasks are due the cycle AFTER the active one
      nextDue = addDays(nextDue, interval * 7);
    }
  }

  const pct = progressPct(cycleStart, inactive ? addDays(cycleStart, interval * 7) : nextDue, now);
  return { cycleStart, nextDue, pct, inactive };
}

function computeMonthly(s, now) {
  const day = s.day;
  const y = now.getFullYear();
  const m = now.getMonth();

  let nextDue = new Date(y, m, day, 0, 0, 0, 0);
  let cycleStart;

  if (addDays(startOfDay(nextDue), 1) < startOfDay(now)) {
    // This month's date has passed by more than 1 day — next is next month (1-day grace)
    cycleStart = nextDue;
    nextDue = new Date(y, m + 1, day, 0, 0, 0, 0);
  } else {
    // Still coming up this month; cycle started on last month's day
    cycleStart = new Date(y, m - 1, day, 0, 0, 0, 0);
  }

  const pct = progressPct(cycleStart, nextDue, now);
  return { cycleStart, nextDue, pct, inactive: false };
}

function weatherAdjustedInterval(task, baseInterval) {
  if (!task.weather_sensitive || !currentWeather) return { interval: baseInterval, weatherNote: null };
  const todayMax = currentWeather.daily.temperature_2m_max[0];
  const todayRain = currentWeather.daily.precipitation_probability_max[0];
  if (todayMax >= 25 && todayRain < 30) return { interval: 1, weatherNote: '🌡️ Hot & dry — watering daily' };
  if (todayRain >= 60)                  return { interval: 3, weatherNote: '🌧️ Rain forecast — watering reduced' };
  return { interval: baseInterval, weatherNote: null };
}

function computeDaily(s, now, task) {
  const base = s.interval || 1;
  const { interval, weatherNote } = task ? weatherAdjustedInterval(task, base) : { interval: base, weatherNote: null };
  const anchor = s.anchor_date ? parseDate(s.anchor_date) : startOfDay(now);
  const daysSinceAnchor = Math.max(0, daysBetween(anchor, now));
  const cycleIndex = Math.floor(daysSinceAnchor / interval);
  const lastOccurrence = addDays(anchor, cycleIndex * interval);
  const daysSinceLast = daysBetween(lastOccurrence, now);

  if (daysSinceLast === 1 && interval > 1) {
    // cycleStart stays as lastOccurrence so completion keys stay valid across the grace day.
    return { cycleStart: lastOccurrence, nextDue: lastOccurrence, pct: 100, inactive: false, weatherNote };
  }

  const cycleStart = lastOccurrence;
  const nextDue = addDays(cycleStart, interval);
  return { cycleStart, nextDue, pct: progressPct(cycleStart, nextDue, now), inactive: false, weatherNote };
}

function computeOnce(s, now) {
  const nextDue = parseDate(s.date);
  const cycleStart = s.start_date ? parseDate(s.start_date) : addDays(nextDue, -30);
  const pastGrace = startOfDay(now) > addDays(startOfDay(nextDue), 1);
  return { cycleStart, nextDue, pct: progressPct(cycleStart, nextDue, now), inactive: pastGrace };
}

function progressPct(cycleStart, nextDue, now) {
  const total = nextDue - cycleStart;
  if (total <= 0) return 100;
  const elapsed = now - cycleStart;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function urgencyClass(pct, nextDue, now) {
  if ((nextDue - now) > 7 * DAY_MS) return 'neutral';
  if ((nextDue - now) < DAY_MS) return 'hot';
  if (pct >= 50) return 'warm';
  return 'cool';
}

function countdownText(nextDue, now) {
  const diffMs = nextDue - now;
  if (Math.abs(diffMs) < 60000) return 'Due now';
  if (startOfDay(nextDue).getTime() === startOfDay(now).getTime()) return 'Due today';

  const abs = Math.abs(diffMs);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);

  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && mins > 0) parts.push(`${mins}m`);
  const str = parts.join(' ') || 'less than a minute';

  return diffMs < 0 ? `Overdue by ${str}` : `Due in ${str}`;
}

// ─── Task completion state ────────────────────────────────────────────────────

const COMPLETIONS_KEY = 'taskCompletions';

function loadCompletions() {
  try { return JSON.parse(localStorage.getItem(COMPLETIONS_KEY)) || {}; }
  catch { return {}; }
}

function saveCompletions(data) {
  localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(data));
}

function getCompletion(task, cycleStart) {
  const data = loadCompletions();
  const entry = data[task.title];
  if (!entry) return null;
  // Auto-expire: only valid for the current cycle
  if (entry.cycleStartISO !== cycleStart.toISOString()) return null;
  return entry.action;
}

function setCompletion(task, cycleStart, action) {
  const data = loadCompletions();
  if (action === null) {
    delete data[task.title];
  } else {
    data[task.title] = { action, cycleStartISO: cycleStart.toISOString() };
  }
  saveCompletions(data);
}

function advanceByInterval(schedule, date) {
  if (schedule.type === 'monthly') {
    const d = new Date(date);
    d.setMonth(d.getMonth() + (schedule.interval || 1));
    return d;
  }
  if (schedule.type === 'daily') return addDays(date, schedule.interval || 1);
  if (schedule.type === 'once')  return date;
  return addDays(date, (schedule.interval || 1) * 7);
}

// ─── Firework animation ───────────────────────────────────────────────────────

function launchFirework(card) {
  const rect = card.getBoundingClientRect();
  const ox = rect.left + rect.width * 0.18; // near the icon
  const oy = rect.top  + rect.height * 0.4;

  const colors = ['#5b9ea0','#7ec8ca','#c8a96e','#e0c88a','#c85a5a','#e88080','#f0ece3','#66bb6a','#ffd54f','#a78bfa','#f472b6'];

  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(layer);

  // Three staggered bursts from slightly different origins
  const bursts = [
    { cx: ox,                      cy: oy,       count: 30, delay: 0,   distMin: 120, distMax: 380 },
    { cx: ox + (Math.random()-0.5)*120, cy: oy - 60, count: 22, delay: 150, distMin: 150, distMax: 420 },
    { cx: ox + (Math.random()-0.5)*160, cy: oy - 20, count: 18, delay: 300, distMin: 100, distMax: 350 },
  ];

  let total = bursts.reduce((s, b) => s + b.count, 0);
  let settled = 0;

  for (const burst of bursts) {
    for (let i = 0; i < burst.count; i++) {
      const p      = document.createElement('div');
      const angle  = (i / burst.count) * 360 + (Math.random() - 0.5) * 25;
      const dist   = burst.distMin + Math.random() * (burst.distMax - burst.distMin);
      const dx     = Math.cos(angle * Math.PI / 180) * dist;
      const dy     = Math.sin(angle * Math.PI / 180) * dist - 60; // strong upward bias
      const size   = 6 + Math.random() * 9;
      const isRect = Math.random() > 0.45;
      const color  = colors[Math.floor(Math.random() * colors.length)];
      const dur    = 900 + Math.random() * 600;

      p.style.cssText = `
        position:absolute;
        left:${burst.cx}px; top:${burst.cy}px;
        width:${isRect ? Math.round(size * 0.5) : size}px;
        height:${isRect ? Math.round(size * 1.8) : size}px;
        background:${color};
        border-radius:${isRect ? '2px' : '50%'};
        animation:particle-fly ${dur}ms ${burst.delay}ms ease-out forwards;
        opacity:0;
        --dx:${dx.toFixed(1)}px;
        --dy:${dy.toFixed(1)}px;
      `;

      layer.appendChild(p);
      p.addEventListener('animationend', () => {
        if (++settled === total) layer.remove();
      }, { once: true });
    }
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

let allTasks = [];
let currentWeather = null;

function renderCards(tasks, filters) {
  const container = document.getElementById('cards');
  const now = new Date();

  const computed = tasks.map(t => {
    const sched = computeSchedule(t, now);
    const completion = getCompletion(t, sched.cycleStart);
    // Done or Skip: advance nextDue to next interval and reset progress
    if ((completion === 'done' || completion === 'skip') && !sched.inactive) {
      sched.nextDue = advanceByInterval(t.schedule, sched.nextDue);
      sched.pct = 0;
    }
    return { task: t, ...sched, completion };
  });

  computed.sort((a, b) => a.nextDue - b.nextDue);

  const { room, assignee, urgency } = filters;

  container.innerHTML = '';
  let shown = 0;

  for (const { task: t, nextDue, cycleStart, pct, inactive, completion, weatherNote } of computed) {
    const urg = urgencyClass(pct, nextDue, now);

    if (room && t.room !== room) continue;
    if (assignee && t.assignee !== assignee) continue;
    if (urgency && urg !== urgency) continue;
    if (t.schedule.type === 'once' && (completion === 'done' || completion === 'skip')) continue;

    const overdue = startOfDay(nextDue) < startOfDay(now) && !inactive;

    const card = document.createElement('div');
    card.className = ['card', urg, inactive ? 'inactive' : '', overdue ? 'overdue' : '']
      .filter(Boolean).join(' ');

    const countdownStr = inactive || urg === 'neutral'
      ? `Due ${fmtDate(nextDue)}`
      : countdownText(nextDue, now);

    const actionsHtml = inactive ? '' : `
      <div class="card-actions">
        <button class="action-btn done-btn" title="Mark done">✓</button>
        <button class="action-btn skip-btn" title="Skip this cycle">↷</button>
      </div>`;

    card.innerHTML = `
      <div class="card-icon">${t.icon || '📋'}</div>
      <div class="card-body">
        <div class="card-title">${escHtml(t.title)}</div>
        <div class="card-meta">${escHtml(t.room || '')}${t.assignee ? ' · ' + escHtml(t.assignee) : ''}</div>
        ${t.description ? `<div class="card-desc">${escHtml(t.description)}</div>` : ''}
        ${weatherNote ? `<div class="card-weather-note">${escHtml(weatherNote)}</div>` : ''}
        <div class="card-countdown${overdue ? ' overdue-label' : ''}">${countdownStr}</div>
        <div class="progress-bar"><div class="fill" style="width:${(100 - pct).toFixed(1)}%"></div></div>
        ${actionsHtml}
      </div>
    `;

    if (!inactive) {
      card.querySelector('.done-btn').addEventListener('click', e => {
        e.stopPropagation();
        setCompletion(t, cycleStart, 'done');
        launchFirework(card);
        card.classList.add('flash-done');
        setTimeout(() => renderCards(allTasks, getFilters()), 700);
      });
      card.querySelector('.skip-btn').addEventListener('click', e => {
        e.stopPropagation();
        setCompletion(t, cycleStart, 'skip');
        card.classList.add('flash-skip');
        card.addEventListener('animationend', () => renderCards(allTasks, getFilters()), { once: true });
      });
    }

    container.appendChild(card);
    shown++;
  }

  if (shown === 0) {
    container.innerHTML = '<p class="empty">No tasks match the current filters.</p>';
  }
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function getFilters() {
  return {
    room: document.getElementById('filter-room').value,
    assignee: document.getElementById('filter-assignee').value,
    urgency: document.getElementById('filter-urgency').value,
  };
}

function populateDropdowns(tasks) {
  const rooms = [...new Set(tasks.map(t => t.room).filter(Boolean))].sort();
  const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort();

  const roomSel = document.getElementById('filter-room');
  const assigneeSel = document.getElementById('filter-assignee');

  rooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
    roomSel.appendChild(opt);
  });

  assignees.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a; opt.textContent = a;
    assigneeSel.appendChild(opt);
  });
}

// ─── Theme ───────────────────────────────────────────────────────────────────

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  // Theme
  const savedTheme = localStorage.getItem('theme') || 'minimalist';
  setTheme(savedTheme);

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // Header toggle (default hidden)
  const header = document.querySelector('header');
  const toggle = document.getElementById('header-toggle');

  function applyHeaderState(visible) {
    header.classList.toggle('hidden', !visible);
    toggle.textContent = visible ? '▲' : '▼';
    localStorage.setItem('headerVisible', visible);
  }

  const headerVisible = localStorage.getItem('headerVisible') === 'true';
  applyHeaderState(headerVisible);

  toggle.addEventListener('click', () => {
    applyHeaderState(header.classList.contains('hidden'));
  });

  // Load tasks
  let tasks;
  try {
    const res = await fetch('tasks.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tasks = await res.json();
  } catch (e) {
    document.getElementById('cards').innerHTML =
      `<p class="empty error">Failed to load tasks.json: ${escHtml(e.message)}</p>`;
    return;
  }

  allTasks = tasks;
  populateDropdowns(tasks);

  const refresh = () => renderCards(allTasks, getFilters());
  refresh();

  ['filter-room', 'filter-assignee', 'filter-urgency'].forEach(id => {
    document.getElementById(id).addEventListener('change', refresh);
  });

  setInterval(refresh, 60000);
}

init();

// ─── Weather ───────────────────────────────────────────────────────────────

const WEATHER_LAT = 51.889;
const WEATHER_LON = 0.900;

const WMO_CODES = {
  0:  ['☀️',  'Clear sky'],
  1:  ['🌤️', 'Mainly clear'],
  2:  ['⛅',  'Partly cloudy'],
  3:  ['☁️',  'Overcast'],
  45: ['🌫️', 'Fog'],
  48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'],
  53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'],
  63: ['🌧️', 'Rain'],
  65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'],
  73: ['🌨️', 'Snow'],
  75: ['❄️',  'Heavy snow'],
  77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Light showers'],
  81: ['🌧️', 'Showers'],
  82: ['🌧️', 'Heavy showers'],
  85: ['🌨️', 'Snow showers'],
  86: ['🌨️', 'Heavy snow showers'],
  95: ['⛈️',  'Thunderstorm'],
  96: ['⛈️',  'Thunderstorm + hail'],
  99: ['⛈️',  'Thunderstorm + hail'],
};

function wmoInfo(code) {
  return WMO_CODES[code] || ['🌡️', `Code ${code}`];
}

async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}`
    + `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m`
    + `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max`
    + `&timezone=Europe%2FLondon&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderWeather(data) {
  const bodyEl = document.getElementById('weather-body');
  const updatedEl = document.getElementById('weather-updated');
  updatedEl.textContent = `Updated ${fmtTime(new Date())}`;

  const c = data.current;
  const d = data.daily;

  const [curIcon, curDesc] = wmoInfo(c.weather_code);

  const forecastDays = d.time.map((isoDate, i) => {
    const date = new Date(isoDate + 'T00:00:00');
    const name = i === 0 ? 'Today'
               : i === 1 ? 'Tomorrow'
               : date.toLocaleDateString(undefined, { weekday: 'short' });
    const [icon] = wmoInfo(i === 0 ? c.weather_code : d.weather_code[i]);
    const hi = Math.round(d.temperature_2m_max[i]);
    const lo = Math.round(d.temperature_2m_min[i]);
    const rain = d.precipitation_probability_max[i];
    return { name, icon, hi, lo, rain };
  });

  bodyEl.className = 'weather-body';
  bodyEl.innerHTML = `
    <div class="weather-current">
      <div class="weather-icon">${curIcon}</div>
      <div>
        <div class="weather-temp">${Math.round(c.temperature_2m)}°C</div>
        <div class="weather-feels">Feels like ${Math.round(c.apparent_temperature)}°C</div>
        <div class="weather-desc">${escHtml(curDesc)}</div>
        <div class="weather-wind">💨 ${Math.round(c.wind_speed_10m)} km/h</div>
      </div>
    </div>
    <div class="weather-forecast">
      ${forecastDays.map(day => `
        <div class="weather-day">
          <div class="weather-day-name">${escHtml(day.name)}</div>
          <div class="weather-day-icon">${day.icon}</div>
          <div class="weather-day-range">${day.hi}° / ${day.lo}°</div>
          ${day.rain > 0 ? `<div class="weather-day-rain">💧 ${day.rain}%</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

async function refreshWeather() {
  const bodyEl = document.getElementById('weather-body');
  try {
    const data = await fetchWeather();
    currentWeather = data;
    renderWeather(data);
    if (allTasks.length) renderCards(allTasks, getFilters());
  } catch (e) {
    bodyEl.innerHTML = `<p class="weather-empty error">Error: ${escHtml(e.message)}</p>`;
    document.getElementById('weather-updated').textContent = `Failed ${fmtTime(new Date())}`;
  }
}

refreshWeather();
setInterval(refreshWeather, 15 * 60 * 1000);

// ─── Train departures ──────────────────────────────────────────────────────

const TRAIN_STATIONS = [
  { crs: 'hyh', boardId: 'train-hyh-board', updatedId: 'train-hyh-updated', walkMins: 15 },
  { crs: 'cet', boardId: 'train-cet-board', updatedId: 'train-cet-updated', walkMins: 20 },
];


function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function isoToHHMM(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function fetchDepartures(crs) {
  const res = await fetch(`/rtt/gb-nr/location?location=${crs.toUpperCase()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const TRAIN_WINDOW_MS = 45 * 60 * 1000;
const WALK_TIME_MS    = 20 * 60 * 1000;

function trainProgressPct(iso, now) {
  if (!iso) return 0;
  const msLeft = new Date(iso) - now;
  if (msLeft <= 0) return 100;
  if (msLeft >= TRAIN_WINDOW_MS) return 0;
  return ((TRAIN_WINDOW_MS - msLeft) / TRAIN_WINDOW_MS) * 100;
}

function trainUrgency(iso, now, walkMins) {
  if (!iso) return 'cool';
  const msLeft = new Date(iso) - now;
  const walkMs = walkMins * 60 * 1000;
  if (msLeft <= walkMs) return 'hot';
  if (msLeft <= walkMs + 10 * 60 * 1000) return 'warm';
  return 'cool';
}

function renderTrainBoard(data, boardEl, updatedEl, walkMins) {
  const services = data.services || [];
  const now = new Date();
  updatedEl.textContent = `Updated ${fmtTime(now)}`;

  if (services.length === 0) {
    boardEl.innerHTML = '<p class="train-empty">No departures</p>';
    return;
  }

  boardEl.innerHTML = services.map(s => {
    const dep = (s.temporalData || {}).departure || {};
    const cancelled = dep.isCancelled || s.temporalData?.displayAs === 'CANCELLED_CALL';
    const scheduledIso = dep.scheduleAdvertised;
    const realtimeIso = dep.realtimeForecast;
    const scheduled = isoToHHMM(scheduledIso);
    const realtime = isoToHHMM(realtimeIso);
    const dest = (s.destination && s.destination[0] && s.destination[0].location && s.destination[0].location.description) || 'Unknown';

    let statusText, statusClass;
    if (cancelled) {
      statusText = 'Cancelled';
      statusClass = 'cancelled';
    } else if (!realtimeIso || realtime === scheduled) {
      statusText = 'On time';
      statusClass = 'on-time';
    } else {
      statusText = realtime;
      statusClass = 'delayed';
    }

    const effectiveIso = (!cancelled && realtimeIso) ? realtimeIso : scheduledIso;
    const pct = cancelled ? 0 : trainProgressPct(effectiveIso, now);
    const urg = cancelled ? 'cool' : trainUrgency(effectiveIso, now, walkMins);

    const urgMsg = urg === 'hot'  ? `⚠️ You won't make this on foot`
                 : urg === 'warm' ? `🚶 Leave soon to make this train`
                 : '';

    return `
      <div class="train-entry ${urg}${cancelled ? ' train-cancelled' : ''}">
        <div class="train-row">
          <span class="train-time">${escHtml(scheduled)}</span>
          <span class="train-dest">${escHtml(dest)}</span>
          <span class="train-status ${statusClass}">${escHtml(statusText)}</span>
        </div>
        ${urgMsg ? `<div class="train-urg-msg">${urgMsg}</div>` : ''}
        <div class="train-progress-bar"><div class="train-fill" style="width:${(100 - pct).toFixed(1)}%"></div></div>
      </div>`;
  }).join('');
}

async function refreshTrains() {
  for (const { crs, boardId, updatedId, walkMins } of TRAIN_STATIONS) {
    const boardEl = document.getElementById(boardId);
    const updatedEl = document.getElementById(updatedId);
    try {
      const data = await fetchDepartures(crs);
      renderTrainBoard(data, boardEl, updatedEl, walkMins);
    } catch (e) {
      boardEl.innerHTML = `<p class="train-empty error">Error: ${escHtml(e.message)}</p>`;
      updatedEl.textContent = `Failed ${fmtTime(new Date())}`;
    }
  }
}

refreshTrains();
setInterval(refreshTrains, 60000);

// Reload the page every hour to pick up any code updates
setInterval(() => location.reload(), 60 * 60 * 1000);
