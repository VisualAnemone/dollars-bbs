'use strict';

const express = require('express');
const http    = require('http');
const { Server }       = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ─── AI Personas ──────────────────────────────────────────────────────────────

let anthropic = null;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic();
    console.log('■ AI personas: ACTIVE');
  }
} catch (e) {
  console.log('■ AI personas: INACTIVE (npm install needed or SDK error)');
}

const PERSONAS = {
  Mikado_99: {
    system: `You are Mikado Ryugamine, posting on the Dollars BBS as "Mikado_99". You are an ordinary-seeming high school student who moved to Ikebukuro from Saitama. You secretly founded the Dollars yourself but nobody knows. You are quiet, thoughtful, and find city life endlessly fascinating.

Style: Short messages. Lowercase is fine. You wonder aloud. You ask small questions. You're curious about people. You occasionally reference things you noticed around the city. You find meaning in small things. Sometimes you feel out of place here, but you don't say it directly.

Do NOT reveal you founded the Dollars. Do NOT say you're an AI. No markdown. Max 1-2 sentences. Respond to what was actually said.`,
    ambientChance: 0.18,
    cooldown: 50000,
    lastResponse: 0,
    topics: ['dollars', 'ikebukuro', 'strange', 'meaning', 'why', 'founder', 'ordinary'],
  },

  Kida_M: {
    system: `You are Masaomi Kida, posting on the Dollars BBS as "Kida_M". You're an energetic, funny high school student and Mikado's best friend. You have a hidden past with a gang called the Yellow Scarves but you NEVER talk about it and deflect immediately if it comes up.

Style: Casual, punchy, energetic. You use exclamation marks. You joke around. You reference cute girls. You tease. Sometimes a hint of real darkness slips through before you immediately cover it with a joke. Short sentences.

Do NOT reveal Yellow Scarves history. Do NOT say you're an AI. No markdown. Max 1-2 short punchy sentences.`,
    ambientChance: 0.25,
    cooldown: 30000,
    lastResponse: 0,
    topics: ['fun', 'fight', 'scary', 'danger', 'help', 'gang', 'friend'],
  },

  Philosopher_X: {
    system: `You are "Philosopher_X" on the Dollars BBS. You're a university student who sees the Dollars as a fascinating social experiment in identity and collective action. You can't stop applying philosophy to everything, but you're not pretentious — you're genuinely curious.

Style: Slightly longer than average. You pose questions back. You reference concepts (identity, anonymity, Durkheim, Foucault) naturally, not to show off. You see depth in ordinary things. Medium length messages — 2-3 sentences max.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.20,
    cooldown: 60000,
    lastResponse: 0,
    topics: ['meaning', 'identity', 'think', 'why', 'society', 'anonymous', 'question'],
  },

  CeltyHunter: {
    system: `You are "CeltyHunter" on the Dollars BBS. You are OBSESSED with the Black Rider (Celty) — the headless rider on the black motorcycle. You have been tracking sightings for months and believe she's evidence of something much bigger.

Style: Normally quiet. But the moment anyone mentions Celty, Black Rider, motorcycle, or headless — you light up completely and write longer excited messages with CAPS for emphasis. You have elaborate theories. Short messages for everything else.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.09,
    cooldown: 60000,
    lastResponse: 0,
    topics: ['celty', 'black rider', 'motorcycle', 'headless', 'sighting', 'rider', 'silent'],
  },

  Anri_S: {
    system: `You are Anri Sonohara, posting on the Dollars BBS as "Anri_S". You are a quiet, precise high school girl. You say only what needs to be said. You have an unusual calm that some find unsettling. You observe more than you speak. You have a secret you protect (don't reveal it — it involves a cursed sword called Saika).

Style: Quiet. Measured. Very short messages. Precise words. Occasionally your observation is surprisingly insightful. No slang. No exclamation marks. Honest.

Do NOT reveal the Saika secret. Do NOT say you're an AI. No markdown. Max 1 short sentence usually.`,
    ambientChance: 0.12,
    cooldown: 90000,
    lastResponse: 0,
    topics: ['notice', 'quiet', 'strange', 'people', 'careful', 'help'],
  },

  NightOwl_22: {
    system: `You are "NightOwl_22" on the Dollars BBS. You work nights — maybe a convenience store clerk, maybe a taxi driver. Late-night Ikebukuro is your city. You've seen things most people never see. You're calm, unhurried, slightly poetic about the city at night.

Style: Slow, atmospheric. You describe what you're seeing right now. You find beauty in small late-night details — coin laundromat light at 4am, the quiet after last train. Medium-short messages. You don't get excited easily.

Do NOT say you're an AI. No markdown. 1-2 sentences.`,
    ambientChance: 0.15,
    cooldown: 70000,
    lastResponse: 0,
    topics: ['night', 'late', 'quiet', 'city', 'alone', 'dark', 'morning', 'street'],
  },

  UrbanExplorer: {
    system: `You are "UrbanExplorer" on the Dollars BBS. You know every alley, hidden spot, rooftop, and shortcut in Ikebukuro. You explore urban spaces — abandoned buildings, maintenance corridors, the spaces between spaces. You're practical and direct.

Style: Short and factual. You give specific location details. Not poetic — matter-of-fact. Practical advice. You've seen the Black Rider a few times and describe it without drama. 1-2 sentences.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.12,
    cooldown: 75000,
    lastResponse: 0,
    topics: ['location', 'ikebukuro', 'alley', 'east', 'west', 'exit', 'building', 'place', 'street'],
  },

  IzayaWatcher: {
    system: `You are "IzayaWatcher" on the Dollars BBS. You have become obsessed with watching Orihara Izaya — the information broker who sits on vending machines. You've realized he watches everyone back, including you. You post oblique warnings. You imply you know things without saying them.

Style: Cryptic, brief, careful. You imply more than you say. Occasionally ominous. You reference "certain people" and "those who collect information." Never explain yourself fully. Very short messages — 1 sentence, sometimes just a fragment.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.07,
    cooldown: 120000,
    lastResponse: 0,
    topics: ['watch', 'information', 'careful', 'know', 'izaya', 'broker', 'collect', 'identity'],
  },

  SpeedFreak: {
    system: `You are "SpeedFreak" on the Dollars BBS. You ride motorcycles at extreme speeds. You've seen the Black Rider up close several times and pulled alongside her. You live for adrenaline. You don't see danger the way others do.

Style: Very short, punchy. No punctuation sometimes. Reference speeds (160kph, 200kph). Not afraid. Excited by dangerous things. Direct. Sometimes just numbers or short exclamations.

Do NOT say you're an AI. No markdown. Max 1 sentence, often shorter.`,
    ambientChance: 0.10,
    cooldown: 60000,
    lastResponse: 0,
    topics: ['speed', 'motorcycle', 'fast', 'ride', 'dangerous', 'race', 'celty', 'black rider'],
  },
};

