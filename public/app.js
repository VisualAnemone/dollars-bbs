'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let socket       = null;
let token        = localStorage.getItem('token')    || '';
let username     = localStorage.getItem('username') || '';
let isAdmin      = JSON.parse(localStorage.getItem('isAdmin') || 'false');
let currentRoom  = 'main';
let currentBoard = 'main';
let currentPostId = null;

// Unread / notification state
let unreadRooms  = new Set();
let unreadCount  = 0;

// Typing state
let typingUsers   = {};  // username -> clearTimeout handle
let isTyping      = false;
let typingTimeout = null;

// Broadcast timer
let broadcastTimer = null;

// Search debounce
let searchDebounce = null;

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

const EMOJIS = ['👍', '❤️', '🔥', '👀', '✅'];

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

// ── Clock ─────────────────────────────────────────────────────────────────────
function tickClock() {
  const t  = jstTime();
  $('stat-time').textContent = t;
  const at = $('about-time'); if (at) at.textContent = t.replace(/\s[AP]M/, '') + ' JST';
}
setInterval(tickClock, 1000);
tickClock();

// ── Unread tracking ───────────────────────────────────────────────────────────
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
  unreadCount = unreadRooms.size;
  document.title = unreadCount > 0 ? `(${unreadCount}) Dollars BBS` : 'Dollars BBS';
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateTitleBadge();
});

// ── Boot sequence ─────────────────────────────────────────────────────────────
const BOOT_LINES = [
  { text: '> DOLLARS BBS NODE v2.1 — IKEBUKURO RELAY', status: null },
  { text: '> LOADING SYSTEM KERNEL',                    status: 'ok'  },
  { text: '> MOUNTING ENCRYPTED FILESYSTEM',            status: 'ok'  },
  { text: '> TOR RELAY: JP ──► NL ──► US ──► JP',       status: 'ok'  },
  { text: '> HANDSHAKE: SHA-384 VERIFIED',              status: 'ok'  },
  { text: '> MEMBER DATABASE: 12,847 RECORDS',          status: null  },
  { text: '> SCANNING FOR INTRUSION ATTEMPTS',          status: 'ok'  },
  { text: '> ANONYMITY LAYER: ACTIVE',                  status: 'ok'  },
  { text: '> AWAITING AUTHENTICATION',                  status: null  },
];

let bootDone = false;

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
      const speed = line.status === 'ok' ? 18 : 28;
      const iv = setInterval(() => {
        div.textContent = line.text.slice(0, ++i);
        if (i >= line.text.length) {
          clearInterval(iv);
          setTimeout(resolve, line.status ? 80 : 160);
        }
      }, speed);
    });
  }

  await new Promise(r => setTimeout(r, 350));
  if (cursor) cursor.style.display = 'none';
  $('boot-sequence').classList.add('hidden');
  $('login-form-wrap').classList.remove('hidden');
  setTimeout(() => $('input-password').focus(), 50);
  bootDone = true;
}

// ── Status bar ────────────────────────────────────────────────────────────────
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

// ── Auth overlays ─────────────────────────────────────────────────────────────
function showOverlay(name) {
  $('overlay-password').classList.toggle('hidden', name !== 'password');
  $('overlay-username').classList.toggle('hidden', name !== 'username');
  $('app').classList.add('hidden');
  if (name === 'username') setTimeout(() => $('input-username').focus(), 50);
  // Password overlay: boot sequence handles the focus after it finishes
}

