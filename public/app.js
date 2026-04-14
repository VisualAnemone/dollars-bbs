'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let socket      = null;
let token       = localStorage.getItem('token')    || '';
let username    = localStorage.getItem('username') || '';
let currentRoom = 'main';
let currentBoard = 'main';
let currentPostId = null;

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function apiH() {
  return { 'Content-Type': 'application/json', 'x-auth-token': token };
}

function timeAgo(ts) {
  const sec = Math.floor(Date.now() / 1000) - (typeof ts === 'number' ? ts : Math.floor(new Date(ts).getTime() / 1000));
  if (sec < 60)    return sec + 's ago';
  if (sec < 3600)  return Math.floor(sec / 60) + ' min ago';
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

function scrollToBottom(el) {
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function tickClock() {
  const t = jstTime();
  $('stat-time').textContent = t;
  const at = $('about-time'); if (at) at.textContent = t.replace(/\s[AP]M/, '') + ' JST';
}
setInterval(tickClock, 1000);
tickClock();

// ── Auth overlays ─────────────────────────────────────────────────────────────
function showOverlay(name) {
  $('overlay-password').classList.toggle('hidden', name !== 'password');
  $('overlay-username').classList.toggle('hidden', name !== 'username');
  $('app').classList.add('hidden');
  if (name === 'password') setTimeout(() => $('input-password').focus(), 50);
  if (name === 'username') setTimeout(() => $('input-username').focus(), 50);
}

function showApp() {
  $('overlay-password').classList.add('hidden');
  $('overlay-username').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('display-username').textContent = username;
  $('chat-name-chip').textContent   = username;
  switchTab('chat');
}

$('form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('input-password').value;
  $('password-error').classList.add('hidden');
  try {
    const res  = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const data = await res.json();
    if (!res.ok) { $('password-error').classList.remove('hidden'); return; }
    token = data.token;
    localStorage.setItem('token', token);
    showOverlay('username');
  } catch {
    $('password-error').textContent = '// connection error';
    $('password-error').classList.remove('hidden');
  }
});

$('form-username').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = $('input-username').value.trim();
  if (!val) { $('username-error').classList.remove('hidden'); return; }
  $('username-error').classList.add('hidden');
  username = val;
  localStorage.setItem('username', username);
  initSocket();
  showApp();
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  if (socket) socket.disconnect();

  // No URL = uses window.location.origin automatically.
  // A device at http://192.168.x.x:3000 connects to THAT host, not localhost.
  // polling first = maximum browser/network compatibility (fixes Chrome issues)
  socket = io({
    auth: { token },
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    socket.emit('join', { username });
    socket.emit('join_room', { room: currentRoom });
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'Unauthorized') logout();
  });

  socket.on('room_history', ({ room, messages }) => {
    if (room !== currentRoom) return;
    const log = $('chat-log');
    log.innerHTML = '';
    messages.forEach(renderChatMsg);
    log.scrollTop = log.scrollHeight;
  });

  socket.on('message', (msg) => {
    if (msg.room !== currentRoom) return;
    renderChatMsg(msg);
    scrollToBottom($('chat-log'));
  });

  socket.on('user_joined', ({ username: u }) => {
    renderSysMsg(`${esc(u)} connected`);
  });

  socket.on('user_left', ({ username: u }) => {
    renderSysMsg(`${esc(u)} disconnected`);
  });

  socket.on('online_stats', ({ total, users }) => {
    $('stat-online').textContent = total;
    const ao = $('about-online'); if (ao) ao.textContent = total;
    const list = $('online-users-list');
    if (list) {
      list.innerHTML = (users || []).map(u => `<div class="online-user">${esc(u)}</div>`).join('');
    }
  });

  socket.on('room_counts', (counts) => {
    $('room-online-count').textContent = counts[currentRoom] || 0;
    // update dot activity based on count (any count means active)
    document.querySelectorAll('.room-item').forEach(btn => {
      const r = btn.dataset.room;
      btn.querySelector('.room-dot').classList.toggle('active', (counts[r] || 0) > 0);
    });
  });

  socket.on('new_post', (post) => {
    if (post.board === currentBoard) prependPostRow(post);
  });

  socket.on('new_reply', ({ post_id, reply }) => {
    if (post_id === currentPostId) appendReplyCard(reply);
  });
}

