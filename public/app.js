'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════

let socket       = null;
let token        = localStorage.getItem('token')    || '';
let username     = localStorage.getItem('username') || '';
let isAdmin      = JSON.parse(localStorage.getItem('isAdmin') || 'false');
let faction      = localStorage.getItem('faction') || 'colorless';
let soundOn      = JSON.parse(localStorage.getItem('soundOn') || 'false');

let currentRoom   = 'main';
let currentBoard  = 'main';
let currentPostId = null;
let currentTab    = 'chat';
let replyToMsg    = null;    // { id, user, text }
let currentDMThread = null;
let currentMapLoc = null;
let config        = null;    // from /api/config: factions, locations, emojis, aiActive

let unreadRooms  = new Set();
let unreadCount  = 0;
let notifUnread  = 0;
let dmUnread     = 0;

let typingUsers   = {};
let isTyping      = false;
let typingTimeout = null;

let broadcastTimer = null;
let searchDebounce = null;
let tickerTimer    = null;
let tickerHeadlines = [];

const ROOMS = {
  main:       { label: 'Main Chat',       desc: 'General discussion' },
  ikebukuro:  { label: 'Ikebukuro Local', desc: 'Local area chat' },
  missions:   { label: 'Missions',        desc: 'Help requests' },
  nightshift: { label: 'Night Shift',     desc: 'Late night crew' },
};

const BOARDS = {
  main:     '> MAIN BOARD',
  news:     '> NEWS BOARD',
  missions: '> MISSIONS BOARD',
  offtopic: '> OFFTOPIC BOARD',
};

const EMOJIS = ['👍', '❤️', '🔥', '👀', '✅', '🤔', '💀'];

const SLASH_CMDS = [
  { cmd: '/me',       desc: 'act in third person' },
  { cmd: '/shrug',    desc: 'append ¯\\_(ツ)_/¯' },
  { cmd: '/flip',     desc: 'flip a coin' },
  { cmd: '/roll',     desc: 'roll d100 (or /roll 20)' },
  { cmd: '/8ball',    desc: 'ask the 8-ball' },
  { cmd: '/weather',  desc: 'ikebukuro weather report' },
  { cmd: '/time',     desc: 'show JST time' },
  { cmd: '/ascii',    desc: 'ascii banner text' },
  { cmd: '/w',        desc: 'whisper: /w user text' },
  { cmd: '/quote',    desc: 'quote a message by id' },
  { cmd: '/who',      desc: 'who is online' },
  { cmd: '/np',       desc: 'now playing: /np song' },
  { cmd: '/help',     desc: 'show commands' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function $(id) { return document.getElementById(id); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function apiH() {
  return { 'Content-Type': 'application/json', 'x-auth-token': token };
}

function timeAgo(ts) {
  const sec = Math.floor(Date.now() / 1000) - (typeof ts === 'number' ? ts : Math.floor(new Date(ts).getTime() / 1000));
  if (sec < 0)    return 'now';
  if (sec < 60)   return sec + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
  if (sec < 86400) return Math.floor(sec / 3600) + ' hr ago';
  return Math.floor(sec / 86400) + 'd ago';
}

function fmtDate(ts) {
  const d = new Date((typeof ts === 'number' ? ts : Math.floor(new Date(ts).getTime() / 1000)) * 1000);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function jstTime() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600000);
  let h = jst.getUTCHours(), m = String(jst.getUTCMinutes()).padStart(2,'0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = String(h % 12 || 12).padStart(2,'0');
  return `${h}:${m} ${ap} JST`;
}

function jstFmt(ts) {
  const d   = new Date((typeof ts === 'number' ? ts : Math.floor(new Date(ts).getTime()/1000)) * 1000);
  const jst = new Date(d.getTime() + 9*3600000);
  let h = jst.getUTCHours(), m = String(jst.getUTCMinutes()).padStart(2,'0');
  h = String(h % 12 || 12).padStart(2,'0');
  return `${h}:${m}`;
}

function scrollToBottom(el) {
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
}

function factionColor(fac) {
  const f = (config?.factions || {})[fac];
  return f ? f.color : '#a0a0a0';
}

function factionShort(fac) {
  const f = (config?.factions || {})[fac];
  return f ? f.short : '---';
}

function userColorFor(user) {
  return factionColor(profileCache[user]?.faction || 'colorless');
}

// Lightweight markdown: **bold** *italic* `code` > quote (per line), > mentions, urls
function renderText(raw) {
  const safe = esc(raw);
  // Bold + italic + code (operate on escaped text; order matters)
  let out = safe
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

  // Leading > becomes blockquote (per line)
  out = out.split('\n').map(line => {
    if (line.startsWith('&gt; ') || line.startsWith('&gt;'))
      return `<span class="md-quote">${line.replace(/^&gt;\s?/, '')}</span>`;
    return line;
  }).join('\n');

  // @mentions
  out = out.replace(/(^|\W)@([A-Za-z0-9_]{2,24})/g, (m, pre, name) =>
    `${pre}<a class="mention" data-user="${name}">@${name}</a>`);

  // Bare URLs
  out = out.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  return out;
}

function initials(u) {
  const s = String(u || '?').replace(/[^A-Za-z0-9]/g, '');
  if (!s) return '?';
  if (s.length === 1) return s.toUpperCase();
  return (s[0] + s[s.length - 1]).toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOUND EFFECTS (Web Audio, synthesized)
// ═══════════════════════════════════════════════════════════════════════════

let audioCtx = null;
function audio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  return audioCtx;
}

function beep(freq = 880, dur = 0.08, type = 'square', vol = 0.04) {
  if (!soundOn) return;
  const a = audio(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch {}
}

function chord(freqs, dur = 0.18, type = 'sine', vol = 0.03) {
  if (!soundOn) return;
  freqs.forEach(f => beep(f, dur, type, vol));
}

function sfxMsg()       { beep(960, 0.04, 'square', 0.025); }
function sfxDm()        { chord([660, 990], 0.12, 'sine', 0.035); }
function sfxIncident()  { if (!soundOn) return; beep(440,0.15,'sawtooth',0.06); setTimeout(()=>beep(220,0.25,'sawtooth',0.06),150); }
function sfxBroadcast() { chord([440, 880, 1320], 0.3, 'triangle', 0.04); }
function sfxClick()     { beep(1800, 0.01, 'square', 0.01); }
function sfxNotify()    { chord([600, 900], 0.08, 'sine', 0.03); }

// ═══════════════════════════════════════════════════════════════════════════
//  PROFILE CACHE
// ═══════════════════════════════════════════════════════════════════════════

const profileCache = {}; // username -> profile

async function fetchProfile(user) {
  if (profileCache[user]) return profileCache[user];
  try {
    const r = await fetch('/api/profile/' + encodeURIComponent(user), { headers: apiH() });
    if (!r.ok) return null;
    const p = await r.json();
    profileCache[user] = p;
    return p;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLOCK + STATUS BAR
// ═══════════════════════════════════════════════════════════════════════════

function tickClock() {
  const t = jstTime();
  $('stat-time').textContent = t;
  const at = $('about-time'); if (at) at.textContent = t.replace(/\s[AP]M/, '') + ' JST';
}
setInterval(tickClock, 1000);
tickClock();

let totalMsgs = 0;
function updateStatusBar(connected) {
  const conn = $('sb-conn');
  if (conn) {
    conn.textContent = connected ? '■ CONN' : '□ DISC';
    conn.classList.toggle('disconnected', !connected);
  }
}
function tickStatusBar() {
  const lat = $('sb-lat');
  if (lat) lat.textContent = String(20 + Math.floor(Math.random() * 35));
}
setInterval(tickStatusBar, 4000);
tickStatusBar();

// ═══════════════════════════════════════════════════════════════════════════
//  UNREAD / BADGES
// ═══════════════════════════════════════════════════════════════════════════

function markUnread(room) {
  unreadRooms.add(room);
  const btn = document.querySelector(`.room-item[data-room="${room}"]`);
  if (btn) btn.querySelector('.room-dot')?.classList.add('unread');
  updateTitleBadge();
}

function clearUnread(room) {
  unreadRooms.delete(room);
  const btn = document.querySelector(`.room-item[data-room="${room}"]`);
  if (btn) {
    const dot = btn.querySelector('.room-dot');
    if (dot) { dot.classList.remove('unread'); dot.classList.add('active'); }
  }
  updateTitleBadge();
}

function updateTitleBadge() {
  unreadCount = unreadRooms.size + notifUnread + dmUnread;
  document.title = unreadCount > 0 ? `(${unreadCount}) Dollars BBS` : 'Dollars BBS';
}

function setNotifBadge(n) {
  notifUnread = n;
  const el = $('notif-badge');
  if (!el) return;
  el.classList.toggle('hidden', n === 0);
  el.textContent = n > 99 ? '99+' : n;
  updateTitleBadge();
}

function setDMBadge(n) {
  dmUnread = n;
  const el = $('dm-badge');
  if (!el) return;
  el.classList.toggle('hidden', n === 0);
  el.textContent = n > 99 ? '99+' : n;
  updateTitleBadge();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateTitleBadge();
});

// ═══════════════════════════════════════════════════════════════════════════
//  BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════════════════

const BOOT_LINES = [
  { text: '> DOLLARS BBS NODE v3.0 — IKEBUKURO RELAY', status: null },
  { text: '> LOADING SYSTEM KERNEL',                    status: 'ok'  },
  { text: '> MOUNTING ENCRYPTED FILESYSTEM',            status: 'ok'  },
  { text: '> TOR RELAY: JP ──► NL ──► US ──► JP',       status: 'ok'  },
  { text: '> HANDSHAKE: SHA-384 VERIFIED',              status: 'ok'  },
  { text: '> MEMBER DATABASE: 12,847 RECORDS',          status: null  },
  { text: '> SCANNING FOR INTRUSION ATTEMPTS',          status: 'ok'  },
  { text: '> LOADING AI RESIDENT PERSONAS',             status: 'ok'  },
  { text: '> ANONYMITY LAYER: ACTIVE',                  status: 'ok'  },
  { text: '> AWAITING AUTHENTICATION',                  status: null  },
];

async function runBoot() {
  const container = $('boot-seq-lines');
  const cursor    = document.querySelector('.boot-cursor');
  if (!container) return;

  for (const line of BOOT_LINES) {
    await new Promise(resolve => {
      const div = document.createElement('div');
      div.className = 'boot-line' + (line.status ? ' ' + line.status : '');
      container.appendChild(div);

      let i = 0;
      const speed = line.status === 'ok' ? 14 : 22;
      const iv = setInterval(() => {
        div.textContent = line.text.slice(0, ++i);
        if (i >= line.text.length) {
          clearInterval(iv);
          setTimeout(resolve, line.status ? 60 : 130);
        }
      }, speed);
    });
  }

  await new Promise(r => setTimeout(r, 300));
  if (cursor) cursor.style.display = 'none';
  $('boot-sequence').classList.add('hidden');
  $('login-form-wrap').classList.remove('hidden');
  setTimeout(() => $('input-password').focus(), 50);
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH OVERLAYS
// ═══════════════════════════════════════════════════════════════════════════

function showOverlay(name) {
  $('overlay-password').classList.toggle('hidden', name !== 'password');
  $('overlay-username').classList.toggle('hidden', name !== 'username');
  $('app').classList.add('hidden');
  if (name === 'username') setTimeout(() => $('input-username').focus(), 50);
}

function showApp() {
  $('overlay-password').classList.add('hidden');
  $('overlay-username').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('display-username').textContent = username;
  $('chat-name-chip').textContent   = username;
  applyFactionChrome();
  if (isAdmin) $('admin-badge').classList.remove('hidden');
  switchTab('chat');
}

function applyFactionChrome() {
  const chip = $('hdr-faction-chip');
  if (chip) {
    chip.textContent = factionShort(faction);
    chip.style.color = factionColor(faction);
    chip.style.borderColor = factionColor(faction);
  }
  const sbf = $('sb-faction');
  if (sbf) sbf.textContent = 'COLOR: ' + factionShort(faction);
  document.body.style.setProperty('--user-faction', factionColor(faction));

  const sbAi = $('sb-ai');
  if (sbAi && config?.aiActive) {
    sbAi.textContent = 'AI: ON';
    sbAi.className = 'sb-ai-on';
  }
}

$('form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('input-password').value;
  $('password-error').classList.add('hidden');
  try {
    const res  = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const data = await res.json();
    if (!res.ok) { $('password-error').classList.remove('hidden'); return; }
    token   = data.token;
    isAdmin = !!data.admin;
    localStorage.setItem('token',   token);
    localStorage.setItem('isAdmin', JSON.stringify(isAdmin));
    showOverlay('username');
  } catch {
    $('password-error').textContent = '// connection error';
    $('password-error').classList.remove('hidden');
  }
});

// Faction picker
document.querySelectorAll('.faction-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.faction-opt').forEach(b => b.classList.toggle('active', b === btn));
    faction = btn.dataset.faction;
    localStorage.setItem('faction', faction);
  });
});

$('form-username').addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = $('input-username').value.trim();
  if (!val) { $('username-error').classList.remove('hidden'); return; }
  $('username-error').classList.add('hidden');
  username = val;
  localStorage.setItem('username', username);
  await loadConfig();
  initSocket();
  showApp();
  // Seed own profile so it shows up
  profileCache[username] = { username, faction, bio: '', status: '', karma: 0, msg_count: 0, post_count: 0, joined_at: Math.floor(Date.now()/1000), last_seen: Math.floor(Date.now()/1000) };
});