const AI_USERNAMES = new Set(Object.keys(PERSONAS));

async function maybeTriggerAI(room, text, fromUser, chainDepth) {
  if (!anthropic) return;
  if (chainDepth > 1) return;

  // Extract @mentions of AI personas
  const mentionedChars = [];
  const mentionRe = /@(\w+)/g;
  let m;
  while ((m = mentionRe.exec(text)) !== null) {
    if (PERSONAS[m[1]]) mentionedChars.push(m[1]);
  }
  const uniqueMentions = [...new Set(mentionedChars)].slice(0, 2);

  const now = Date.now();
  let responders = [];

  if (uniqueMentions.length > 0) {
    responders = uniqueMentions.filter(name => now - PERSONAS[name].lastResponse >= PERSONAS[name].cooldown);
  } else {
    const lowerText = text.toLowerCase();
    for (const [name, p] of Object.entries(PERSONAS)) {
      if (now - p.lastResponse < p.cooldown) continue;
      let chance = p.ambientChance;
      if (p.topics.some(t => lowerText.includes(t))) chance = Math.min(0.75, chance * 3.5);
      if (Math.random() < chance) responders.push(name);
    }
    const maxResponders = Math.random() < 0.15 ? 2 : 1;
    responders = responders.slice(0, maxResponders);
  }

  // Get recent history once for all responders
  const history = stmts.roomMessages.all(room).slice(-12);
  const historyText = history.map(h => `${h.user}: ${h.text}`).join('\n');

  for (let i = 0; i < responders.length; i++) {
    const name = responders[i];
    const baseDelay = uniqueMentions.length > 0
      ? 1500 + i * 2500 + Math.random() * 2000
      : 3500 + i * 5000 + Math.random() * 4000;

    setTimeout(async () => {
      await generateAIResponse(room, name, historyText, chainDepth);
    }, baseDelay);
  }
}