function showApp() {
  $('overlay-password').classList.add('hidden');
  $('overlay-username').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('display-username').textContent = username;
  $('chat-name-chip').textContent   = username;
  if (isAdmin) {
    $('admin-badge').classList.remove('hidden');
  }
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
    updateStatusBar(true);
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
    totalMsgs++;
    const sbm = $('sb-msgs');
    if (sbm) sbm.textContent = totalMsgs;

    if (msg.room !== currentRoom) {
      markUnread(msg.room);
      return;
    }
    renderChatMsg(msg);
    scrollToBottom($('chat-log'));
  });

  socket.on('user_joined', ({ username: u }) => {
    renderSysMsg(`${esc(u)} connected`);
  });

  socket.on('user_left', ({ username: u }) => {
    renderSysMsg(`${esc(u)} disconnected`);
  });

  socket.on('user_typing', ({ username: u }) => {
    showTypingUser(u);
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
    document.querySelectorAll('.room-item').forEach(btn => {
      const r = btn.dataset.room;
      const dot = btn.querySelector('.room-dot');
      if (dot && !dot.classList.contains('unread')) {
        dot.classList.toggle('active', (counts[r] || 0) > 0);
      }
    });
  });

  socket.on('new_post', (post) => {
    if (post.board === currentBoard) prependPostRow(post);
  });

  socket.on('new_reply', ({ post_id, reply }) => {
    if (post_id === currentPostId) appendReplyCard(reply);
  });

  socket.on('post_reacted', ({ post_id, reactions }) => {
    if (post_id === currentPostId) renderReactions(reactions);
  });

  socket.on('post_deleted', ({ id }) => {
    const row = document.querySelector(`[data-post-id="${id}"]`);
    if (row) row.remove();
    if (currentPostId === id) { currentPostId = null; showForumView('list'); loadBoard(currentBoard); }
  });

  socket.on('post_pinned', ({ id, pinned }) => {
    // Reload board to re-sort pinned posts
    if ($('forum-view-list') && !$('forum-view-list').classList.contains('hidden')) {
      loadBoard(currentBoard);
    }
  });

  socket.on('reply_deleted', ({ id }) => {
    const card = document.querySelector(`[data-reply-id="${id}"]`);
    if (card) card.remove();
  });

  socket.on('new_sighting', (sighting) => {
    prependSightingCard(sighting);
  });

  socket.on('broadcast', ({ text, from }) => {
    showBroadcastOverlay(text, from);
  });
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function showTypingUser(u) {
  if (typingUsers[u]) clearTimeout(typingUsers[u]);
  typingUsers[u] = setTimeout(() => {
    delete typingUsers[u];
    updateTypingDisplay();
  }, 3000);
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

$('chat-input').addEventListener('keydown', () => {
  if (!socket) return;
  if (!isTyping) { socket.emit('typing'); isTyping = true; }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { isTyping = false; }, 2500);
});

// ── Chat rendering ─────────────────────────────────────────────────────────────
function renderChatMsg(msg) {
  const log = $('chat-log');
  const d   = document.createElement('div');
  d.className = 'chat-msg';
  const ts = `<span class="msg-ts">${jstFmt(msg.timestamp)}</span>`;
  d.innerHTML = `${ts}<span class="msg-name">${esc(msg.user)}</span><span>${esc(msg.text)}</span>`;
  log.appendChild(d);
}

function renderSysMsg(text) {
  const log = $('chat-log');
  const d   = document.createElement('div');
  d.className = 'chat-msg system';
  d.textContent = '— ' + text + ' —';
  log.appendChild(d);
  scrollToBottom(log);
}

$('form-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp  = $('chat-input');
  const text = inp.value.trim();
  if (!text || !socket) return;
  socket.emit('chat_message', { text });
  inp.value = '';
  isTyping  = false;
});

// ── Scroll-to-bottom button ───────────────────────────────────────────────────
const chatLog = $('chat-log');
chatLog.addEventListener('scroll', () => {
  const dist = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight;
  $('scroll-to-bottom').classList.toggle('hidden', dist < 200);
});

$('scroll-to-bottom').addEventListener('click', () => {
  chatLog.scrollTop = chatLog.scrollHeight;
  $('scroll-to-bottom').classList.add('hidden');
});