async function loadConfig() {
  try {
    const r = await fetch('/api/config', { headers: apiH() });
    if (r.ok) config = await r.json();
    populateSightingLocations();
  } catch {}
}

function populateSightingLocations() {
  if (!config?.locations) return;
  const sel = $('sighting-location');
  if (!sel) return;
  sel.innerHTML = '<option value="">(no location)</option>' +
    Object.entries(config.locations).map(([id, l]) =>
      `<option value="${id}">${esc(l.name)}</option>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════

function initSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token },
    transports: ['polling', 'websocket'],
    reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    socket.emit('join', { username, faction });
    socket.emit('join_room', { room: currentRoom });
    updateStatusBar(true);
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'Unauthorized') logout();
  });

  socket.on('room_history', ({ room, messages }) => {
    if (room !== currentRoom) return;
    const log = $('chat-log');
    log.innerHTML = '';
    messages.forEach(m => renderChatMsg(m, { silent: true }));
    log.scrollTop = log.scrollHeight;
  });

  socket.on('message', (msg) => {
    totalMsgs++;
    const sbm = $('sb-msgs'); if (sbm) sbm.textContent = totalMsgs;

    if (msg.room !== currentRoom) {
      markUnread(msg.room);
      return;
    }
    renderChatMsg(msg);
    scrollToBottom($('chat-log'));
    if (msg.user !== username) sfxMsg();
  });

  socket.on('user_joined', ({ username: u }) => {
    renderSysMsg(`${u} connected`);
  });

  socket.on('user_left', ({ username: u }) => {
    renderSysMsg(`${u} disconnected`);
  });

  socket.on('user_typing', ({ username: u }) => showTypingUser(u));

  socket.on('online_stats', ({ total, users }) => {
    $('stat-online').textContent = total;
    const ao = $('about-online'); if (ao) ao.textContent = total;
    renderOnlineList(users || []);
  });

  socket.on('room_counts', (counts) => {
    $('room-online-count').textContent = counts[currentRoom] || 0;
    document.querySelectorAll('.room-item').forEach(btn => {
      const r = btn.dataset.room;
      const dot = btn.querySelector('.room-dot');
      if (dot && !dot.classList.contains('unread')) {
        dot.classList.toggle('active', (counts[r] || 0) > 0);
      }
    });
  });

  socket.on('new_post',       p => { if (p.board === currentBoard) prependPostRow(p); });
  socket.on('new_reply',      ({ post_id, reply }) => { if (post_id === currentPostId) appendReplyCard(reply); });
  socket.on('post_reacted',   ({ post_id, reactions }) => { if (post_id === currentPostId) renderReactions(reactions); });
  socket.on('post_deleted',   ({ id }) => {
    const row = document.querySelector(`[data-post-id="${id}"]`);
    if (row) row.remove();
    if (currentPostId === id) { currentPostId = null; showForumView('list'); loadBoard(currentBoard); }
  });
  socket.on('post_pinned', () => {
    if ($('forum-view-list') && !$('forum-view-list').classList.contains('hidden')) loadBoard(currentBoard);
  });
  socket.on('reply_deleted', ({ id }) => {
    const card = document.querySelector(`[data-reply-id="${id}"]`);
    if (card) card.remove();
  });

  socket.on('new_sighting', (s) => {
    prependSightingCard(s);
    if (currentTab === 'map') loadMap();
  });

  socket.on('broadcast', ({ text, from }) => {
    showBroadcastOverlay(text, from);
    sfxBroadcast();
  });

  socket.on('incident', (inc) => {
    showIncidentOverlay(inc);
    triggerGlitch();
    sfxIncident();
  });

  socket.on('notif_update', ({ unread }) => {
    setNotifBadge(unread || 0);
  });

  socket.on('dm', (payload) => {
    sfxDm();
    // If panel is open on this thread, append
    if (!$('dm-panel').classList.contains('hidden') && currentDMThread &&
        (payload.from === currentDMThread || payload.to === currentDMThread)) {
      appendDMLine(payload);
    } else if (!payload.echo) {
      // Bump DM badge
      setDMBadge(dmUnread + 1);
      // Quick toast
      renderSysMsg(`✉ whisper from ${payload.from}`);
    }
  });

  socket.on('news_tick', ({ headline }) => pushHeadline(headline));

  socket.on('poll_updated', ({ post_id, votes }) => {
    if (post_id === currentPostId) renderPoll(currentPollData?.question, currentPollData?.options, votes, currentPollData?.id);
  });
}

// Keep-alive ping to update last_seen
setInterval(() => { socket?.emit('presence_ping'); }, 60000);

// ═══════════════════════════════════════════════════════════════════════════
//  TYPING INDICATOR
// ═══════════════════════════════════════════════════════════════════════════

function showTypingUser(u) {
  if (typingUsers[u]) clearTimeout(typingUsers[u]);
  typingUsers[u] = setTimeout(() => { delete typingUsers[u]; updateTypingDisplay(); }, 3000);
  updateTypingDisplay();
}

function updateTypingDisplay() {
  const names = Object.keys(typingUsers);
  const el    = $('typing-indicator');
  if (!el) return;
  if (!names.length) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  if (names.length === 1)      el.textContent = `${names[0]} is typing`;
  else if (names.length === 2) el.textContent = `${names[0]} and ${names[1]} are typing`;
  else                          el.textContent = `${names.length} people are typing`;
}

$('chat-input').addEventListener('keydown', (e) => {
  if (!socket) return;
  if (!isTyping) { socket.emit('typing'); isTyping = true; }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { isTyping = false; }, 2500);

  // Autocomplete nav
  const ac = $('cmd-autocomplete');
  if (!ac.classList.contains('hidden')) {
    const items = [...ac.querySelectorAll('.cmd-row')];
    if (!items.length) return;
    let idx = items.findIndex(i => i.classList.contains('active'));
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; items.forEach((it,i)=>it.classList.toggle('active', i===idx)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; items.forEach((it,i)=>it.classList.toggle('active', i===idx)); }
    else if (e.key === 'Tab' || e.key === 'Enter' && idx >= 0) {
      if (idx < 0) idx = 0;
      e.preventDefault();
      const pick = items[idx].dataset.cmd;
      $('chat-input').value = pick + ' ';
      hideAutocomplete();
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  }
});

$('chat-input').addEventListener('input', () => {
  const v = $('chat-input').value;
  if (v.startsWith('/') && !v.includes(' ')) {
    showAutocomplete(v);
  } else {
    hideAutocomplete();
  }
});

function showAutocomplete(query) {
  const ac = $('cmd-autocomplete');
  const q = query.toLowerCase();
  const matches = SLASH_CMDS.filter(c => c.cmd.startsWith(q)).slice(0, 6);
  if (!matches.length) { hideAutocomplete(); return; }
  ac.innerHTML = matches.map((c, i) =>
    `<div class="cmd-row${i===0?' active':''}" data-cmd="${c.cmd}"><span class="cmd-name">${c.cmd}</span><span class="cmd-desc">${esc(c.desc)}</span></div>`
  ).join('');
  ac.classList.remove('hidden');
  ac.querySelectorAll('.cmd-row').forEach(row => {
    row.addEventListener('click', () => {
      $('chat-input').value = row.dataset.cmd + ' ';
      hideAutocomplete();
      $('chat-input').focus();
    });
  });
}

function hideAutocomplete() {
  $('cmd-autocomplete').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════
//  CHAT RENDER
// ═══════════════════════════════════════════════════════════════════════════

function renderChatMsg(msg, opts = {}) {
  const log = $('chat-log');
  const d   = document.createElement('div');
  const meta = msg.meta ? (() => { try { return JSON.parse(msg.meta); } catch { return {}; } })() : {};
  const isSystem = msg.user === 'SYSTEM' || meta.system;
  const isIncident = meta.incident;

  if (isSystem) {
    d.className = 'chat-msg system' + (isIncident ? ' incident-msg' : '');
    d.innerHTML = `<span class="sys-prefix">—</span><span>${renderText(msg.text)}</span>`;
    log.appendChild(d);
    return;
  }

  d.className = 'chat-msg';
  if (msg.id) d.dataset.msgId = msg.id;
  if (msg.text?.includes('@' + username)) d.classList.add('mentioned');

  const ts = `<span class="msg-ts">${jstFmt(msg.timestamp)}</span>`;
  const fac = profileCache[msg.user]?.faction || 'colorless';
  const color = factionColor(fac);
  const nameHtml = `<span class="msg-name" data-user="${esc(msg.user)}" style="color:${color}">${esc(msg.user)}</span>`;

  // Reply-to preview
  let replyPrev = '';
  if (msg.reply_to) {
    // try to find it in the existing DOM
    const orig = log.querySelector(`[data-msg-id="${msg.reply_to}"]`);
    if (orig) {
      const origText = orig.querySelector('.msg-body')?.textContent || '';
      const origUser = orig.querySelector('.msg-name')?.textContent || '';
      replyPrev = `<span class="msg-replyto">↳ ${esc(origUser)}: ${esc(origText).slice(0, 60)}</span>`;
    }
  }

  // Code block ```...```
  let bodyHtml = renderText(msg.text);
  if (/^```[\s\S]*```$/.test(msg.text.trim())) {
    const inner = msg.text.trim().slice(3, -3);
    bodyHtml = `<pre class="code-block">${esc(inner)}</pre>`;
  }

  const quickReplyBtn = `<button class="msg-reply-btn" title="Reply">↪</button>`;
  d.innerHTML = `${ts}${nameHtml}${replyPrev}<span class="msg-body">${bodyHtml}</span>${quickReplyBtn}`;

  d.querySelector('.msg-reply-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setReplyTo(msg);
  });

  // Load profile for coloring if missing
  if (!profileCache[msg.user]) {
    fetchProfile(msg.user).then(p => {
      if (p) {
        const el = d.querySelector('.msg-name');
        if (el) el.style.color = factionColor(p.faction);
      }
    });
  }

  log.appendChild(d);
}

function renderSysMsg(text) {
  const log = $('chat-log');
  const d = document.createElement('div');
  d.className = 'chat-msg system';
  d.textContent = '— ' + text + ' —';
  log.appendChild(d);
  scrollToBottom(log);
}

// Clicks on mentions → profile; clicks on user names → profile
document.addEventListener('click', (e) => {
  const mentionEl = e.target.closest('.mention');
  if (mentionEl) {
    e.preventDefault();
    openProfile(mentionEl.dataset.user);
    return;
  }
  const nameEl = e.target.closest('.msg-name, .online-user[data-user], .leaderboard-row[data-user]');
  if (nameEl && nameEl.dataset.user) openProfile(nameEl.dataset.user);
});

function setReplyTo(msg) {
  replyToMsg = { id: msg.id, user: msg.user, text: msg.text };
  $('reply-chip').classList.remove('hidden');
  $('reply-chip-text').textContent = `replying to ${msg.user}: ${String(msg.text).slice(0, 60)}`;
  $('chat-input').focus();
}

$('btn-cancel-reply').addEventListener('click', () => {
  replyToMsg = null;
  $('reply-chip').classList.add('hidden');
});

$('form-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp  = $('chat-input');
  const text = inp.value.trim();
  if (!text || !socket) return;
  socket.emit('chat_message', { text, reply_to: replyToMsg?.id || null });
  inp.value = '';
  isTyping  = false;
  replyToMsg = null;
  $('reply-chip').classList.add('hidden');
  hideAutocomplete();
});

// Online users list (chat sidebar)
function renderOnlineList(users) {
  const list = $('online-users-list');
  if (!list) return;
  list.innerHTML = users.map(u => {
    const p = profileCache[u];
    const color = p ? factionColor(p.faction) : '#a0a0a0';
    return `<div class="online-user" data-user="${esc(u)}" style="--f:${color}">${esc(u)}</div>`;
  }).join('');
  // Backfill profile fetches
  users.forEach(u => {
    if (!profileCache[u]) fetchProfile(u).then(() => {
      const el = list.querySelector(`[data-user="${CSS.escape(u)}"]`);
      if (el) el.style.setProperty('--f', userColorFor(u));
    });
  });
  // Also populate members tab if open
  if (currentTab === 'members') renderMembersOnline(users);
}

// Scroll-to-bottom button
const chatLog = $('chat-log');
chatLog.addEventListener('scroll', () => {
  const dist = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight;
  $('scroll-to-bottom').classList.toggle('hidden', dist < 200);
});
$('scroll-to-bottom').addEventListener('click', () => {
  chatLog.scrollTop = chatLog.scrollHeight;
  $('scroll-to-bottom').classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════════════════
//  ROOM SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.room-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.room;
    if (room === currentRoom) return;
    clearUnread(room);
    currentRoom = room;
    document.querySelectorAll('.room-item').forEach(b => b.classList.toggle('active', b.dataset.room === room));
    $('room-title-display').textContent = ROOMS[room]?.label || room;
    $('chat-log').innerHTML = '';
    typingUsers = {};
    updateTypingDisplay();
    socket?.emit('join_room', { room });
    $('chat-sidebar')?.classList.remove('open');
  });
});

$('btn-sidebar-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const activePane = document.querySelector('.pane:not(.hidden)');
  const sidebar = activePane?.querySelector('.sidebar');
  if (sidebar) sidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  document.querySelectorAll('.sidebar.open').forEach(sb => {
    if (!sb.contains(e.target) && e.target !== $('btn-sidebar-toggle')) {
      sb.classList.remove('open');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['chat','forum','sightings','map','members','about'].forEach(t => $('pane-' + t).classList.toggle('hidden', t !== name));
  if (name === 'forum')     loadBoard(currentBoard);
  if (name === 'sightings') loadSightings();
  if (name === 'map')       { buildMap(); loadMap(); }
  if (name === 'members')   loadMembers();
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ═══════════════════════════════════════════════════════════════════════════
//  BOARDS & POSTS
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.board-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const board = btn.dataset.board;
    document.querySelectorAll('.board-item').forEach(b => b.classList.toggle('active', b.dataset.board === board));
    currentBoard = board;
    loadBoard(board);
  });
});

async function loadBoard(board) {
  showForumView('list');
  $('board-title-display').textContent = BOARDS[board] || ('> ' + board.toUpperCase() + ' BOARD');
  $('new-post-board-label').textContent = '> NEW POST — ' + board.toUpperCase() + ' BOARD';
  const list = $('post-list');
  list.innerHTML = '<div style="padding:.75rem .85rem;color:var(--g4);font-size:.75rem">loading...</div>';
  try {
    const res = await fetch(`/api/posts?board=${encodeURIComponent(board)}`, { headers: apiH() });
    if (!res.ok) return;
    const posts = await res.json();
    list.innerHTML = '';
    if (!posts.length) {
      list.innerHTML = '<div style="padding:.75rem .85rem;color:var(--g4);font-size:.78rem">no posts yet. be the first.</div>';
      return;
    }
    posts.forEach(p => appendPostRow(list, p));
  } catch {}
}

function appendPostRow(container, post) {
  const row = document.createElement('div');
  row.className = 'post-row' + (post.pinned ? ' pinned' : '');
  row.dataset.postId = post.id;
  row.dataset.pinned = post.pinned ? '1' : '0';

  const pin  = post.pinned  ? '<span class="pin-icon">📌</span>' : '';
  const poll = post.has_poll ? '<span class="pin-icon">📊</span>' : '';

  let adminHtml = '';
  if (isAdmin) {
    adminHtml =
      `<div class="admin-row-controls" onclick="event.stopPropagation()">` +
        `<button class="admin-btn pin-btn" data-id="${post.id}" data-pinned="${post.pinned || 0}" title="${post.pinned ? 'Unpin' : 'Pin'}">📌</button>` +
        `<button class="admin-btn del-btn" data-id="${post.id}" title="Delete post">🗑</button>` +
      `</div>`;
  }

  row.innerHTML =
    `<div class="post-row-body">` +
      `<div class="post-row-title">${pin}${poll}${esc(post.title)}</div>` +
      `<div class="post-row-meta">by <strong data-user="${esc(post.author)}" class="linkable-author">${esc(post.author)}</strong> &middot; ${timeAgo(post.created_at)}</div>` +
      `<div class="post-row-counts">` +
        `<span>💬 ${post.reply_count || 0}</span>` +
        `<span>👁 ${post.views || 0}</span>` +
      `</div>` +
    `</div>` +
    adminHtml +
    `<span class="post-arrow">&#x25B6;</span>`;

  if (isAdmin) {
    row.querySelector('.pin-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const id     = Number(e.currentTarget.dataset.id);
      const pinned = e.currentTarget.dataset.pinned === '1';
      await fetch(`/api/posts/${id}/pin`, { method: 'PATCH', headers: apiH(), body: JSON.stringify({ pinned: !pinned }) });
    });
    row.querySelector('.del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(e.currentTarget.dataset.id);
      if (!confirm('Delete this post and all its replies?')) return;
      await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: apiH() });
    });
  }

  row.addEventListener('click', (e) => {
    if (e.target.closest('.linkable-author')) {
      e.stopPropagation(); openProfile(e.target.dataset.user); return;
    }
    openPost(post.id);
  });
  container.appendChild(row);
}