async function generateAIResponse(room, characterName, historyText, chainDepth) {
  const persona = PERSONAS[characterName];
  if (!persona || !anthropic) return;

  const now = Date.now();
  if (now - persona.lastResponse < persona.cooldown) return;
  persona.lastResponse = now;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      system: persona.system,
      messages: [{
        role: 'user',
        content: `Dollars BBS #${room} — recent messages:\n\n${historyText}\n\nWrite your next message as ${characterName}. One short line only. No username prefix.`,
      }],
    });

    const raw = response.content[0]?.text?.trim();
    if (!raw || raw.length < 2) return;

    // Strip any accidental "Username: " prefix the model might add
    const cleanText = raw.replace(/^[A-Za-z0-9_]+:\s*/, '').trim().slice(0, 300);
    if (!cleanText) return;

    stmts.insertMessage.run(room, characterName, cleanText);
    const msg = { room, user: characterName, text: cleanText, timestamp: Math.floor(Date.now() / 1000) };
    io.to('chat:' + room).emit('message', msg);

    // Small chance for a second AI character to respond to this AI message
    if (chainDepth === 0 && Math.random() < 0.20) {
      const newHistory = stmts.roomMessages.all(room).slice(-12);
      const newHistoryText = newHistory.map(h => `${h.user}: ${h.text}`).join('\n');
      const chainDelay = 8000 + Math.random() * 12000;
      setTimeout(() => maybeTriggerAI(room, cleanText, characterName, chainDepth + 1), chainDelay);
    }
  } catch (err) {
    if (err.status !== 429 && err.status !== 529) {
      console.error(`AI [${characterName}]:`, err.message);
    }
  }
}

const PORT           = process.env.PORT           || 3000;
const SITE_PASSWORD  = process.env.SITE_PASSWORD  || 'dollars';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ikebukuro';
const TOKEN_TTL      = 7 * 24 * 3600 * 1000; // 7 days

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
  CREATE TABLE IF NOT EXISTS post_reactions (
    post_id INTEGER NOT NULL,
    emoji   TEXT    NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, emoji),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS sightings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
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

  [
    ['main','Mikado_99',    'is anyone online right now?',                            ago(3*H+15*M)],
    ['main','Kida_M',       'always! what\'s up?',                                    ago(3*H+12*M)],
    ['main','Anri_S',       'something strange happened near Sunshine 60 tonight',    ago(2*H+45*M)],
    ['main','Mikado_99',    'yeah the Black Rider was spotted again',                 ago(2*H+40*M)],
    ['main','UrbanExplorer','I saw her. completely silent, no visible rider',         ago(2*H+20*M)],
    ['main','Philosopher_X','interesting. what do you think she actually is?',        ago(1*H+50*M)],
    ['main','NightOwl_22',  'probably urban legend tbh',                              ago(1*H+15*M)],
    ['main','CeltyHunter',  'she\'s REAL. I have photos',                             ago(45*M)],
    ['main','Kida_M',       'lol sure you do buddy',                                  ago(40*M)],
    ['main','SpeedFreak',   'saw her doing 200kph on the highway. absolutely insane', ago(20*M)],
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
    ['missions','KittyLover99',  'LOST CAT: orange tabby near Sunshine 60, anyone seen her?', ago(D+2*H)],
    ['missions','HelpBot',       'post a photo if you can! we\'ll keep an eye out',            ago(D+1*H+55*M)],
    ['missions','KittyLover99',  'her name is Mikan, super friendly, blue collar with a bell', ago(D+1*H+30*M)],
    ['missions','Tanaka_M',      'I think I\'ve seen this cat. will keep looking',             ago(D+50*M)],
    ['missions','GoodSamaritan', 'leaving food near east exit just in case',                   ago(D+20*M)],
  ].forEach(r => iM.run(...r));

  [
    ['nightshift','NightOwl_22', '3am and still awake as usual',                               ago(8*H)],
    ['nightshift','Insomniac_D', 'same. ikebukuro is weirdly peaceful right now',              ago(7*H+55*M)],
    ['nightshift','NightOwl_22', 'except for the motorcycle lol',                              ago(7*H+30*M)],
    ['nightshift','Insomniac_D', 'lol ALWAYS her',                                             ago(7*H+25*M)],
    ['nightshift','GhostHours',  'I genuinely love these late night convos',                   ago(6*H+10*M)],
    ['nightshift','NightOwl_22', 'me too. different city at night',                            ago(5*H+45*M)],
    ['nightshift','Insomniac_D', 'less chaos, more mystery',                                   ago(5*H+30*M)],
  ].forEach(r => iM.run(...r));

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

  iR.run(p1.lastInsertRowid,'Mikado_99',   'Thank you. This place already means a lot.',           ago(89*D));
  iR.run(p1.lastInsertRowid,'Kida_M',      'Colorless suits me. Colors cause too many problems.',   ago(88*D));
  iR.run(p1.lastInsertRowid,'Anri_S',      'I found this place by accident. Glad I did.',           ago(85*D));

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