// ── Chat rendering ─────────────────────────────────────────────────────────────
function renderChatMsg(msg) {
  const log = $('chat-log');
  const d = document.createElement('div');
  d.className = 'chat-msg';
  const ts = `<span class="msg-ts">${jstFmt(msg.timestamp)}</span>`;
  d.innerHTML = `${ts}<span class="msg-name">${esc(msg.user)}</span><span>${esc(msg.text)}</span>`;
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

function jstFmt(ts) {
  const d = new Date((typeof ts === 'number' ? ts : Math.floor(new Date(ts).getTime()/1000)) * 1000);
  const jst = new Date(d.getTime() + 9*3600000);
  let h = jst.getUTCHours(), m = String(jst.getUTCMinutes()).padStart(2,'0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = String(h % 12 || 12).padStart(2,'0');
  return `${h}:${m}`;
}

$('form-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('chat-input');
  const text = inp.value.trim();
  if (!text || !socket) return;
  socket.emit('chat_message', { text });
  inp.value = '';
});

// ── Room switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.room-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.room;
    if (room === currentRoom) return;
    currentRoom = room;
    document.querySelectorAll('.room-item').forEach(b => b.classList.toggle('active', b.dataset.room === room));
    $('room-title-display').textContent = ROOMS[room]?.label || room;
    $('chat-log').innerHTML = '';
    socket?.emit('join_room', { room });
  });
});

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['chat','forum','about'].forEach(t => $('pane-' + t).classList.toggle('hidden', t !== name));
  if (name === 'forum') loadBoard(currentBoard);
}

document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

// ── Board switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.board-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const board = btn.dataset.board;
    document.querySelectorAll('.board-item').forEach(b => b.classList.toggle('active', b.dataset.board === board));
    currentBoard = board;
    loadBoard(board);
  });
});

// ── Forum: load post list ──────────────────────────────────────────────────────
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
  } catch { /* ignore */ }
}

function appendPostRow(container, post) {
  const row = document.createElement('div');
  row.className = 'post-row' + (post.pinned ? ' pinned' : '');
  row.dataset.postId = post.id;
  const pin = post.pinned ? '<span class="pin-icon">📌</span>' : '';
  row.innerHTML =
    `<div class="post-row-body">` +
      `<div class="post-row-title">${pin}${esc(post.title)}</div>` +
      `<div class="post-row-meta">by <strong>${esc(post.author)}</strong> &middot; ${timeAgo(post.created_at)}</div>` +
      `<div class="post-row-counts">` +
        `<span>💬 ${post.reply_count || 0}</span>` +
        `<span>👁 ${post.views || 0}</span>` +
      `</div>` +
    `</div>` +
    `<span class="post-arrow">&#x25B6;</span>`;
  row.addEventListener('click', () => openPost(post.id));
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

// ── Forum: new post ────────────────────────────────────────────────────────────
$('btn-new-post').addEventListener('click', () => {
  showForumView('newpost');
  $('new-post-title').focus();
});

$('btn-cancel-post').addEventListener('click', () => showForumView('list'));

$('form-new-post').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title   = $('new-post-title').value.trim();
  const content = $('new-post-content').value.trim();
  if (!title || !content) return;
  const res = await fetch('/api/posts', {
    method: 'POST', headers: apiH(),
    body: JSON.stringify({ board: currentBoard, title, author: username, content }),
  });
  if (!res.ok) return;
  $('new-post-title').value = '';
  $('new-post-content').value = '';
  showForumView('list');
  loadBoard(currentBoard);
});

// ── Forum: post detail ─────────────────────────────────────────────────────────
async function openPost(id) {
  currentPostId = id;
  showForumView('detail');
  const res = await fetch(`/api/posts/${id}`, { headers: apiH() });
  if (!res.ok) return;
  const post = await res.json();

  $('post-detail-body').innerHTML =
    `<div class="detail-title">${esc(post.title)}</div>` +
    `<div class="detail-meta">by <strong>${esc(post.author)}</strong> &middot; ${fmtDate(post.created_at)} &middot; ${post.views || 0} views</div>` +
    `<div class="detail-body">${esc(post.content)}</div>`;

  const replies = $('post-replies');
  replies.innerHTML = '';
  (post.replies || []).forEach(appendReplyCard);
  $('reply-content').focus();
}

function appendReplyCard(reply) {
  const card = document.createElement('div');
  card.className = 'reply-card';
  card.innerHTML =
    `<div class="reply-author"><strong>${esc(reply.author)}</strong> &middot; ${fmtDate(reply.created_at)}</div>` +
    `<div class="reply-body">${esc(reply.content)}</div>`;
  $('post-replies').appendChild(card);
}

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

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  token = ''; username = '';
  showOverlay('password');
}

$('btn-logout').addEventListener('click', logout);

// ── Init ──────────────────────────────────────────────────────────────────────
if (token && username) {
  initSocket();
  showApp();
} else if (token) {
  showOverlay('username');
} else {
  showOverlay('password');
}