function prependPostRow(post) {
  const list = $('post-list');
  const placeholder = list.querySelector('[style]');
  if (placeholder) placeholder.remove();
  if (list.querySelector(`[data-post-id="${post.id}"]`)) return;
  const tmp = document.createElement('div');
  appendPostRow(tmp, post);
  list.prepend(tmp.firstChild);
}

// New post + poll
$('btn-new-post').addEventListener('click', () => {
  showForumView('newpost');
  $('new-post-title').focus();
});
$('btn-cancel-post').addEventListener('click', () => showForumView('list'));
$('new-post-poll-toggle').addEventListener('change', (e) => {
  $('poll-compose-wrap').classList.toggle('hidden', !e.target.checked);
});

$('form-new-post').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title   = $('new-post-title').value.trim();
  const content = $('new-post-content').value.trim();
  if (!title || !content) return;
  let poll = null;
  if ($('new-post-poll-toggle').checked) {
    const q = $('poll-question').value.trim();
    const options = [...document.querySelectorAll('.poll-option-input')].map(i => i.value.trim()).filter(Boolean);
    if (q && options.length >= 2) poll = { question: q, options };
  }
  const res = await fetch('/api/posts', {
    method: 'POST', headers: apiH(),
    body: JSON.stringify({ board: currentBoard, title, author: username, content, poll }),
  });
  if (!res.ok) return;
  $('new-post-title').value = '';
  $('new-post-content').value = '';
  $('new-post-poll-toggle').checked = false;
  $('poll-compose-wrap').classList.add('hidden');
  document.querySelectorAll('.poll-option-input').forEach(i => i.value = '');
  $('poll-question').value = '';
  showForumView('list');
  loadBoard(currentBoard);
});