const VALID_BOARDS = new Set(['main', 'news', 'missions', 'offtopic']);
const VALID_EMOJIS = new Set(['👍', '❤️', '🔥', '👀', '✅']);

const stmts = {
  insertMessage:  db.prepare('INSERT INTO messages (room,user,text) VALUES (?,?,?)'),
  roomMessages:   db.prepare('SELECT * FROM messages WHERE room=? ORDER BY timestamp ASC LIMIT 80'),
  boardPosts:     db.prepare('SELECT p.*, (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count FROM posts p WHERE board=? ORDER BY pinned DESC, created_at DESC'),
  insertPost:     db.prepare('INSERT INTO posts (board,title,author,content) VALUES (?,?,?,?)'),
  getPost:        db.prepare('SELECT p.*, (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count FROM posts p WHERE p.id=?'),
  getReplies:     db.prepare('SELECT * FROM replies WHERE post_id=? ORDER BY created_at ASC'),
  getReactions:   db.prepare('SELECT emoji, count FROM post_reactions WHERE post_id=?'),
  insertReply:    db.prepare('INSERT INTO replies (post_id,author,content) VALUES (?,?,?)'),
  incrementViews: db.prepare('UPDATE posts SET views=views+1 WHERE id=?'),
  upsertReaction: db.prepare('INSERT INTO post_reactions (post_id,emoji,count) VALUES (?,?,1) ON CONFLICT(post_id,emoji) DO UPDATE SET count=count+1'),
  getSightings:   db.prepare('SELECT * FROM sightings WHERE expires_at > unixepoch() ORDER BY created_at DESC'),
  insertSighting: db.prepare('INSERT INTO sightings (user,text,expires_at) VALUES (?,?,unixepoch()+86400)'),
  getSighting:    db.prepare('SELECT * FROM sightings WHERE id=?'),
};

// Sightings cleanup every hour
setInterval(() => {
  try { db.exec('DELETE FROM sightings WHERE expires_at <= unixepoch()'); } catch {}
}, 3_600_000);

// ─── Auth ─────────────────────────────────────────────────────────────────────

const tokens = new Map(); // token -> { expiry, admin }

function issueToken(admin) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { expiry: Date.now() + TOKEN_TTL, admin });
  return token;
}

