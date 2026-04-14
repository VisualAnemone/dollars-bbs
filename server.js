'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'dollars';

// ─── Database ────────────────────────────────────────────────────────────────

const db = new DatabaseSync(path.join(__dirname, 'dollars.db'));

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user      TEXT    NOT NULL,
    text      TEXT    NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    author     TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS replies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    author     TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const stmts = {
  insertMessage:  db.prepare('INSERT INTO messages (user, text) VALUES (?, ?)'),
  recentMessages: db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50'),
  allPosts:       db.prepare('SELECT * FROM posts ORDER BY created_at DESC'),
  insertPost:     db.prepare('INSERT INTO posts (title, author, content) VALUES (?, ?, ?)'),
  getPost:        db.prepare('SELECT * FROM posts WHERE id = ?'),
  getReplies:     db.prepare('SELECT * FROM replies WHERE post_id = ? ORDER BY created_at ASC'),
  insertReply:    db.prepare('INSERT INTO replies (post_id, author, content) VALUES (?, ?, ?)'),
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

const validTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (token && validTokens.has(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === SITE_PASSWORD) {
    const token = generateToken();
    validTokens.add(token);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.get('/api/posts', requireAuth, (_req, res) => {
  res.json(stmts.allPosts.all());
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { title, author, content } = req.body || {};
  if (!title || !author || !content) {
    return res.status(400).json({ error: 'title, author and content are required' });
  }
  const info = stmts.insertPost.run(title, author, content);
  const post = stmts.getPost.get(info.lastInsertRowid);
  io.to('bbs').emit('new_post', post);
  res.json(post);
});

app.get('/api/posts/:id', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  const replies = stmts.getReplies.all(post.id);
  res.json({ ...post, replies });
});

app.post('/api/posts/:id/reply', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  const { author, content } = req.body || {};
  if (!author || !content) {
    return res.status(400).json({ error: 'author and content are required' });
  }
  const info = stmts.insertReply.run(post.id, author, content);
  const reply = { id: info.lastInsertRowid, post_id: post.id, author, content, created_at: Math.floor(Date.now() / 1000) };
  io.to('bbs').emit('new_reply', { post_id: post.id, reply });
  res.json(reply);
});

// ─── HTTP + Socket.IO ─────────────────────────────────────────────────────────

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 }
});

// Socket auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token && validTokens.has(token)) return next();
  next(new Error('Unauthorized'));
});

io.on('connection', (socket) => {
  socket.join('bbs');

  // Send recent chat history to this client
  const history = stmts.recentMessages.all().reverse();
  socket.emit('history', history);

  socket.on('join', ({ username }) => {
    socket.username = username;
    socket.to('bbs').emit('user_joined', { username });
  });

  socket.on('chat_message', ({ text }) => {
    if (!socket.username || !text || typeof text !== 'string') return;
    const sanitized = text.trim().slice(0, 1000);
    if (!sanitized) return;
    stmts.insertMessage.run(socket.username, sanitized);
    const msg = {
      user: socket.username,
      text: sanitized,
      timestamp: Math.floor(Date.now() / 1000)
    };
    io.to('bbs').emit('message', msg);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      socket.to('bbs').emit('user_left', { username: socket.username });
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nDollars BBS is running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);

  // Print LAN addresses so other devices know the URL
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`  Network: http://${addr.address}:${PORT}`);
      }
    }
  }

  console.log(`\nPassword: ${SITE_PASSWORD}`);
  console.log('Share the Network URL with other devices on the same network.\n');
});