let currentPollData = null;

async function openPost(id) {
  currentPostId = id;
  showForumView('detail');
  const res = await fetch(`/api/posts/${id}`, { headers: apiH() });
  if (!res.ok) return;
  const post = await res.json();

  let adminDetailHtml = '';
  if (isAdmin) adminDetailHtml = `<button class="admin-btn del-btn" style="float:right;margin-left:.5rem" onclick="adminDeletePost(${post.id})">🗑 delete post</button>`;

  $('post-detail-body').innerHTML =
    `<div class="detail-title">${adminDetailHtml}${esc(post.title)}</div>` +
    `<div class="detail-meta">by <strong data-user="${esc(post.author)}" class="linkable-author">${esc(post.author)}</strong> &middot; ${fmtDate(post.created_at)} &middot; ${post.views || 0} views</div>` +
    `<div class="detail-body">${renderText(post.content)}</div>`;

  if (post.poll) {
    currentPollData = post.poll;
    renderPoll(post.poll.question, post.poll.options, post.poll.votes || {}, post.poll.id);
    $('poll-widget').classList.remove('hidden');
  } else {
    currentPollData = null;
    $('poll-widget').classList.add('hidden');
  }

  renderReactions(post.reactions || []);

  const replies = $('post-replies');
  replies.innerHTML = '';
  (post.replies || []).forEach(appendReplyCard);
  $('reply-content').focus();
}