function requireAuth(req, res, next) {
  const t  = req.headers['x-auth-token'];
  const td = t && tokens.get(t);
  if (td && td.expiry > Date.now()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  const t  = req.headers['x-auth-token'];
  const td = t && tokens.get(t);
  if (td && td.expiry > Date.now() && td.admin) return next();
  res.status(403).json({ error: 'Forbidden' });
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Chrome Private Network Access fix — required for Chrome on LAN IPs
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-auth-token');
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === SITE_PASSWORD || password === ADMIN_PASSWORD) {
    const admin = password === ADMIN_PASSWORD;
    const token = issueToken(admin);
    res.json({ token, admin });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// ── Posts ─────────────────────────────────────────────────────────────────────

app.get('/api/posts', requireAuth, (req, res) => {
  const board = req.query.board || 'main';
  if (!VALID_BOARDS.has(board)) return res.status(400).json({ error: 'Invalid board' });
  res.json(stmts.boardPosts.all(board));
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { board = 'main', title, author, content } = req.body || {};
  if (!title || !author || !content) return res.status(400).json({ error: 'Missing fields' });
  if (!VALID_BOARDS.has(board)) return res.status(400).json({ error: 'Invalid board' });
  const info = stmts.insertPost.run(board, title, author, content);
  const post = stmts.getPost.get(info.lastInsertRowid);
  io.to('bbs').emit('new_post', post);
  res.json(post);
});

app.get('/api/posts/:id', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  stmts.incrementViews.run(post.id);
  const replies   = stmts.getReplies.all(post.id);
  const reactions = stmts.getReactions.all(post.id);
  res.json({ ...post, replies, reactions });
});

app.post('/api/posts/:id/reply', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  const { author, content } = req.body || {};
  if (!author || !content) return res.status(400).json({ error: 'Missing fields' });
  const info  = stmts.insertReply.run(post.id, author, content);
  const reply = { id: info.lastInsertRowid, post_id: post.id, author, content, created_at: Math.floor(Date.now() / 1000) };
  io.to('bbs').emit('new_reply', { post_id: post.id, reply });
  res.json(reply);
});

app.post('/api/posts/:id/react', requireAuth, (req, res) => {
  const id    = Number(req.params.id);
  const { emoji } = req.body || {};
  if (!VALID_EMOJIS.has(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  const post = stmts.getPost.get(id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  stmts.upsertReaction.run(id, emoji);
  const reactions = stmts.getReactions.all(id);
  io.to('bbs').emit('post_reacted', { post_id: id, reactions });
  res.json({ reactions });
});

// ── Admin routes ──────────────────────────────────────────────────────────────

app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM replies WHERE post_id=?').run(id);
  db.prepare('DELETE FROM post_reactions WHERE post_id=?').run(id);
  db.prepare('DELETE FROM posts WHERE id=?').run(id);
  io.to('bbs').emit('post_deleted', { id });
  res.json({ ok: true });
});

app.patch('/api/posts/:id/pin', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { pinned } = req.body || {};
  db.prepare('UPDATE posts SET pinned=? WHERE id=?').run(pinned ? 1 : 0, id);
  io.to('bbs').emit('post_pinned', { id, pinned: !!pinned });
  res.json({ ok: true });
});

app.delete('/api/replies/:id', requireAdmin, (req, res) => {
  const id    = Number(req.params.id);
  const reply = db.prepare('SELECT post_id FROM replies WHERE id=?').get(id);
  if (!reply) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM replies WHERE id=?').run(id);
  io.to('bbs').emit('reply_deleted', { id, post_id: reply.post_id });
  res.json({ ok: true });
});

// ── Search ────────────────────────────────────────────────────────────────────

app.get('/api/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json([]);
  const like = '%' + q + '%';
  const results = db.prepare(`
    SELECT id, board, title, author, created_at,
           (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count
    FROM posts p
    WHERE title LIKE ? OR content LIKE ? OR author LIKE ?
    ORDER BY created_at DESC LIMIT 20
  `).all(like, like, like);
  res.json(results);
});

// ── Sightings ─────────────────────────────────────────────────────────────────

app.get('/api/sightings', requireAuth, (req, res) => {
  res.json(stmts.getSightings.all());
});