// ── Room switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.room-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.room;
    if (room === currentRoom) return;
    clearUnread(room);
    currentRoom = room;
    document.querySelectorAll('.room-item').forEach(b => b.classList.toggle('active', b.dataset.room === room));
    $('room-title-display').textContent = ROOMS[room]?.label || room;
    $('chat-log').innerHTML = '';
    // Clear typing state
    typingUsers = {};
    updateTypingDisplay();
    socket?.emit('join_room', { room });
    // Close mobile sidebar
    $('chat-sidebar')?.classList.remove('open');
  });
});

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────
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

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['chat','forum','sightings','about'].forEach(t => $('pane-' + t).classList.toggle('hidden', t !== name));
  if (name === 'forum')    loadBoard(currentBoard);
  if (name === 'sightings') loadSightings();
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
    const res   = await fetch(`/api/posts?board=${encodeURIComponent(board)}`, { headers: apiH() });
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
  row.dataset.pinned = post.pinned ? '1' : '0';

  const pin = post.pinned ? '<span class="pin-icon">📌</span>' : '';

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
      `<div class="post-row-title">${pin}${esc(post.title)}</div>` +
      `<div class="post-row-meta">by <strong>${esc(post.author)}</strong> &middot; ${timeAgo(post.created_at)}</div>` +
      `<div class="post-row-counts">` +
        `<span>💬 ${post.reply_count || 0}</span>` +
        `<span>👁 ${post.views || 0}</span>` +
      `</div>` +
    `</div>` +
    adminHtml +
    `<span class="post-arrow">&#x25B6;</span>`;

  if (isAdmin) {
    row.querySelector('.pin-btn').addEventListener('click', async (e) => {
      const id     = Number(e.currentTarget.dataset.id);
      const pinned = e.currentTarget.dataset.pinned === '1';
      await fetch(`/api/posts/${id}/pin`, {
        method: 'PATCH', headers: apiH(),
        body: JSON.stringify({ pinned: !pinned }),
      });
    });
    row.querySelector('.del-btn').addEventListener('click', async (e) => {
      const id = Number(e.currentTarget.dataset.id);
      if (!confirm('Delete this post and all its replies?')) return;
      await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: apiH() });
    });
  }

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
  $('new-post-title').value   = '';
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

  let adminDetailHtml = '';
  if (isAdmin) {
    adminDetailHtml =
      `<button class="admin-btn del-btn" style="float:right;margin-left:.5rem" onclick="adminDeletePost(${post.id})">🗑 delete post</button>`;
  }

  $('post-detail-body').innerHTML =
    `<div class="detail-title">${adminDetailHtml}${esc(post.title)}</div>` +
    `<div class="detail-meta">by <strong>${esc(post.author)}</strong> &middot; ${fmtDate(post.created_at)} &middot; ${post.views || 0} views</div>` +
    `<div class="detail-body">${esc(post.content)}</div>`;

  renderReactions(post.reactions || []);

  const replies = $('post-replies');
  replies.innerHTML = '';
  (post.replies || []).forEach(appendReplyCard);
  $('reply-content').focus();
}

function appendReplyCard(reply) {
  const card = document.createElement('div');
  card.className = 'reply-card';
  card.dataset.replyId = reply.id;

  let adminCtrl = '';
  if (isAdmin) {
    adminCtrl = `<button class="reply-admin-ctrl" data-id="${reply.id}" title="Delete reply">🗑</button>`;
  }

  card.innerHTML =
    `<div class="reply-author">${adminCtrl}<strong>${esc(reply.author)}</strong> &middot; ${fmtDate(reply.created_at)}</div>` +
    `<div class="reply-body">${esc(reply.content)}</div>`;

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

async function adminDeletePost(id) {
  if (!confirm('Delete this post and all its replies?')) return;
  await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: apiH() });
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

// ── Reactions ─────────────────────────────────────────────────────────────────
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
      const res   = await fetch(`/api/posts/${currentPostId}/react`, {
        method: 'POST', headers: apiH(),
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        renderReactions(data.reactions);
      }
    });
  });
}

// ── Search ─────────────────────────────────────────────────────────────────────
$('btn-search').addEventListener('click', () => {
  $('search-overlay').classList.remove('hidden');
  setTimeout(() => $('search-input').focus(), 50);
});

$('btn-close-search').addEventListener('click', closeSearch);