function renderPoll(question, options, votes, pollId) {
  const total = Object.values(votes || {}).reduce((a, b) => a + b, 0) || 0;
  const el = $('poll-widget');
  el.dataset.pollId = pollId;
  el.innerHTML = `<div class="poll-q">📊 ${esc(question)}</div>` +
    options.map((opt, idx) => {
      const n = votes[idx] || 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      return `<button class="poll-opt" data-idx="${idx}">
                <span class="poll-fill" style="width:${pct}%"></span>
                <span class="poll-label">${esc(opt)}</span>
                <span class="poll-count">${n} · ${pct}%</span>
              </button>`;
    }).join('') +
    `<div class="poll-total">${total} votes</div>`;

  el.querySelectorAll('.poll-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/polls/${pollId}/vote`, {
        method: 'POST', headers: apiH(),
        body: JSON.stringify({ voter: username, option_idx: Number(btn.dataset.idx) }),
      });
    });
  });
}

function appendReplyCard(reply) {
  const card = document.createElement('div');
  card.className = 'reply-card';
  card.dataset.replyId = reply.id;

  let adminCtrl = '';
  if (isAdmin) adminCtrl = `<button class="reply-admin-ctrl" data-id="${reply.id}" title="Delete reply">🗑</button>`;

  card.innerHTML =
    `<div class="reply-author">${adminCtrl}<strong data-user="${esc(reply.author)}" class="linkable-author">${esc(reply.author)}</strong> &middot; ${fmtDate(reply.created_at)}</div>` +
    `<div class="reply-body">${renderText(reply.content)}</div>`;

  if (isAdmin) {
    card.querySelector('.reply-admin-ctrl').addEventListener('click', async (e) => {
      e.stopPropagation();
      const rid = Number(e.currentTarget.dataset.id);
      if (!confirm('Delete this reply?')) return;
      await fetch(`/api/replies/${rid}`, { method: 'DELETE', headers: apiH() });
    });
  }

  $('post-replies').appendChild(card);
}

window.adminDeletePost = async function(id) {
  if (!confirm('Delete this post and all its replies?')) return;
  await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: apiH() });
};

$('btn-back-to-list').addEventListener('click', () => {
  currentPostId = null;
  loadBoard(currentBoard);
});

$('form-reply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = $('reply-content').value.trim();
  if (!content || !currentPostId) return;
  const res = await fetch(`/api/posts/${currentPostId}/reply`, {
    method: 'POST', headers: apiH(),
    body: JSON.stringify({ author: username, content }),
  });
  if (res.ok) $('reply-content').value = '';
});

function showForumView(name) {
  ['list','newpost','detail'].forEach(v => $('forum-view-' + v).classList.toggle('hidden', v !== name));
}

// ═══════════════════════════════════════════════════════════════════════════
//  REACTIONS
// ═══════════════════════════════════════════════════════════════════════════

function renderReactions(reactions) {
  const bar = $('reaction-bar');
  if (!bar) return;
  const counts = {};
  (reactions || []).forEach(r => counts[r.emoji] = r.count);
  bar.innerHTML = EMOJIS.map(e =>
    `<button class="react-btn" data-emoji="${e}"><span>${e}</span><span class="react-count">${counts[e] || 0}</span></button>`
  ).join('');
  bar.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentPostId) return;
      const emoji = btn.dataset.emoji;
      const res = await fetch(`/api/posts/${currentPostId}/react`, {
        method: 'POST', headers: apiH(), body: JSON.stringify({ emoji }),
      });
      if (res.ok) { const data = await res.json(); renderReactions(data.reactions); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════════════════════

$('btn-search').addEventListener('click', () => openSearch());

$('btn-close-search').addEventListener('click', closeSearch);
$('search-overlay').addEventListener('click', (e) => { if (e.target === $('search-overlay')) closeSearch(); });

function openSearch() {
  $('search-overlay').classList.remove('hidden');
  setTimeout(() => $('search-input').focus(), 50);
}
function closeSearch() {
  $('search-overlay').classList.add('hidden');
  $('search-input').value = '';
  $('search-results').innerHTML = '';
}

$('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(performSearch, 300);
});