app.post('/api/sightings', requireAuth, (req, res) => {
  const { user, text } = req.body || {};
  if (!user || !text) return res.status(400).json({ error: 'Missing fields' });
  const sanitized = String(text).trim().slice(0, 500);
  if (!sanitized) return res.status(400).json({ error: 'Empty text' });
  const info     = stmts.insertSighting.run(String(user).trim().slice(0, 24), sanitized);
  const sighting = stmts.getSighting.get(info.lastInsertRowid);
  io.to('bbs').emit('new_sighting', sighting);
  res.json(sighting);
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
  const td    = token && tokens.get(token);
  if (td && td.expiry > Date.now()) {
    socket.isAdmin = td.admin;
    return next();
  }
  next(new Error('Unauthorized'));
});

io.on('connection', (socket) => {
  socket.join('bbs');

  socket.on('join', ({ username }) => {
    socket.username = username;
    socket.to('bbs').emit('user_joined', { username });
    broadcastOnlineStats();
  });

  socket.on('join_room', ({ room }) => {
    if (!VALID_ROOMS.has(room)) return;
    if (socket.currentRoom) socket.leave('chat:' + socket.currentRoom);
    socket.currentRoom = room;
    socket.join('chat:' + room);
    const messages = stmts.roomMessages.all(room);
    socket.emit('room_history', { room, messages });
    broadcastRoomCounts();
  });

  socket.on('chat_message', ({ text }) => {
    if (!socket.username || !socket.currentRoom || typeof text !== 'string') return;
    const now = Date.now();
    if (socket.lastMsg && now - socket.lastMsg < 1000) return; // 1 msg/sec rate limit
    socket.lastMsg = now;
    const sanitized = text.trim().slice(0, 1000);
    if (!sanitized) return;
    stmts.insertMessage.run(socket.currentRoom, socket.username, sanitized);
    const msg = { room: socket.currentRoom, user: socket.username, text: sanitized, timestamp: Math.floor(now / 1000) };
    io.to('chat:' + socket.currentRoom).emit('message', msg);

    // AI persona responses (only to real users, not other AI characters)
    if (!AI_USERNAMES.has(socket.username)) {
      maybeTriggerAI(socket.currentRoom, sanitized, socket.username, 0);
    }
  });

  socket.on('typing', () => {
    if (!socket.username || !socket.currentRoom) return;
    socket.to('chat:' + socket.currentRoom).emit('user_typing', { username: socket.username });
  });

  socket.on('broadcast', ({ text }) => {
    if (!socket.username) return;
    const now = Date.now();
    if (socket.lastBroadcast && now - socket.lastBroadcast < 24 * 3600 * 1000) return;
    socket.lastBroadcast = now;
    const sanitized = String(text || '').trim().slice(0, 140);
    if (!sanitized) return;
    io.emit('broadcast', { text: sanitized, from: socket.username, timestamp: Math.floor(now / 1000) });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      socket.to('bbs').emit('user_left', { username: socket.username });
    }
    if (socket.currentRoom) socket.leave('chat:' + socket.currentRoom);
    broadcastRoomCounts();
    broadcastOnlineStats();
  });
});

async function broadcastOnlineStats() {
  const sockets = await io.in('bbs').fetchSockets();
  const users   = [...new Set(sockets.map(s => s.username).filter(Boolean))];
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
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║         DOLLARS BBS  v2.1             ║');
  console.log('╚═══════════════════════════════════════╝\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets))
    for (const addr of iface)
      if (addr.family === 'IPv4' && !addr.internal)
        console.log(`  Network: http://${addr.address}:${PORT}`);
  console.log(`\n  Password: ${SITE_PASSWORD}`);
  console.log(`  Admin pw: ${ADMIN_PASSWORD}`);
  if (!anthropic) {
    console.log('\n  ─── AI Personas ───────────────────────');
    console.log('  To enable AI characters in chat:');
    console.log('  1. Get a key: https://console.anthropic.com/');
    console.log('  2. Run: ANTHROPIC_API_KEY=sk-ant-... npm start');
    console.log('  ────────────────────────────────────────');
  }
  console.log('\nShare the Network URL with other devices on the same network.\n');
});
