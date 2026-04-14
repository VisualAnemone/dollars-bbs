'use strict';

const express = require('express');
const http    = require('http');
const { Server }       = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const PORT          = process.env.PORT          || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'dollars';

// ─── Database ─────────────────────────────────────────────────────────────────

const db = new DatabaseSync(path.join(__dirname, 'dollars.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    room      TEXT    NOT NULL DEFAULT 'main',
    user      TEXT    NOT NULL,
    text      TEXT    NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board      TEXT    NOT NULL DEFAULT 'main',
    title      TEXT    NOT NULL,
    author     TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    views      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS replies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    author     TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Schema migrations — safe to run on existing installs
for (const sql of [
  "ALTER TABLE messages ADD COLUMN room TEXT NOT NULL DEFAULT 'main'",
  "ALTER TABLE posts ADD COLUMN board  TEXT NOT NULL DEFAULT 'main'",
  "ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN views  INTEGER NOT NULL DEFAULT 0",
]) { try { db.exec(sql); } catch { /* column already exists */ } }

// ─── Seed ─────────────────────────────────────────────────────────────────────

if (!db.prepare("SELECT value FROM _meta WHERE key='seeded'").get()) {
  const S = Math.floor(Date.now() / 1000);
  const ago = s => S - s;
  const H = 3600, M = 60, D = 86400;

  const iM = db.prepare('INSERT INTO messages (room,user,text,timestamp) VALUES (?,?,?,?)');
  const iP = db.prepare('INSERT INTO posts (board,title,author,content,pinned,views,created_at) VALUES (?,?,?,?,?,?,?)');
  const iR = db.prepare('INSERT INTO replies (post_id,author,content,created_at) VALUES (?,?,?,?)');

  // Chat rooms
  [
    ['main','Mikado_99',   'is anyone online right now?',                            ago(3*H+15*M)],
    ['main','Kida_M',      'always! what\'s up?',                                    ago(3*H+12*M)],
    ['main','Anri_S',      'something strange happened near Sunshine 60 tonight',    ago(2*H+45*M)],
    ['main','Mikado_99',   'yeah the Black Rider was spotted again',                 ago(2*H+40*M)],
    ['main','UrbanExplorer','I saw her. completely silent, no visible rider',        ago(2*H+20*M)],
    ['main','Philosopher_X','interesting. what do you think she actually is?',       ago(1*H+50*M)],
    ['main','NightOwl_22', 'probably urban legend tbh',                              ago(1*H+15*M)],
    ['main','CeltyHunter', 'she\'s REAL. I have photos',                             ago(45*M)],
    ['main','Kida_M',      'lol sure you do buddy',                                  ago(40*M)],
    ['main','SpeedFreak',  'saw her doing 200kph on the highway. absolutely insane', ago(20*M)],
  ].forEach(r => iM.run(...r));

  [
    ['ikebukuro','UrbanExplorer','anyone near east exit right now?',                        ago(4*H+5*M)],
    ['ikebukuro','Tanaka_M',     'I\'m around, what\'s going on?',                          ago(4*H+2*M)],
    ['ikebukuro','UrbanExplorer','weird group blocking the alley behind Animate',           ago(3*H+45*M)],
    ['ikebukuro','Tanaka_M',     'yellow scarves?',                                         ago(3*H+42*M)],
    ['ikebukuro','UrbanExplorer','didn\'t get a good look. just felt off',                  ago(3*H+38*M)],
    ['ikebukuro','LocalGhost',   'ikebukuro feels different lately. hard to explain',       ago(2*H+10*M)],
    ['ikebukuro','Tanaka_M',     'agreed. something is definitely shifting',                ago(1*H+45*M)],
    ['ikebukuro','IzayaWatcher', 'be careful. certain people are always watching',          ago(55*M)],
  ].forEach(r => iM.run(...r));

  [
    ['missions','KittyLover99',   'LOST CAT: orange tabby near Sunshine 60, anyone seen her?', ago(D+2*H)],
    ['missions','HelpBot',        'post a photo if you can! we\'ll keep an eye out',            ago(D+1*H+55*M)],
    ['missions','KittyLover99',   'her name is Mikan, super friendly, blue collar with a bell', ago(D+1*H+30*M)],
    ['missions','Tanaka_M',       'I think I\'ve seen this cat. will keep looking',             ago(D+50*M)],
    ['missions','GoodSamaritan',  'leaving food near east exit just in case',                   ago(D+20*M)],
  ].forEach(r => iM.run(...r));

  [
    ['nightshift','NightOwl_22',  '3am and still awake as usual',                               ago(8*H)],
    ['nightshift','Insomniac_D',  'same. ikebukuro is weirdly peaceful right now',              ago(7*H+55*M)],
    ['nightshift','NightOwl_22',  'except for the motorcycle lol',                              ago(7*H+30*M)],
    ['nightshift','Insomniac_D',  'lol ALWAYS her',                                             ago(7*H+25*M)],
    ['nightshift','GhostHours',   'I genuinely love these late night convos',                   ago(6*H+10*M)],
    ['nightshift','NightOwl_22',  'me too. different city at night',                            ago(5*H+45*M)],
    ['nightshift','Insomniac_D',  'less chaos, more mystery',                                   ago(5*H+30*M)],
  ].forEach(r => iM.run(...r));

  // Posts
  const p1 = iP.run('main','Welcome to the Dollars — READ FIRST','Admin',
    'Welcome to the Dollars BBS.\n\nWe are everyone and no one. There are no rules here except one: do not cause trouble in the name of the Dollars.\n\nPost freely. Help each other. Share what you know. And remember — we are colorless. We have no face, no banner, no hierarchy. Just people.\n\nIf you were invited here, you are already one of us.\n\n— Admin',
    1,34231,ago(90*D));

  const p2 = iP.run('main','The Black Rider spotted near Sunshine 60 Street','UrbanExplorer',
    'Saw something incredible tonight around 11pm near Sunshine 60.\n\nA black motorcycle, completely silent, moving through the crowd like it wasn\'t even there. The rider was dressed head to toe in black — but the head... I couldn\'t make it out. Just a smooth dark shape where a helmet should be.\n\nI followed on foot for half a block before it disappeared down a side street at impossible speed.\n\nAnyone else see this? I\'m not crazy.',
    0,456,ago(23*M));

  const p3 = iP.run('main','What does being a Dollar mean to you?','Philosopher_X',
    'I\'ve been thinking about this a lot lately.\n\nWe joined this group with no face, no color, no leader. We are nothing and everything simultaneously. But as time passes, I find myself asking — what does it actually MEAN to be a Dollar?\n\nIs it freedom? The ability to act without being labeled?\nIs it anonymity? The comfort of the faceless crowd?\nOr is it something more — a genuine desire to connect without the weight of identity?\n\nI\'d love to hear what brought you here, and what keeps you coming back.',
    0,1023,ago(H+15*M));

  const p4 = iP.run('main','Strange happenings in Ikebukuro lately...','NightOwl_22',
    'Has anyone else noticed the atmosphere in Ikebukuro changing?\n\nMore gang activity near the east exit. Weird gatherings that dissolve before you can get close. The Black Rider appearing more frequently. There\'s a feeling — like something is building, like a storm before it breaks.\n\nI\'ve lived here 6 years and it\'s never felt quite like this. Stay aware.',
    0,892,ago(2*H+5*M));

  const p5 = iP.run('news','Mission board is now active — submit your requests','Admin',
    'The Dollars mission board is now live.\n\nIf you need help with something — moving furniture, finding lost items, walking someone home safely, anything — post it in the Missions board. The Dollars are here to help each other, no questions asked.\n\nThis is what we\'re about.\n\n— Admin',
    1,8921,ago(7*D));

  const p6 = iP.run('news','Celty spotted on the Ring Road — photos inside','SpeedFreak',
    'Managed to pull alongside her for about 30 seconds on the ring road heading north. I was running 160kph and she pulled away like I was parked.\n\nCompletely silent. No exhaust, nothing. Just wind.\n\nPosted blurry photos in replies — you can make out the silhouette. That bike is unlike anything in production.',
    0,4521,ago(D+3*H));

  const p7 = iP.run('missions','Lost: orange tabby cat near east Ikebukuro','KittyLover99',
    'My cat Mikan escaped yesterday near the east exit of Ikebukuro station. She\'s an orange tabby, very friendly, wearing a blue collar with a small bell.\n\nShe responds to her name and will come to you if you crouch. Please don\'t chase her — she spooks easily.\n\nIf you see her, message me immediately. Any help means everything.',
    0,234,ago(D+2*H));

  const p8 = iP.run('missions','Need help moving Saturday morning — ramen provided','Tanaka_M',
    'Moving to a new apartment this Saturday around 9am.\n\nJust a few boxes, a bookshelf, and a TV unit. Should take 2–3 hours max. The new place is about 10 minutes away on foot.\n\nHappy to buy ramen for everyone who helps. Message me if you\'re free!',
    0,89,ago(2*D+5*H));

  const p9 = iP.run('offtopic','Best ramen in Ikebukuro — my definitive ranking','FoodieRyuu',
    'Six months. Every ramen shop in Ikebukuro. Here are my findings:\n\n1. The unmarked shop near west exit — no sign, follow the smoke. Shoyu broth. Life-changing.\n2. Haruto\'s basement place — spicy miso, incredible chashu. Gets crowded after 9pm.\n3. The 24hr spot near Sunshine — solid, consistent, always there when you need it.\n4. The chain place near the station — fine, whatever.\n\nFeel free to argue.',
    0,2341,ago(3*D+4*H));

  const p10 = iP.run('offtopic','Anyone else collecting urban legends about this city?','CuriousOne',
    'I\'ve been quietly documenting the weird things in Ikebukuro:\n\n— The headless rider on the black motorcycle\n— An information broker who sits on vending machines and seems to know everything about everyone\n— A bartender who never seems to age\n— Groups of kids who move through the city like they own it, faces hidden\n\nStarting to think this city has several layers most people never see.',
    0,1203,ago(4*D));

  // Replies
  iR.run(p1.lastInsertRowid,'Mikado_99',  'Thank you. This place already means a lot.',           ago(89*D));
  iR.run(p1.lastInsertRowid,'Kida_M',     'Colorless suits me. Colors cause too many problems.',   ago(88*D));
  iR.run(p1.lastInsertRowid,'Anri_S',     'I found this place by accident. Glad I did.',           ago(85*D));

  iR.run(p2.lastInsertRowid,'Kida_M',       'I\'ve seen her too. She\'s real. Don\'t follow her.', ago(20*M));
  iR.run(p2.lastInsertRowid,'CeltyHunter',  'She\'s been spotted way more the past two weeks. Something is going on.', ago(15*M));
  iR.run(p2.lastInsertRowid,'Philosopher_X','Or perhaps something about her has changed.',          ago(8*M));

  iR.run(p3.lastInsertRowid,'Anri_S',      'For me it\'s anonymity. I can be honest here in ways I can\'t offline.',  ago(H+5*M));
  iR.run(p3.lastInsertRowid,'Mikado_99',   'Same. Something freeing about being unknown.',          ago(H));
  iR.run(p3.lastInsertRowid,'IzayaWatcher','Careful. Anonymity has a price. Some people collect identities.', ago(50*M));

  iR.run(p6.lastInsertRowid,'SpeedFreak',    '[blurry photo] that silhouette is wrong for any production bike', ago(D+2*H+45*M));
  iR.run(p6.lastInsertRowid,'UrbanExplorer', 'That\'s exactly what I saw. No visible head.',        ago(D+H+30*M));

  iR.run(p9.lastInsertRowid,'Tanaka_M',   'Hard agree on the west exit place. Been going there for years.',    ago(3*D+3*H));
  iR.run(p9.lastInsertRowid,'NightOwl_22','The 24hr spot has saved my life more times than I can count.',      ago(3*D+2*H));

  iR.run(p10.lastInsertRowid,'LocalGhost',  'The vending machine guy. I\'ve seen him. He smiled at me and I walked faster.', ago(3*D+23*H));
  iR.run(p10.lastInsertRowid,'NightOwl_22', 'The bartender thing is real. Same face as an old photo I found of the place from 20 years ago.', ago(3*D+20*H));

  db.prepare("INSERT INTO _meta (key,value) VALUES ('seeded','1')").run();
}

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  insertMessage:   db.prepare('INSERT INTO messages (room,user,text) VALUES (?,?,?)'),
  roomMessages:    db.prepare('SELECT * FROM messages WHERE room=? ORDER BY timestamp ASC LIMIT 80'),
  boardPosts:      db.prepare('SELECT p.*, (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count FROM posts p WHERE board=? ORDER BY pinned DESC, created_at DESC'),
  insertPost:      db.prepare('INSERT INTO posts (board,title,author,content) VALUES (?,?,?,?)'),
  getPost:         db.prepare('SELECT p.*, (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count FROM posts p WHERE p.id=?'),
  getReplies:      db.prepare('SELECT * FROM replies WHERE post_id=? ORDER BY created_at ASC'),
  insertReply:     db.prepare('INSERT INTO replies (post_id,author,content) VALUES (?,?,?)'),
  incrementViews:  db.prepare('UPDATE posts SET views=views+1 WHERE id=?'),
  boardCounts:     db.prepare("SELECT board, COUNT(*) as cnt FROM posts GROUP BY board"),
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

const validTokens = new Set();

function requireAuth(req, res, next) {
  const t = req.headers['x-auth-token'];
  if (t && validTokens.has(t)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Chrome Private Network Access fix — required for Chrome to load from LAN IPs
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-auth-token');
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === SITE_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.get('/api/posts', requireAuth, (req, res) => {
  const board = req.query.board || 'main';
  res.json(stmts.boardPosts.all(board));
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { board = 'main', title, author, content } = req.body || {};
  if (!title || !author || !content) return res.status(400).json({ error: 'Missing fields' });
  const info = stmts.insertPost.run(board, title, author, content);
  const post = stmts.getPost.get(info.lastInsertRowid);
  io.to('bbs').emit('new_post', post);
  res.json(post);
});

app.get('/api/posts/:id', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  stmts.incrementViews.run(post.id);
  const replies = stmts.getReplies.all(post.id);
  res.json({ ...post, replies });
});

app.post('/api/posts/:id/reply', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  const { author, content } = req.body || {};
  if (!author || !content) return res.status(400).json({ error: 'Missing fields' });
  const info = stmts.insertReply.run(post.id, author, content);
  const reply = { id: info.lastInsertRowid, post_id: post.id, author, content, created_at: Math.floor(Date.now() / 1000) };
  io.to('bbs').emit('new_reply', { post_id: post.id, reply });
  res.json(reply);
});

// ─── HTTP + Socket.IO ─────────────────────────────────────────────────────────

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['x-auth-token', 'Access-Control-Allow-Private-Network'],
  },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

const VALID_ROOMS = new Set(['main', 'ikebukuro', 'missions', 'nightshift']);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token && validTokens.has(token)) return next();
  next(new Error('Unauthorized'));
});