async function performSearch() {
  const q = $('search-input').value.trim();
  const results = $('search-results');
  if (!q) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="search-loading">searching...</div>';
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: apiH() });
    const posts = await res.json();
    if (!posts.length) { results.innerHTML = '<div class="search-empty">no results found</div>'; return; }
    results.innerHTML = '';
    posts.forEach(p => {
      const row = document.createElement('div');
      row.className = 'search-result';
      row.innerHTML =
        `<span class="search-board">[${p.board.toUpperCase()}]</span>` +
        `<span class="search-title">${esc(p.title)}</span>` +
        `<span class="search-meta">by ${esc(p.author)} · ${timeAgo(p.created_at)} · 💬 ${p.reply_count || 0}</span>`;
      row.addEventListener('click', () => {
        closeSearch();
        if (currentBoard !== p.board) {
          currentBoard = p.board;
          document.querySelectorAll('.board-item').forEach(b => b.classList.toggle('active', b.dataset.board === p.board));
        }
        switchTab('forum');
        openPost(p.id);
      });
      results.appendChild(row);
    });
  } catch {
    results.innerHTML = '<div class="search-empty">// search failed</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BROADCAST
// ═══════════════════════════════════════════════════════════════════════════

$('btn-broadcast').addEventListener('click', () => {
  const last = parseInt(localStorage.getItem('lastBroadcast') || '0');
  const elapsed = Date.now() - last;
  const cooldown = 24 * 3600 * 1000;
  if (last && elapsed < cooldown) {
    const remaining = Math.ceil((cooldown - elapsed) / 3600000);
    alert(`Broadcast cooldown active: ${remaining}h remaining`);
    return;
  }
  $('broadcast-modal').classList.remove('hidden');
  $('broadcast-input').value = '';
  $('broadcast-chars').textContent = '0';
  setTimeout(() => $('broadcast-input').focus(), 50);
});
$('broadcast-input').addEventListener('input', () => {
  $('broadcast-chars').textContent = $('broadcast-input').value.length;
});
$('btn-cancel-broadcast').addEventListener('click', () => $('broadcast-modal').classList.add('hidden'));
$('broadcast-modal').addEventListener('click', (e) => { if (e.target === $('broadcast-modal')) $('broadcast-modal').classList.add('hidden'); });

$('btn-send-broadcast').addEventListener('click', () => {
  const text = $('broadcast-input').value.trim();
  if (!text || !socket) return;
  socket.emit('broadcast', { text });
  localStorage.setItem('lastBroadcast', Date.now().toString());
  $('broadcast-modal').classList.add('hidden');
});

function showBroadcastOverlay(text, from) {
  $('broadcast-text').textContent = text;
  $('broadcast-from').textContent = from ? `from: ${from}` : '';
  $('broadcast-overlay').classList.remove('hidden');

  const bar = $('broadcast-progress');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  bar.getBoundingClientRect();
  bar.style.transition = 'width 8s linear';
  bar.style.width = '0%';

  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => { $('broadcast-overlay').classList.add('hidden'); broadcastTimer = null; }, 8000);
}
$('btn-dismiss-broadcast').addEventListener('click', () => {
  if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = null; }
  $('broadcast-overlay').classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════════════════
//  INCIDENT
// ═══════════════════════════════════════════════════════════════════════════

function showIncidentOverlay(inc) {
  $('incident-kind').textContent = (inc.kind || '').replace(/_/g, ' ').toUpperCase();
  $('incident-title').textContent = inc.title;
  $('incident-body').textContent = inc.body;
  $('incident-loc').textContent = inc.location ? `LOCATION: ${(config?.locations?.[inc.location]?.name || inc.location)}` : '';
  $('incident-overlay').classList.remove('hidden');

  setTimeout(() => $('incident-overlay').classList.add('hidden'), 12000);
}
$('btn-dismiss-incident').addEventListener('click', () => $('incident-overlay').classList.add('hidden'));

function triggerGlitch() {
  const g = $('glitch-overlay');
  g.classList.add('active');
  setTimeout(() => g.classList.remove('active'), 900);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SIGHTINGS
// ═══════════════════════════════════════════════════════════════════════════

async function loadSightings() {
  const list = $('sightings-list');
  list.innerHTML = '<div class="sightings-loading">loading...</div>';
  try {
    const res = await fetch('/api/sightings', { headers: apiH() });
    const sightings = await res.json();
    list.innerHTML = '';
    if (!sightings.length) { list.innerHTML = '<div class="sightings-empty">no sightings yet. be the first to report.</div>'; return; }
    sightings.forEach(s => appendSightingCard(s));
  } catch { list.innerHTML = '<div class="sightings-empty">// failed to load sightings</div>'; }
}

function appendSightingCard(s) { $('sightings-list').appendChild(buildSightingCard(s)); }
function prependSightingCard(s) {
  const list = $('sightings-list');
  const empty = list.querySelector('.sightings-empty');
  if (empty) empty.remove();
  list.prepend(buildSightingCard(s));
}

function buildSightingCard(s) {
  const card = document.createElement('div');
  card.className = 'sighting-card';
  card.dataset.sightingId = s.id;
  const now = Math.floor(Date.now() / 1000);
  const total = 86400;
  const remaining = Math.max(0, s.expires_at - now);
  const pct = Math.round((remaining / total) * 100);
  const loc = s.location && config?.locations?.[s.location] ? config.locations[s.location].name : '';

  card.innerHTML =
    `<div class="sighting-header">` +
      `<span class="sighting-user linkable-author" data-user="${esc(s.user)}">${esc(s.user)}</span>` +
      `<span class="sighting-time">${timeAgo(s.created_at)}</span>` +
      (loc ? `<span class="sighting-loc">⌖ ${esc(loc)}</span>` : '') +
    `</div>` +
    `<div class="sighting-text">${renderText(s.text)}</div>` +
    `<div class="sighting-ttl-wrap"><div class="sighting-ttl-bar" style="width:${pct}%"></div></div>`;

  return card;
}

$('btn-new-sighting').addEventListener('click', () => {
  const compose = $('sightings-compose');
  compose.classList.toggle('hidden');
  if (!compose.classList.contains('hidden')) $('sighting-input').focus();
});
$('btn-cancel-sighting').addEventListener('click', () => {
  $('sightings-compose').classList.add('hidden');
  $('sighting-input').value = '';
});

$('form-sighting').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('sighting-input').value.trim();
  if (!text) return;
  const location = $('sighting-location').value || null;
  const res = await fetch('/api/sightings', {
    method: 'POST', headers: apiH(),
    body: JSON.stringify({ user: username, text, location }),
  });
  if (res.ok) {
    $('sighting-input').value = '';
    $('sightings-compose').classList.add('hidden');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  MAP
// ═══════════════════════════════════════════════════════════════════════════

function buildMap() {
  if (!config?.locations) return;
  const svg = $('map-svg');
  if (!svg) return;

  // Ikebukuro schematic: grid + a river + rail lines
  let html = '';
  // Grid
  for (let i = 10; i <= 90; i += 10) {
    html += `<line x1="${i}" y1="0" x2="${i}" y2="100" stroke="rgba(0,255,65,0.07)" stroke-width="0.2"/>`;
    html += `<line x1="0" y1="${i}" x2="100" y2="${i}" stroke="rgba(0,255,65,0.07)" stroke-width="0.2"/>`;
  }
  // "Rail" (two diagonals)
  html += `<line x1="20" y1="55" x2="90" y2="58" stroke="rgba(0,255,65,0.35)" stroke-width="0.6" stroke-dasharray="2 1"/>`;
  html += `<line x1="15" y1="48" x2="85" y2="52" stroke="rgba(0,255,65,0.35)" stroke-width="0.6" stroke-dasharray="2 1"/>`;
  // Big loops
  html += `<circle cx="50" cy="50" r="42" fill="none" stroke="rgba(0,255,65,0.08)" stroke-width="0.3"/>`;
  html += `<circle cx="50" cy="50" r="30" fill="none" stroke="rgba(0,255,65,0.12)" stroke-width="0.3"/>`;

  // Location pins
  for (const [id, loc] of Object.entries(config.locations)) {
    html += `<g class="map-loc" data-loc="${id}">
      <circle class="map-dot" cx="${loc.x}" cy="${loc.y}" r="1.8"/>
      <circle class="map-pulse" cx="${loc.x}" cy="${loc.y}" r="1.8"/>
      <text class="map-label" x="${loc.x + 2.2}" y="${loc.y + 0.6}" font-size="2.4">${esc(loc.name)}</text>
    </g>`;
  }

  svg.innerHTML = html;

  svg.querySelectorAll('.map-loc').forEach(g => {
    g.addEventListener('click', () => selectMapLocation(g.dataset.loc));
    g.addEventListener('mouseenter', (e) => {
      const id = g.dataset.loc;
      const loc = config.locations[id];
      const hover = $('map-hover');
      hover.textContent = loc.name + ' — ' + loc.desc;
      hover.classList.remove('hidden');
    });
    g.addEventListener('mouseleave', () => $('map-hover').classList.add('hidden'));
  });
}

async function loadMap() {
  if (!config?.locations) await loadConfig();
  buildMap();
  try {
    const r = await fetch('/api/map', { headers: apiH() });
    const data = await r.json();
    const svg = $('map-svg');

    // Decorate with sighting counts + drop counts
    const counts = {};
    (data.sightings || []).forEach(s => {
      if (!s.location) return;
      counts[s.location] = (counts[s.location] || 0) + 1;
    });

    svg.querySelectorAll('.map-loc').forEach(g => {
      const id = g.dataset.loc;
      const dot = g.querySelector('.map-dot');
      const pulse = g.querySelector('.map-pulse');
      const activity = (counts[id] || 0) + (data.dropCounts?.[id] || 0);
      const size = 1.8 + Math.min(5, activity * 0.9);
      dot.setAttribute('r', size);
      pulse.setAttribute('r', size);
      pulse.style.opacity = activity ? 1 : 0.3;
      g.classList.toggle('has-activity', activity > 0);

      // Label badge
      const existing = g.querySelector('.map-badge');
      if (existing) existing.remove();
      if (activity > 0) {
        const loc = config.locations[id];
        const badge = document.createElementNS('http://www.w3.org/2000/svg','text');
        badge.setAttribute('class','map-badge');
        badge.setAttribute('x', loc.x - 2.5);
        badge.setAttribute('y', loc.y - 2.5);
        badge.setAttribute('font-size','2.5');
        badge.textContent = activity;
        g.appendChild(badge);
      }
    });
  } catch {}
}

async function selectMapLocation(id) {
  currentMapLoc = id;
  const loc = config.locations[id];
  $('map-loc-name').textContent = loc.name;
  $('btn-drop-here').classList.remove('hidden');
  document.querySelectorAll('.map-loc').forEach(g => g.classList.toggle('selected', g.dataset.loc === id));

  const body = $('map-loc-body');
  body.innerHTML = '<p class="map-empty">loading...</p>';

  try {
    const [dropsRes, sightingsRes] = await Promise.all([
      fetch(`/api/drops/${id}`, { headers: apiH() }),
      fetch('/api/sightings', { headers: apiH() }),
    ]);
    const drops     = await dropsRes.json();
    const sightings = (await sightingsRes.json()).filter(s => s.location === id);

    let html = '';
    html += `<div class="map-sec-title">${loc.name.toUpperCase()} — ${esc(loc.desc)}</div>`;
    html += `<div class="map-sec-sub">${sightings.length} sightings · ${drops.length} dead drops</div>`;

    if (sightings.length) {
      html += '<div class="map-subhead">▸ recent sightings</div>';
      html += sightings.slice(0, 6).map(s =>
        `<div class="drop-card sighting-inline">
           <div class="drop-head"><span class="linkable-author" data-user="${esc(s.user)}">${esc(s.user)}</span> · ${timeAgo(s.created_at)}</div>
           <div class="drop-body">${renderText(s.text)}</div>
         </div>`
      ).join('');
    }

    if (drops.length) {
      html += '<div class="map-subhead">✦ dead drops left here</div>';
      html += drops.map(d =>
        `<div class="drop-card">
           <div class="drop-head"><span class="linkable-author" data-user="${esc(d.user)}">${esc(d.user)}</span> · ${timeAgo(d.created_at)}</div>
           <div class="drop-body">${renderText(d.text)}</div>
         </div>`
      ).join('');
    } else if (!sightings.length) {
      html += '<p class="map-empty">nothing here yet. leave a drop?</p>';
    }

    body.innerHTML = html;
  } catch {
    body.innerHTML = '<p class="map-empty">// failed to load location</p>';
  }
}

$('btn-drop-here').addEventListener('click', () => {
  if (!currentMapLoc) return;
  $('drop-loc-label').textContent = config.locations[currentMapLoc].name;
  $('drop-modal').classList.remove('hidden');
  setTimeout(() => $('drop-input').focus(), 50);
});
$('btn-cancel-drop').addEventListener('click', () => $('drop-modal').classList.add('hidden'));
$('drop-modal').addEventListener('click', (e) => { if (e.target === $('drop-modal')) $('drop-modal').classList.add('hidden'); });
$('btn-send-drop').addEventListener('click', async () => {
  const text = $('drop-input').value.trim();
  if (!text || !currentMapLoc) return;
  await fetch('/api/drops', {
    method: 'POST', headers: apiH(),
    body: JSON.stringify({ user: username, location: currentMapLoc, text }),
  });
  $('drop-input').value = '';
  $('drop-modal').classList.add('hidden');
  selectMapLocation(currentMapLoc);
  loadMap();
});

// ═══════════════════════════════════════════════════════════════════════════
//  MEMBERS / LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════

async function loadMembers() {
  try {
    const r = await fetch('/api/leaderboard', { headers: apiH() });
    const rows = await r.json();
    const list = $('leaderboard-list');
    list.innerHTML = rows.map((row, i) => {
      const color = factionColor(row.faction || 'colorless');
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
      return `<div class="leaderboard-row" data-user="${esc(row.username)}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name" style="color:${color}">${esc(row.username)}</span>
        <span class="lb-faction">[${factionShort(row.faction)}]</span>
        <span class="lb-stats">✦ ${row.karma}  ·  💬 ${row.msg_count}  ·  ▣ ${row.post_count}</span>
      </div>`;
    }).join('') || '<div class="lb-empty">no members yet</div>';

    // Faction breakdown
    const fb = $('faction-breakdown');
    const counts = rows.reduce((a, r) => ((a[r.faction] = (a[r.faction] || 0) + 1), a), {});
    fb.innerHTML = Object.entries(config?.factions || {}).map(([id, f]) => {
      const n = counts[id] || 0;
      return `<div class="faction-row">
                <span class="faction-swatch" style="background:${f.color}"></span>
                <span class="faction-label">${esc(f.name)}</span>
                <span class="faction-count">${n}</span>
              </div>`;
    }).join('');
  } catch {}

  // Online list
  const users = [...document.querySelectorAll('#online-users-list .online-user')].map(e => e.dataset.user).filter(Boolean);
  renderMembersOnline(users);
}

function renderMembersOnline(users) {
  const el = $('members-online');
  if (!el) return;
  el.innerHTML = users.map(u => {
    const c = userColorFor(u);
    return `<div class="member-pill linkable-author" data-user="${esc(u)}" style="--c:${c}">${esc(u)}</div>`;
  }).join('') || '<div class="lb-empty">nobody online</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROFILE MODAL
// ═══════════════════════════════════════════════════════════════════════════

async function openProfile(user) {
  if (!user) return;
  const res = await fetch('/api/profile/' + encodeURIComponent(user), { headers: apiH() });
  if (!res.ok) return;
  const p = await res.json();
  profileCache[user] = p;

  const color = factionColor(p.faction);
  $('profile-name').textContent = p.username;
  $('profile-name').style.color = color;
  const chip = $('profile-faction-chip');
  chip.textContent = factionShort(p.faction);
  chip.style.color = color;
  chip.style.borderColor = color;
  $('profile-status').textContent = p.status || '';
  $('profile-bio').textContent = p.bio || '(no bio yet)';
  $('ps-karma').textContent = p.karma || 0;
  $('ps-msgs').textContent = p.msg_count || 0;
  $('ps-posts').textContent = p.post_count || 0;
  $('ps-since').textContent = p.joined_at ? fmtDate(p.joined_at) : '—';
  $('ps-seen').textContent = p.last_seen ? timeAgo(p.last_seen) : '—';

  const av = $('profile-avatar');
  av.textContent = initials(p.username);
  av.style.color = color;
  av.style.borderColor = color;

  const isMe = p.username === username;
  $('btn-profile-edit').classList.toggle('hidden', !isMe);
  $('btn-profile-dm').classList.toggle('hidden', isMe);

  $('profile-edit-wrap').classList.add('hidden');
  $('profile-modal').classList.remove('hidden');
}

$('btn-close-profile').addEventListener('click', () => $('profile-modal').classList.add('hidden'));
$('profile-modal').addEventListener('click', (e) => { if (e.target === $('profile-modal')) $('profile-modal').classList.add('hidden'); });

$('btn-profile-me').addEventListener('click', () => openProfile(username));

$('btn-profile-edit').addEventListener('click', () => {
  const p = profileCache[username] || {};
  $('profile-edit-status').value = p.status || '';
  $('profile-edit-bio').value = p.bio || '';
  $('profile-edit-faction').value = p.faction || faction || 'colorless';
  $('profile-edit-wrap').classList.remove('hidden');
});
$('btn-profile-cancel').addEventListener('click', () => $('profile-edit-wrap').classList.add('hidden'));

$('btn-profile-save').addEventListener('click', async () => {
  const bio    = $('profile-edit-bio').value.trim();
  const status = $('profile-edit-status').value.trim();
  const newFac = $('profile-edit-faction').value;
  const res = await fetch('/api/profile', {
    method: 'PATCH', headers: apiH(),
    body: JSON.stringify({ username, bio, status, faction: newFac }),
  });
  if (res.ok) {
    const p = await res.json();
    profileCache[username] = p;
    faction = p.faction;
    localStorage.setItem('faction', faction);
    applyFactionChrome();
    openProfile(username);
  }
});

$('btn-profile-dm').addEventListener('click', () => {
  const target = $('profile-name').textContent;
  $('profile-modal').classList.add('hidden');
  openDMPanel(target);
});

// ═══════════════════════════════════════════════════════════════════════════
//  DMs
// ═══════════════════════════════════════════════════════════════════════════

$('btn-dms').addEventListener('click', () => openDMPanel());
$('btn-close-dms').addEventListener('click', () => $('dm-panel').classList.add('hidden'));

async function openDMPanel(targetUser = null) {
  $('dm-panel').classList.remove('hidden');
  setDMBadge(0);
  await refreshDMConversations();
  if (targetUser) startDMThread(targetUser);
}

async function refreshDMConversations() {
  try {
    const r = await fetch(`/api/dms/conversations?me=${encodeURIComponent(username)}`, { headers: apiH() });
    const convos = await r.json();
    const list = $('dm-convo-list');
    if (!convos.length) { list.innerHTML = '<div class="dm-empty">no whispers yet. start one above.</div>'; return; }
    list.innerHTML = convos.map(c => {
      const unread = c.unread > 0 ? `<span class="dm-unread">${c.unread}</span>` : '';
      return `<button class="dm-convo" data-user="${esc(c.other)}">
                <div class="dm-convo-top">
                  <span class="dm-convo-name">${esc(c.other)}</span>
                  <span class="dm-convo-time">${timeAgo(c.last_at)}</span>
                </div>
                <div class="dm-convo-preview">${esc((c.preview || '').slice(0, 60))}</div>
                ${unread}
              </button>`;
    }).join('');
    list.querySelectorAll('.dm-convo').forEach(b => {
      b.addEventListener('click', () => startDMThread(b.dataset.user));
    });
  } catch {}
}

async function startDMThread(other) {
  currentDMThread = other;
  $('dm-thread-header').textContent = '↪ ' + other;
  $('form-dm').classList.remove('hidden');
  $('dm-log').innerHTML = '<div class="dm-empty">loading...</div>';
  document.querySelectorAll('.dm-convo').forEach(b => b.classList.toggle('active', b.dataset.user === other));

  try {
    const r = await fetch(`/api/dms/${encodeURIComponent(other)}?me=${encodeURIComponent(username)}`, { headers: apiH() });
    const msgs = await r.json();
    const log = $('dm-log');
    log.innerHTML = '';
    if (!msgs.length) { log.innerHTML = '<div class="dm-empty">no history. say hello.</div>'; }
    else msgs.forEach(m => appendDMLine({ from: m.from_user, to: m.to_user, text: m.text, created_at: m.created_at }));
    log.scrollTop = log.scrollHeight;
    refreshDMConversations();
  } catch {}
}

function appendDMLine(p) {
  const log = $('dm-log');
  const empty = log.querySelector('.dm-empty');
  if (empty) empty.remove();
  const mine = p.from === username;
  const d = document.createElement('div');
  d.className = 'dm-line ' + (mine ? 'mine' : 'theirs');
  d.innerHTML = `<span class="dm-meta">${mine ? 'you' : esc(p.from)} · ${jstFmt(p.created_at || Math.floor(Date.now()/1000))}</span>
                 <span class="dm-text">${renderText(p.text)}</span>`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

$('form-dm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('dm-input');
  const text = inp.value.trim();
  if (!text || !currentDMThread || !socket) return;
  socket.emit('dm_send', { to: currentDMThread, text });
  inp.value = '';
});

$('dm-new-user').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const u = e.target.value.trim();
    if (u) { startDMThread(u); e.target.value = ''; }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

$('btn-notifs').addEventListener('click', async () => {
  $('notif-panel').classList.remove('hidden');
  try {
    const r = await fetch(`/api/notifications?me=${encodeURIComponent(username)}`, { headers: apiH() });
    const list = await r.json();
    const el = $('notif-list');
    if (!list.length) { el.innerHTML = '<div class="dm-empty">no notifications</div>'; }
    else {
      el.innerHTML = list.map(n => {
        const icon = n.type === 'mention' ? '@' : n.type === 'dm' ? '✉' : n.type === 'reply' ? '↪' : '·';
        return `<div class="notif-item ${n.seen ? '' : 'unseen'}">
                  <span class="notif-icon">${icon}</span>
                  <div class="notif-body">
                    <div class="notif-top"><strong class="linkable-author" data-user="${esc(n.source)}">${esc(n.source)}</strong> · ${timeAgo(n.created_at)}</div>
                    <div class="notif-preview">${esc(n.preview)}</div>
                  </div>
                </div>`;
      }).join('');
    }
    // Mark seen
    await fetch('/api/notifications/seen', { method: 'POST', headers: apiH(), body: JSON.stringify({ me: username }) });
    setNotifBadge(0);
  } catch {}
});
$('btn-close-notifs').addEventListener('click', () => $('notif-panel').classList.add('hidden'));

// ═══════════════════════════════════════════════════════════════════════════
//  NEWS TICKER
// ═══════════════════════════════════════════════════════════════════════════

function pushHeadline(h) {
  tickerHeadlines.push(h);
  if (tickerHeadlines.length > 12) tickerHeadlines.shift();
  renderTicker();
}
function renderTicker() {
  const track = $('ticker-track');
  if (!track || !tickerHeadlines.length) return;
  track.innerHTML = tickerHeadlines.map(h => `<span class="ticker-item">${esc(h)}</span>`).join('<span class="ticker-sep">·</span>');
}

// Seed some headlines initially so the ticker has content
['> IKEBUKURO RELAY ONLINE',
 '> WEATHER — partly cloudy, 18°C',
 '> SIGNAL — nominal, latency 42ms',
 '> MEMBER COUNT — 12,847',
 '> NIGHT MODE — available via /me'].forEach(pushHeadline);

// ═══════════════════════════════════════════════════════════════════════════
//  SOUND TOGGLE
// ═══════════════════════════════════════════════════════════════════════════

function updateSoundBtn() {
  const b = $('btn-sound');
  b.textContent = soundOn ? '🔊' : '🔈';
  b.title = 'Sound FX ' + (soundOn ? 'ON' : 'OFF');
}
updateSoundBtn();

$('btn-sound').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('soundOn', JSON.stringify(soundOn));
  updateSoundBtn();
  if (soundOn) sfxNotify();
});

// Lightweight click sfx on action buttons
document.addEventListener('click', (e) => {
  if (e.target.closest('.action-btn, .auth-btn, .tab-btn, .hdr-icon-btn')) sfxClick();
});

// ═══════════════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  else if (mod && e.key.toLowerCase() === 'm') { e.preventDefault(); openDMPanel(); }
  else if (mod && e.key === '/') { e.preventDefault(); alert('Commands:\n' + SLASH_CMDS.map(c => c.cmd + ' — ' + c.desc).join('\n')); }
  else if (e.key === 'Escape') {
    ['search-overlay','broadcast-modal','profile-modal','dm-panel','notif-panel','drop-modal','incident-overlay','broadcast-overlay']
      .forEach(id => $(id)?.classList.add('hidden'));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  LOGOUT
// ═══════════════════════════════════════════════════════════════════════════

function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('isAdmin');
  token = ''; username = ''; isAdmin = false;
  updateStatusBar(false);

  const lines = $('boot-seq-lines');
  const cursor = document.querySelector('.boot-cursor');
  if (lines) lines.innerHTML = '';
  if (cursor) cursor.style.display = '';
  const bsWrap = $('boot-sequence');
  const lfWrap = $('login-form-wrap');
  if (bsWrap) bsWrap.classList.remove('hidden');
  if (lfWrap) lfWrap.classList.add('hidden');

  showOverlay('password');
  runBoot();
}
$('btn-logout').addEventListener('click', logout);

// ═══════════════════════════════════════════════════════════════════════════
//  SERVICE WORKER
// ═══════════════════════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════

(async () => {
  if (token && username) {
    await loadConfig();
    initSocket();
    showApp();
    profileCache[username] = await fetchProfile(username) || profileCache[username];
    applyFactionChrome();
  } else if (token) {
    showOverlay('username');
  } else {
    showOverlay('password');
    runBoot();
  }
})();