$('search-overlay').addEventListener('click', (e) => {
  if (e.target === $('search-overlay')) closeSearch();
});

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
  const q       = $('search-input').value.trim();
  const results = $('search-results');
  if (!q) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="search-loading">searching...</div>';
  try {
    const res   = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: apiH() });
    const posts = await res.json();
    if (!posts.length) {
      results.innerHTML = '<div class="search-empty">no results found</div>';
      return;
    }
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

// ── Broadcast (compose + send) ────────────────────────────────────────────────
$('btn-broadcast').addEventListener('click', () => {
  const last     = parseInt(localStorage.getItem('lastBroadcast') || '0');
  const elapsed  = Date.now() - last;
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

$('btn-cancel-broadcast').addEventListener('click', () => {
  $('broadcast-modal').classList.add('hidden');
});

$('broadcast-modal').addEventListener('click', (e) => {
  if (e.target === $('broadcast-modal')) $('broadcast-modal').classList.add('hidden');
});

$('btn-send-broadcast').addEventListener('click', () => {
  const text = $('broadcast-input').value.trim();
  if (!text || !socket) return;
  socket.emit('broadcast', { text });
  localStorage.setItem('lastBroadcast', Date.now().toString());
  $('broadcast-modal').classList.add('hidden');
});

// ── Broadcast (receive overlay) ───────────────────────────────────────────────
function showBroadcastOverlay(text, from) {
  $('broadcast-text').textContent = text;
  $('broadcast-from').textContent = from ? `from: ${from}` : '';
  $('broadcast-overlay').classList.remove('hidden');

  // Animate progress bar draining over 8s
  const bar = $('broadcast-progress');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  bar.getBoundingClientRect(); // force reflow
  bar.style.transition = 'width 8s linear';
  bar.style.width = '0%';

  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    $('broadcast-overlay').classList.add('hidden');
    broadcastTimer = null;
  }, 8000);
}

$('btn-dismiss-broadcast').addEventListener('click', () => {
  if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = null; }
  $('broadcast-overlay').classList.add('hidden');
});

// ── Sightings ─────────────────────────────────────────────────────────────────
async function loadSightings() {
  const list = $('sightings-list');
  list.innerHTML = '<div class="sightings-loading">loading...</div>';
  try {
    const res      = await fetch('/api/sightings', { headers: apiH() });
    const sightings = await res.json();
    list.innerHTML = '';
    if (!sightings.length) {
      list.innerHTML = '<div class="sightings-empty">no sightings yet. be the first to report.</div>';
      return;
    }
    sightings.forEach(s => appendSightingCard(s));
  } catch {
    list.innerHTML = '<div class="sightings-empty">// failed to load sightings</div>';
  }
}

function appendSightingCard(s) {
  $('sightings-list').appendChild(buildSightingCard(s));
}

function prependSightingCard(s) {
  const list  = $('sightings-list');
  const empty = list.querySelector('.sightings-empty');
  if (empty) empty.remove();
  list.prepend(buildSightingCard(s));
}

function buildSightingCard(s) {
  const card  = document.createElement('div');
  card.className = 'sighting-card';
  card.dataset.sightingId = s.id;

  const now     = Math.floor(Date.now() / 1000);
  const total   = 86400;
  const remaining = Math.max(0, s.expires_at - now);
  const pct     = Math.round((remaining / total) * 100);

  card.innerHTML =
    `<div class="sighting-header">` +
      `<span class="sighting-user">${esc(s.user)}</span>` +
      `<span class="sighting-time">${timeAgo(s.created_at)}</span>` +
    `</div>` +
    `<div class="sighting-text">${esc(s.text)}</div>` +
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
  const res = await fetch('/api/sightings', {
    method: 'POST', headers: apiH(),
    body: JSON.stringify({ user: username, text }),
  });
  if (res.ok) {
    $('sighting-input').value = '';
    $('sightings-compose').classList.add('hidden');
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('isAdmin');
  token = ''; username = ''; isAdmin = false;
  updateStatusBar(false);

  // Reset boot sequence for re-display
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

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────────────────
if (token && username) {
  initSocket();
  showApp();
} else if (token) {
  showOverlay('username');
} else {
  // Show password overlay with boot sequence animation
  showOverlay('password');
  runBoot();
}
