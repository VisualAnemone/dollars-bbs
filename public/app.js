'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let socket = null;
let token    = localStorage.getItem('token')    || '';
let username = localStorage.getItem('username') || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(id)  { document.getElementById(id).classList.remove('hidden'); }
function hide(id)  { document.getElementById(id).classList.add('hidden');    }

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'x-auth-token': token };
}

function formatTime(ts) {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Views ─────────────────────────────────────────────────────────────────────
function showPasswordView()  {
  hide('view-main'); hide('view-username');
  show('view-password');
  document.getElementById('input-password').focus();
}

function showUsernameView()  {
  hide('view-main'); hide('view-password');
  show('view-username');
  document.getElementById('input-username').focus();
}

function showMainView() {
  hide('view-password'); hide('view-username');
  show('view-main');
  switchTab('chat');
}

// ── Password screen ───────────────────────────────────────────────────────────
document.getElementById('form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('input-password').value;
  const err = document.getElementById('password-error');
  hide('password-error');

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (!res.ok) { show('password-error'); return; }
    token = data.token;
    localStorage.setItem('token', token);
    showUsernameView();
  } catch {
    err.textContent = 'Connection error.';
    show('password-error');
  }
});

// ── Username screen ───────────────────────────────────────────────────────────
document.getElementById('form-username').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('input-username').value.trim();
  if (!val) { show('username-error'); return; }
  hide('username-error');
  username = val;
  localStorage.setItem('username', username);
  initSocket();
  showMainView();
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  if (socket) socket.disconnect();

  // io() with no URL automatically connects to window.location.origin.
  // This is the critical cross-device fix: when a device on the network
  // opens http://192.168.1.5:3000, it connects to THAT host, not localhost.
  socket = io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  });

  socket.on('connect', () => {
    socket.emit('join', { username });
  });

  socket.on('connect_error', (err) => {
    if (err.message === 'Unauthorized') {
      logout();
    }
  });

  socket.on('history', (messages) => {
    const log = document.getElementById('chat-log');
    log.innerHTML = '';
    messages.forEach(appendChatMessage);
    log.scrollTop = log.scrollHeight;
  });

  socket.on('message', appendChatMessage);

  socket.on('user_joined', ({ username: u }) => {
    appendSystemMessage(`${escapeHtml(u)} joined`);
  });

  socket.on('user_left', ({ username: u }) => {
    appendSystemMessage(`${escapeHtml(u)} left`);
  });

  socket.on('new_post', (post) => {
    prependPostCard(post);
  });

  socket.on('new_reply', ({ post_id, reply }) => {
    // If currently viewing that post, append the reply live
    if (currentPostId === post_id) {
      appendReply(reply);
    }
  });
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function appendChatMessage(msg) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML =
    `<span class="msg-user">[${escapeHtml(msg.user)}]</span>` +
    `<span class="msg-text">${escapeHtml(msg.text)}</span>`;
  log.appendChild(div);
  // Auto-scroll only if already near the bottom
  if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) {
    log.scrollTop = log.scrollHeight;
  }
}

function appendSystemMessage(html) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = '— ' + html + ' —';
  log.appendChild(div);
  if (log.scrollHeight - log.scrollTop - log.clientHeight < 120) {
    log.scrollTop = log.scrollHeight;
  }
}

document.getElementById('form-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !socket) return;
  socket.emit('chat_message', { text });
  input.value = '';
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  show('tab-' + name);
  if (name === 'board') loadPostList();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Board: post list ──────────────────────────────────────────────────────────
async function loadPostList() {
  showBoardView('list');
  try {
    const res = await fetch('/api/posts', { headers: apiHeaders() });
    if (!res.ok) return;
    const posts = await res.json();
    const list = document.getElementById('post-list');
    list.innerHTML = '';
    if (posts.length === 0) {
      list.innerHTML = '<p style="color:var(--muted);padding:.5rem 0">No posts yet. Be the first.</p>';
      return;
    }
    posts.forEach(prependPostCard);
  } catch { /* ignore */ }
}

function prependPostCard(post) {
  const list = document.getElementById('post-list');
  // Remove "no posts" placeholder if present
  const placeholder = list.querySelector('p');
  if (placeholder) placeholder.remove();

  // Avoid duplicate if already exists
  if (document.querySelector(`[data-post-id="${post.id}"]`)) return;

  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.postId = post.id;
  card.innerHTML =
    `<div class="post-title">${escapeHtml(post.title)}</div>` +
    `<div class="post-meta">${escapeHtml(post.author)} &middot; ${formatDate(post.created_at)}</div>`;
  card.addEventListener('click', () => openPost(post.id));
  list.prepend(card);
}

// ── Board: new post ───────────────────────────────────────────────────────────
document.getElementById('btn-new-post').addEventListener('click', () => {
  showBoardView('new-post');
  document.getElementById('post-title').focus();
});

document.getElementById('btn-cancel-post').addEventListener('click', () => {
  showBoardView('list');
});

document.getElementById('form-new-post').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title   = document.getElementById('post-title').value.trim();
  const content = document.getElementById('post-content').value.trim();
  if (!title || !content) return;

  const res = await fetch('/api/posts', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ title, author: username, content })
  });
  if (!res.ok) return;
  document.getElementById('post-title').value = '';
  document.getElementById('post-content').value = '';
  showBoardView('list');
  loadPostList();
});

// ── Board: post detail ────────────────────────────────────────────────────────
let currentPostId = null;

async function openPost(id) {
  currentPostId = id;
  showBoardView('post-detail');

  const res = await fetch(`/api/posts/${id}`, { headers: apiHeaders() });
  if (!res.ok) return;
  const post = await res.json();

  document.getElementById('post-detail-content').innerHTML =
    `<div class="detail-title">${escapeHtml(post.title)}</div>` +
    `<div class="detail-meta">${escapeHtml(post.author)} &middot; ${formatDate(post.created_at)}</div>` +
    `<div class="detail-body">${escapeHtml(post.content)}</div>`;

  const repliesEl = document.getElementById('replies-list');
  repliesEl.innerHTML = '';
  post.replies.forEach(appendReply);

  document.getElementById('reply-content').focus();
}

function appendReply(reply) {
  const el = document.createElement('div');
  el.className = 'reply-card';
  el.innerHTML =
    `<div class="reply-author">${escapeHtml(reply.author)} &middot; ${formatDate(reply.created_at)}</div>` +
    `<div class="reply-body">${escapeHtml(reply.content)}</div>`;
  document.getElementById('replies-list').appendChild(el);
}

document.getElementById('btn-back-to-list').addEventListener('click', () => {
  currentPostId = null;
  loadPostList();
});

document.getElementById('form-reply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = document.getElementById('reply-content').value.trim();
  if (!content || !currentPostId) return;

  const res = await fetch(`/api/posts/${currentPostId}/reply`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ author: username, content })
  });
  if (!res.ok) return;
  document.getElementById('reply-content').value = '';
});

function showBoardView(name) {
  hide('board-list-view');
  hide('board-new-post');
  hide('board-post-detail');
  show('board-' + name);
}

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  if (socket) { socket.disconnect(); socket = null; }
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  token = ''; username = '';
  showPasswordView();
}

document.getElementById('btn-logout').addEventListener('click', logout);

// ── Init: restore session if already logged in ────────────────────────────────
if (token && username) {
  initSocket();
  showMainView();
} else if (token) {
  showUsernameView();
} else {
  showPasswordView();
}