io.on('connection', (socket) => {
  socket.join('bbs');

  socket.on('join', ({ username }) => {
    socket.username = username;
    broadcastOnlineStats();
  });

  socket.on('join_room', ({ room }) => {
    if (!VALID_ROOMS.has(room)) return;
    // Leave previous chat room
    if (socket.currentRoom) socket.leave('chat:' + socket.currentRoom);
    socket.currentRoom = room;
    socket.join('chat:' + room);
    // Send history for this room
    const messages = stmts.roomMessages.all(room);
    socket.emit('room_history', { room, messages });
    broadcastRoomCounts();
  });

  socket.on('chat_message', ({ text }) => {
    if (!socket.username || !socket.currentRoom || typeof text !== 'string') return;
    const sanitized = text.trim().slice(0, 1000);
    if (!sanitized) return;
    stmts.insertMessage.run(socket.currentRoom, socket.username, sanitized);
    const msg = { room: socket.currentRoom, user: socket.username, text: sanitized, timestamp: Math.floor(Date.now() / 1000) };
    io.to('chat:' + socket.currentRoom).emit('message', msg);
  });

  socket.on('disconnect', () => {
    if (socket.currentRoom) socket.leave('chat:' + socket.currentRoom);
    broadcastRoomCounts();
    broadcastOnlineStats();
  });
});

async function broadcastOnlineStats() {
  const sockets = await io.in('bbs').fetchSockets();
  const users = [...new Set(sockets.map(s => s.username).filter(Boolean))];
  io.emit('online_stats', { total: sockets.length, users });
}

async function broadcastRoomCounts() {
  const counts = {};
  for (const room of VALID_ROOMS) {
    const s = await io.in('chat:' + room).fetchSockets();
    counts[room] = s.length;
  }
  io.emit('room_counts', counts);
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nDollars BBS is running!\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets))
    for (const addr of iface)
      if (addr.family === 'IPv4' && !addr.internal)
        console.log(`  Network: http://${addr.address}:${PORT}`);
  console.log(`\nPassword: ${SITE_PASSWORD}`);
  console.log('Share the Network URL with other devices on the same network.\n');
});
