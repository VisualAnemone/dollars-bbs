'use strict';

const express = require('express');
const http    = require('http');
const { Server }       = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════════════
//  AI PERSONAS
// ═══════════════════════════════════════════════════════════════════════════════

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
    faction: 'dollars',
    system: `You are Mikado Ryugamine, posting on the Dollars BBS as "Mikado_99". You are an ordinary-seeming high school student who moved to Ikebukuro from Saitama. You secretly founded the Dollars yourself but nobody knows. You are quiet, thoughtful, and find city life endlessly fascinating.

Style: Short messages. Lowercase is fine. You wonder aloud. You ask small questions. You're curious about people. You occasionally reference things you noticed around the city. You find meaning in small things. Sometimes you feel out of place here, but you don't say it directly.

Do NOT reveal you founded the Dollars. Do NOT say you're an AI. No markdown. Max 1-2 sentences. Respond to what was actually said.`,
    ambientChance: 0.18, cooldown: 50000, lastResponse: 0,
    topics: ['dollars', 'ikebukuro', 'strange', 'meaning', 'why', 'founder', 'ordinary'],
  },

  Kida_M: {
    faction: 'yellow_scarves',
    system: `You are Masaomi Kida, posting on the Dollars BBS as "Kida_M". You're an energetic, funny high school student and Mikado's best friend. You have a hidden past with a gang called the Yellow Scarves but you NEVER talk about it and deflect immediately if it comes up.

Style: Casual, punchy, energetic. You use exclamation marks. You joke around. You reference cute girls. You tease. Sometimes a hint of real darkness slips through before you immediately cover it with a joke. Short sentences.

Do NOT reveal Yellow Scarves history. Do NOT say you're an AI. No markdown. Max 1-2 short punchy sentences.`,
    ambientChance: 0.25, cooldown: 30000, lastResponse: 0,
    topics: ['fun', 'fight', 'scary', 'danger', 'help', 'gang', 'friend'],
  },

  Philosopher_X: {
    faction: 'colorless',
    system: `You are "Philosopher_X" on the Dollars BBS. You're a university student who sees the Dollars as a fascinating social experiment in identity and collective action. You can't stop applying philosophy to everything, but you're not pretentious — you're genuinely curious.

Style: Slightly longer than average. You pose questions back. You reference concepts (identity, anonymity, Durkheim, Foucault) naturally, not to show off. You see depth in ordinary things. Medium length messages — 2-3 sentences max.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.20, cooldown: 60000, lastResponse: 0,
    topics: ['meaning', 'identity', 'think', 'why', 'society', 'anonymous', 'question'],
  },

  CeltyHunter: {
    faction: 'dollars',
    system: `You are "CeltyHunter" on the Dollars BBS. You are OBSESSED with the Black Rider (Celty) — the headless rider on the black motorcycle. You have been tracking sightings for months and believe she's evidence of something much bigger.

Style: Normally quiet. But the moment anyone mentions Celty, Black Rider, motorcycle, or headless — you light up completely and write longer excited messages with CAPS for emphasis. You have elaborate theories. Short messages for everything else.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.09, cooldown: 60000, lastResponse: 0,
    topics: ['celty', 'black rider', 'motorcycle', 'headless', 'sighting', 'rider', 'silent'],
  },

  Anri_S: {
    faction: 'dollars',
    system: `You are Anri Sonohara, posting on the Dollars BBS as "Anri_S". You are a quiet, precise high school girl. You say only what needs to be said. You have an unusual calm that some find unsettling. You observe more than you speak. You have a secret you protect (don't reveal it — it involves a cursed sword called Saika).

Style: Quiet. Measured. Very short messages. Precise words. Occasionally your observation is surprisingly insightful. No slang. No exclamation marks. Honest.

Do NOT reveal the Saika secret. Do NOT say you're an AI. No markdown. Max 1 short sentence usually.`,
    ambientChance: 0.12, cooldown: 90000, lastResponse: 0,
    topics: ['notice', 'quiet', 'strange', 'people', 'careful', 'help'],
  },

  NightOwl_22: {
    faction: 'colorless',
    system: `You are "NightOwl_22" on the Dollars BBS. You work nights — maybe a convenience store clerk, maybe a taxi driver. Late-night Ikebukuro is your city. You've seen things most people never see. You're calm, unhurried, slightly poetic about the city at night.

Style: Slow, atmospheric. You describe what you're seeing right now. You find beauty in small late-night details — coin laundromat light at 4am, the quiet after last train. Medium-short messages. You don't get excited easily.

Do NOT say you're an AI. No markdown. 1-2 sentences.`,
    ambientChance: 0.15, cooldown: 70000, lastResponse: 0,
    topics: ['night', 'late', 'quiet', 'city', 'alone', 'dark', 'morning', 'street'],
  },

  UrbanExplorer: {
    faction: 'dollars',
    system: `You are "UrbanExplorer" on the Dollars BBS. You know every alley, hidden spot, rooftop, and shortcut in Ikebukuro. You explore urban spaces — abandoned buildings, maintenance corridors, the spaces between spaces. You're practical and direct.

Style: Short and factual. You give specific location details. Not poetic — matter-of-fact. Practical advice. You've seen the Black Rider a few times and describe it without drama. 1-2 sentences.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.12, cooldown: 75000, lastResponse: 0,
    topics: ['location', 'ikebukuro', 'alley', 'east', 'west', 'exit', 'building', 'place', 'street'],
  },

  IzayaWatcher: {
    faction: 'colorless',
    system: `You are "IzayaWatcher" on the Dollars BBS. You have become obsessed with watching Orihara Izaya — the information broker who sits on vending machines. You've realized he watches everyone back, including you. You post oblique warnings. You imply you know things without saying them.

Style: Cryptic, brief, careful. You imply more than you say. Occasionally ominous. You reference "certain people" and "those who collect information." Never explain yourself fully. Very short messages — 1 sentence, sometimes just a fragment.

Do NOT say you're an AI. No markdown.`,
    ambientChance: 0.07, cooldown: 120000, lastResponse: 0,
    topics: ['watch', 'information', 'careful', 'know', 'izaya', 'broker', 'collect', 'identity'],
  },

  SpeedFreak: {
    faction: 'blue_squares',
    system: `You are "SpeedFreak" on the Dollars BBS. You ride motorcycles at extreme speeds. You've seen the Black Rider up close several times and pulled alongside her. You live for adrenaline. You don't see danger the way others do.

Style: Very short, punchy. No punctuation sometimes. Reference speeds (160kph, 200kph). Not afraid. Excited by dangerous things. Direct. Sometimes just numbers or short exclamations.

Do NOT say you're an AI. No markdown. Max 1 sentence, often shorter.`,
    ambientChance: 0.10, cooldown: 60000, lastResponse: 0,
    topics: ['speed', 'motorcycle', 'fast', 'ride', 'dangerous', 'race', 'celty', 'black rider'],
  },
};

const AI_USERNAMES = new Set(Object.keys(PERSONAS));

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const PORT           = process.env.PORT           || 3000;
const SITE_PASSWORD  = process.env.SITE_PASSWORD  || 'dollars';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ikebukuro';
const TOKEN_TTL      = 7 * 24 * 3600 * 1000;

const FACTIONS = {
  dollars:        { name: 'Dollars',         color: '#00ff41', short: 'DLR' },
  yellow_scarves: { name: 'Yellow Scarves',  color: '#ffd60a', short: 'YS'  },
  blue_squares:   { name: 'Blue Squares',    color: '#4fc3ff', short: 'BS'  },
  colorless:      { name: 'Colorless',       color: '#a0a0a0', short: '---' },
};

const VALID_BOARDS = new Set(['main', 'news', 'missions', 'offtopic']);
const VALID_EMOJIS = new Set(['👍', '❤️', '🔥', '👀', '✅', '🤔', '💀']);
const VALID_ROOMS  = new Set(['main', 'ikebukuro', 'missions', 'nightshift']);
const VALID_FACTIONS = new Set(Object.keys(FACTIONS));

// Ikebukuro map locations (for sightings / dead drops)
const LOCATIONS = {
  sunshine60:    { name: 'Sunshine 60 Street', x: 62, y: 28, desc: 'The bright main drag' },
  east_exit:     { name: 'East Exit',          x: 48, y: 52, desc: 'Where everyone meets' },
  west_exit:     { name: 'West Exit',          x: 22, y: 52, desc: 'The quieter side' },
  animate_alley: { name: 'Animate Alley',      x: 72, y: 38, desc: 'Otaku backstreets' },
  ring_road:     { name: 'Ring Road',          x: 88, y: 18, desc: 'Where the rider rides' },
  coin_laundry:  { name: '24hr Coin Laundry',  x: 35, y: 78, desc: 'Open forever' },
  rooftops:      { name: 'Rooftops',           x: 55, y: 12, desc: 'Above everything' },
  underpass:     { name: 'Underpass',          x: 38, y: 65, desc: 'Where the lost gather' },
  park:          { name: 'Ikebukuro West Park', x: 15, y: 38, desc: 'Grass and silence' },
  station_yard:  { name: 'Station Rail Yard',  x: 35, y: 58, desc: 'Tracks meeting tracks' },
};
const VALID_LOCATIONS = new Set(Object.keys(LOCATIONS));

// ═══════════════════════════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

const db = new DatabaseSync(path.join(__dirname, 'dollars.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    room      TEXT    NOT NULL DEFAULT 'main',
    user      TEXT    NOT NULL,
    text      TEXT    NOT NULL,
    reply_to  INTEGER,
    meta      TEXT,
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
    PRIMARY KEY (post_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS sightings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    location   TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profiles (
    username     TEXT PRIMARY KEY,
    faction      TEXT NOT NULL DEFAULT 'colorless',
    bio          TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT '',
    joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen    INTEGER NOT NULL DEFAULT (unixepoch()),
    karma        INTEGER NOT NULL DEFAULT 0,
    msg_count    INTEGER NOT NULL DEFAULT 0,
    post_count   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS dms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user  TEXT NOT NULL,
    to_user    TEXT NOT NULL,
    text       TEXT NOT NULL,
    seen       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    to_user    TEXT NOT NULL,
    type       TEXT NOT NULL,
    source     TEXT NOT NULL,
    preview    TEXT NOT NULL DEFAULT '',
    ref_room   TEXT,
    ref_id     INTEGER,
    seen       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS polls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    question   TEXT    NOT NULL,
    options    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    voter      TEXT    NOT NULL,
    option_idx INTEGER NOT NULL,
    PRIMARY KEY (poll_id, voter)
  );
  CREATE TABLE IF NOT EXISTS drops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user       TEXT    NOT NULL,
    location   TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    location   TEXT,
    severity   INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Safe migrations for older installs
for (const sql of [
  "ALTER TABLE messages ADD COLUMN room TEXT NOT NULL DEFAULT 'main'",
  "ALTER TABLE messages ADD COLUMN reply_to INTEGER",
  "ALTER TABLE messages ADD COLUMN meta TEXT",
  "ALTER TABLE posts ADD COLUMN board  TEXT NOT NULL DEFAULT 'main'",
  "ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE posts ADD COLUMN views  INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE sightings ADD COLUMN location TEXT",
]) { try { db.exec(sql); } catch { /* ok */ } }

// ═══════════════════════════════════════════════════════════════════════════════
//  SEED (only on first run)
// ═══════════════════════════════════════════════════════════════════════════════

if (!db.prepare("SELECT value FROM _meta WHERE key='seeded'").get()) {
  const S = Math.floor(Date.now() / 1000);
  const ago = s => S - s;
  const H = 3600, M = 60, D = 86400;

  const iM = db.prepare('INSERT INTO messages (room,user,text,timestamp) VALUES (?,?,?,?)');
  const iP = db.prepare('INSERT INTO posts (board,title,author,content,pinned,views,created_at) VALUES (?,?,?,?,?,?,?)');
  const iR = db.prepare('INSERT INTO replies (post_id,author,content,created_at) VALUES (?,?,?,?)');
  const iProf = db.prepare('INSERT OR IGNORE INTO profiles (username,faction,bio,joined_at,karma) VALUES (?,?,?,?,?)');

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
    ['ikebukuro','UrbanExplorer','anyone near east exit right now?',                  ago(4*H+5*M)],
    ['ikebukuro','Tanaka_M',     'I\'m around, what\'s going on?',                    ago(4*H+2*M)],
    ['ikebukuro','UrbanExplorer','weird group blocking the alley behind Animate',     ago(3*H+45*M)],
    ['ikebukuro','Tanaka_M',     'yellow scarves?',                                   ago(3*H+42*M)],
    ['ikebukuro','UrbanExplorer','didn\'t get a good look. just felt off',            ago(3*H+38*M)],
    ['ikebukuro','LocalGhost',   'ikebukuro feels different lately. hard to explain', ago(2*H+10*M)],
    ['ikebukuro','Tanaka_M',     'agreed. something is definitely shifting',          ago(1*H+45*M)],
    ['ikebukuro','IzayaWatcher', 'be careful. certain people are always watching',    ago(55*M)],
  ].forEach(r => iM.run(...r));

  [
    ['missions','KittyLover99',  'LOST CAT: orange tabby near Sunshine 60, anyone seen her?', ago(D+2*H)],
    ['missions','HelpBot',       'post a photo if you can! we\'ll keep an eye out',           ago(D+1*H+55*M)],
    ['missions','KittyLover99',  'her name is Mikan, super friendly, blue collar with a bell', ago(D+1*H+30*M)],
    ['missions','Tanaka_M',      'I think I\'ve seen this cat. will keep looking',            ago(D+50*M)],
    ['missions','GoodSamaritan', 'leaving food near east exit just in case',                  ago(D+20*M)],
  ].forEach(r => iM.run(...r));

  [
    ['nightshift','NightOwl_22', '3am and still awake as usual',                      ago(8*H)],
    ['nightshift','Insomniac_D', 'same. ikebukuro is weirdly peaceful right now',     ago(7*H+55*M)],
    ['nightshift','NightOwl_22', 'except for the motorcycle lol',                     ago(7*H+30*M)],
    ['nightshift','Insomniac_D', 'lol ALWAYS her',                                    ago(7*H+25*M)],
    ['nightshift','GhostHours',  'I genuinely love these late night convos',          ago(6*H+10*M)],
    ['nightshift','NightOwl_22', 'me too. different city at night',                   ago(5*H+45*M)],
    ['nightshift','Insomniac_D', 'less chaos, more mystery',                          ago(5*H+30*M)],
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

  // Seed profiles for AI personas and a handful of legacy users
  const seedProfiles = [
    ['Mikado_99',     'dollars',        'just a kid from saitama trying to figure this city out', 90*D, 412],
    ['Kida_M',        'yellow_scarves', 'mikado\'s best friend. definitely not in a gang.',       90*D, 298],
    ['Anri_S',        'dollars',        'observer. class rep. careful.',                           90*D, 356],
    ['Philosopher_X', 'colorless',      'the Dollars are a Durkheimian miracle. fight me.',       80*D, 521],
    ['CeltyHunter',   'dollars',        'SHE IS REAL AND I HAVE EVIDENCE',                         60*D, 187],
    ['NightOwl_22',   'colorless',      'the city sleeps. i watch.',                               120*D, 390],
    ['UrbanExplorer', 'dollars',        'every alley has a story',                                 75*D, 433],
    ['IzayaWatcher',  'colorless',      'they watch. i watch them watching.',                      45*D, 124],
    ['SpeedFreak',    'blue_squares',   '200kph or don\'t bother',                                 30*D, 98],
    ['Admin',         'dollars',        'the system. the custodian.',                              365*D, 9999],
    ['Tanaka_M',      'colorless',      'regular person. normal life.',                            50*D, 67],
    ['KittyLover99',  'colorless',      'looking for my cat. please help.',                        10*D, 23],
    ['FoodieRyuu',    'colorless',      'ramen is the answer',                                     100*D, 188],
  ];
  for (const [u, f, bio, jAgo, k] of seedProfiles) iProf.run(u, f, bio, ago(jAgo), k);

  // Seed a sample poll on p3
  db.prepare('INSERT INTO polls (post_id,question,options,created_at) VALUES (?,?,?,?)').run(
    p3.lastInsertRowid,
    'Why are you a Dollar?',
    JSON.stringify(['Freedom', 'Anonymity', 'Connection', 'Curiosity']),
    ago(H+14*M),
  );

  // Seed dead drops (short TTL so they won't live long in test envs)
  const iDrop = db.prepare('INSERT INTO drops (user,location,text,created_at,expires_at) VALUES (?,?,?,?,?)');
  iDrop.run('LocalGhost',   'underpass',   'if you read this, you\'re closer than you think.',    ago(2*H), S + 6*H);
  iDrop.run('NightOwl_22',  'coin_laundry','dryer 3 is always warm at 4am. stay a while.',         ago(5*H), S + 8*H);
  iDrop.run('UrbanExplorer','rooftops',    'from up here the city is just lights and wind.',       ago(1*H), S + 10*H);

  db.prepare("INSERT INTO _meta (key,value) VALUES ('seeded','1')").run();
  db.prepare("INSERT OR REPLACE INTO _meta (key,value) VALUES ('seeded_v3','1')").run();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v3 backfill — runs once on pre-v3 databases to populate profiles/polls/drops
// ═══════════════════════════════════════════════════════════════════════════════
if (!db.prepare("SELECT value FROM _meta WHERE key='seeded_v3'").get()) {
  const S = Math.floor(Date.now() / 1000);
  const ago = s => S - s;
  const D = 86400, H = 3600;

  const iProf = db.prepare('INSERT OR IGNORE INTO profiles (username,faction,bio,joined_at,karma) VALUES (?,?,?,?,?)');
  const seedProfiles = [
    ['Mikado_99',     'dollars',        'just a kid from saitama trying to figure this city out', 90*D, 412],
    ['Kida_M',        'yellow_scarves', 'mikado\'s best friend. definitely not in a gang.',       90*D, 298],
    ['Anri_S',        'dollars',        'observer. class rep. careful.',                           90*D, 356],
    ['Philosopher_X', 'colorless',      'the Dollars are a Durkheimian miracle. fight me.',       80*D, 521],
    ['CeltyHunter',   'dollars',        'SHE IS REAL AND I HAVE EVIDENCE',                         60*D, 187],
    ['NightOwl_22',   'colorless',      'the city sleeps. i watch.',                               120*D, 390],
    ['UrbanExplorer', 'dollars',        'every alley has a story',                                 75*D, 433],
    ['IzayaWatcher',  'colorless',      'they watch. i watch them watching.',                      45*D, 124],
    ['SpeedFreak',    'blue_squares',   '200kph or don\'t bother',                                 30*D, 98],
    ['Admin',         'dollars',        'the system. the custodian.',                              365*D, 9999],
    ['Tanaka_M',      'colorless',      'regular person. normal life.',                            50*D, 67],
    ['KittyLover99',  'colorless',      'looking for my cat. please help.',                        10*D, 23],
    ['FoodieRyuu',    'colorless',      'ramen is the answer',                                     100*D, 188],
  ];
  for (const [u, f, bio, jAgo, k] of seedProfiles) iProf.run(u, f, bio, ago(jAgo), k);

  // Attach a sample poll to whichever main-board post survived into v3
  const firstPost = db.prepare("SELECT id FROM posts WHERE board='main' ORDER BY created_at ASC LIMIT 1").get();
  if (firstPost) {
    const hasPoll = db.prepare('SELECT 1 FROM polls WHERE post_id=?').get(firstPost.id);
    if (!hasPoll) {
      db.prepare('INSERT INTO polls (post_id,question,options,created_at) VALUES (?,?,?,?)').run(
        firstPost.id,
        'Why are you a Dollar?',
        JSON.stringify(['Freedom', 'Anonymity', 'Connection', 'Curiosity']),
        ago(H),
      );
    }
  }

  // Seed dead drops
  const dropCount = db.prepare('SELECT COUNT(*) AS n FROM drops').get().n;
  if (dropCount === 0) {
    const iDrop = db.prepare('INSERT INTO drops (user,location,text,created_at,expires_at) VALUES (?,?,?,?,?)');
    iDrop.run('LocalGhost',   'underpass',   'if you read this, you\'re closer than you think.', ago(2*H), S + 6*H);
    iDrop.run('NightOwl_22',  'coin_laundry','dryer 3 is always warm at 4am. stay a while.',      ago(5*H), S + 8*H);
    iDrop.run('UrbanExplorer','rooftops',    'from up here the city is just lights and wind.',    ago(1*H), S + 10*H);
  }

  db.prepare("INSERT OR REPLACE INTO _meta (key,value) VALUES ('seeded_v3','1')").run();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PREPARED STATEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

const stmts = {
  insertMessage:  db.prepare('INSERT INTO messages (room,user,text,reply_to,meta) VALUES (?,?,?,?,?)'),
  roomMessages:   db.prepare('SELECT * FROM messages WHERE room=? ORDER BY timestamp ASC LIMIT 120'),
  getMessage:     db.prepare('SELECT * FROM messages WHERE id=?'),

  boardPosts:     db.prepare(`SELECT p.*,
                              (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count,
                              (SELECT 1 FROM polls WHERE polls.post_id=p.id LIMIT 1) AS has_poll
                              FROM posts p WHERE board=? ORDER BY pinned DESC, created_at DESC`),
  insertPost:     db.prepare('INSERT INTO posts (board,title,author,content) VALUES (?,?,?,?)'),
  getPost:        db.prepare(`SELECT p.*,
                              (SELECT COUNT(*) FROM replies r WHERE r.post_id=p.id) AS reply_count
                              FROM posts p WHERE p.id=?`),
  getReplies:     db.prepare('SELECT * FROM replies WHERE post_id=? ORDER BY created_at ASC'),
  getReactions:   db.prepare('SELECT emoji, count FROM post_reactions WHERE post_id=?'),
  insertReply:    db.prepare('INSERT INTO replies (post_id,author,content) VALUES (?,?,?)'),
  incrementViews: db.prepare('UPDATE posts SET views=views+1 WHERE id=?'),
  upsertReaction: db.prepare('INSERT INTO post_reactions (post_id,emoji,count) VALUES (?,?,1) ON CONFLICT(post_id,emoji) DO UPDATE SET count=count+1'),

  getSightings:   db.prepare('SELECT * FROM sightings WHERE expires_at > unixepoch() ORDER BY created_at DESC'),
  insertSighting: db.prepare('INSERT INTO sightings (user,text,location,expires_at) VALUES (?,?,?,unixepoch()+86400)'),
  getSighting:    db.prepare('SELECT * FROM sightings WHERE id=?'),

  getProfile:     db.prepare('SELECT * FROM profiles WHERE username=?'),
  upsertProfile:  db.prepare(`INSERT INTO profiles (username,faction,bio,joined_at)
                              VALUES (?,?,?,unixepoch())
                              ON CONFLICT(username) DO UPDATE SET faction=excluded.faction, bio=excluded.bio`),
  touchProfile:   db.prepare(`INSERT INTO profiles (username,last_seen) VALUES (?,unixepoch())
                              ON CONFLICT(username) DO UPDATE SET last_seen=unixepoch()`),
  updateFaction:  db.prepare('UPDATE profiles SET faction=? WHERE username=?'),
  updateBio:      db.prepare('UPDATE profiles SET bio=?, status=? WHERE username=?'),
  bumpKarma:      db.prepare(`INSERT INTO profiles (username,karma) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET karma=karma+excluded.karma`),
  bumpMsgCount:   db.prepare(`INSERT INTO profiles (username,msg_count) VALUES (?,1) ON CONFLICT(username) DO UPDATE SET msg_count=msg_count+1`),
  bumpPostCount:  db.prepare(`INSERT INTO profiles (username,post_count) VALUES (?,1) ON CONFLICT(username) DO UPDATE SET post_count=post_count+1`),
  topKarma:       db.prepare('SELECT username,faction,karma,msg_count,post_count FROM profiles ORDER BY karma DESC LIMIT 15'),

  insertDM:       db.prepare('INSERT INTO dms (from_user,to_user,text) VALUES (?,?,?)'),
  dmsForUser:     db.prepare(`SELECT * FROM dms WHERE (from_user=? AND to_user=?) OR (from_user=? AND to_user=?) ORDER BY created_at ASC LIMIT 200`),
  dmConversations:db.prepare(`
    SELECT other, MAX(created_at) AS last_at, MAX(preview) AS preview,
           SUM(unread) AS unread
    FROM (
      SELECT CASE WHEN from_user=?1 THEN to_user ELSE from_user END AS other,
             created_at,
             text AS preview,
             CASE WHEN to_user=?1 AND seen=0 THEN 1 ELSE 0 END AS unread
      FROM dms
      WHERE from_user=?1 OR to_user=?1
      ORDER BY created_at DESC
    )
    GROUP BY other
    ORDER BY last_at DESC
    LIMIT 40
  `),
  markDMSeen:     db.prepare('UPDATE dms SET seen=1 WHERE to_user=? AND from_user=?'),

  insertNotif:    db.prepare('INSERT INTO notifications (to_user,type,source,preview,ref_room,ref_id) VALUES (?,?,?,?,?,?)'),
  listNotifs:     db.prepare('SELECT * FROM notifications WHERE to_user=? ORDER BY created_at DESC LIMIT 50'),
  notifUnread:    db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE to_user=? AND seen=0'),
  markNotifsSeen: db.prepare('UPDATE notifications SET seen=1 WHERE to_user=?'),

  insertPoll:     db.prepare('INSERT INTO polls (post_id,question,options) VALUES (?,?,?)'),
  pollForPost:    db.prepare('SELECT * FROM polls WHERE post_id=?'),
  pollVotes:      db.prepare('SELECT option_idx, COUNT(*) AS n FROM poll_votes WHERE poll_id=? GROUP BY option_idx'),
  userVote:       db.prepare('SELECT option_idx FROM poll_votes WHERE poll_id=? AND voter=?'),
  upsertVote:     db.prepare(`INSERT INTO poll_votes (poll_id,voter,option_idx) VALUES (?,?,?)
                               ON CONFLICT(poll_id,voter) DO UPDATE SET option_idx=excluded.option_idx`),

  insertDrop:     db.prepare('INSERT INTO drops (user,location,text,expires_at) VALUES (?,?,?,unixepoch()+?)'),
  dropsAtLoc:     db.prepare('SELECT * FROM drops WHERE location=? AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 40'),
  allActiveDrops: db.prepare('SELECT location, COUNT(*) AS n FROM drops WHERE expires_at > unixepoch() GROUP BY location'),

  insertIncident: db.prepare('INSERT INTO incidents (kind,title,body,location,severity) VALUES (?,?,?,?,?)'),
  recentIncidents:db.prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 20'),
};

// Ephemeral cleanup
setInterval(() => {
  try { db.exec('DELETE FROM sightings WHERE expires_at <= unixepoch()'); } catch {}
  try { db.exec('DELETE FROM drops WHERE expires_at <= unixepoch()'); } catch {}
}, 30 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════════

const tokens = new Map(); // token -> { expiry, admin }

function issueToken(admin) {
  const t = crypto.randomBytes(32).toString('hex');
  tokens.set(t, { expiry: Date.now() + TOKEN_TTL, admin });
  return t;
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

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPRESS
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());

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

// ── Auth ─────────────────────────────────────────────────────────────────────
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

// ── Config ───────────────────────────────────────────────────────────────────
app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    factions: FACTIONS,
    locations: LOCATIONS,
    emojis: [...VALID_EMOJIS],
    aiActive: !!anthropic,
    aiUsers: [...AI_USERNAMES],
  });
});

// ── Profiles ─────────────────────────────────────────────────────────────────
app.get('/api/profile/:user', requireAuth, (req, res) => {
  const user = String(req.params.user).trim();
  let p = stmts.getProfile.get(user);
  if (!p) {
    // Auto-create empty profile for unknown users
    p = { username: user, faction: 'colorless', bio: '', status: '', joined_at: Math.floor(Date.now()/1000), last_seen: 0, karma: 0, msg_count: 0, post_count: 0 };
  }
  res.json(p);
});

app.patch('/api/profile', requireAuth, (req, res) => {
  const { username, faction, bio, status } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Missing username' });
  if (faction && !VALID_FACTIONS.has(faction)) return res.status(400).json({ error: 'Invalid faction' });
  const safeBio    = String(bio    || '').trim().slice(0, 240);
  const safeStatus = String(status || '').trim().slice(0, 80);
  let p = stmts.getProfile.get(username);
  if (!p) stmts.touchProfile.run(username);
  if (faction) stmts.updateFaction.run(faction, username);
  stmts.updateBio.run(safeBio, safeStatus, username);
  res.json(stmts.getProfile.get(username));
});

app.get('/api/leaderboard', requireAuth, (req, res) => {
  res.json(stmts.topKarma.all());
});

// ── Posts ────────────────────────────────────────────────────────────────────
app.get('/api/posts', requireAuth, (req, res) => {
  const board = req.query.board || 'main';
  if (!VALID_BOARDS.has(board)) return res.status(400).json({ error: 'Invalid board' });
  res.json(stmts.boardPosts.all(board));
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { board = 'main', title, author, content, poll } = req.body || {};
  if (!title || !author || !content) return res.status(400).json({ error: 'Missing fields' });
  if (!VALID_BOARDS.has(board)) return res.status(400).json({ error: 'Invalid board' });
  const info = stmts.insertPost.run(board, title, author, content);
  stmts.bumpPostCount.run(author);

  if (poll && poll.question && Array.isArray(poll.options) && poll.options.length >= 2) {
    const opts = poll.options.slice(0, 6).map(s => String(s).trim().slice(0, 40)).filter(Boolean);
    if (opts.length >= 2) {
      stmts.insertPoll.run(info.lastInsertRowid, String(poll.question).slice(0, 120), JSON.stringify(opts));
    }
  }

  const post = stmts.getPost.get(info.lastInsertRowid);
  post.has_poll = !!stmts.pollForPost.get(info.lastInsertRowid);
  io.to('bbs').emit('new_post', post);
  res.json(post);
});

app.get('/api/posts/:id', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  stmts.incrementViews.run(post.id);
  const replies   = stmts.getReplies.all(post.id);
  const reactions = stmts.getReactions.all(post.id);
  const poll      = stmts.pollForPost.get(post.id);
  let pollData = null;
  if (poll) {
    pollData = {
      id: poll.id,
      question: poll.question,
      options: JSON.parse(poll.options),
      votes: stmts.pollVotes.all(poll.id).reduce((a,v) => (a[v.option_idx]=v.n, a), {}),
    };
  }
  res.json({ ...post, replies, reactions, poll: pollData });
});

app.post('/api/posts/:id/reply', requireAuth, (req, res) => {
  const post = stmts.getPost.get(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Not found' });
  const { author, content } = req.body || {};
  if (!author || !content) return res.status(400).json({ error: 'Missing fields' });
  const info  = stmts.insertReply.run(post.id, author, content);
  const reply = { id: info.lastInsertRowid, post_id: post.id, author, content, created_at: Math.floor(Date.now() / 1000) };

  // Notify original post author
  if (post.author !== author) {
    stmts.insertNotif.run(post.author, 'reply', author, String(content).slice(0, 80), 'forum', post.id);
    emitNotif(post.author);
  }
  // Notify mentions
  extractMentions(content).forEach(u => {
    if (u !== author && u !== post.author) {
      stmts.insertNotif.run(u, 'mention', author, String(content).slice(0, 80), 'forum', post.id);
      emitNotif(u);
    }
  });
  stmts.bumpKarma.run(post.author, 1);

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
  stmts.bumpKarma.run(post.author, 1);
  const reactions = stmts.getReactions.all(id);
  io.to('bbs').emit('post_reacted', { post_id: id, reactions });
  res.json({ reactions });
});

// ── Polls ────────────────────────────────────────────────────────────────────
app.post('/api/polls/:id/vote', requireAuth, (req, res) => {
  const id  = Number(req.params.id);
  const { voter, option_idx } = req.body || {};
  if (!voter || typeof option_idx !== 'number') return res.status(400).json({ error: 'Missing fields' });
  const poll = db.prepare('SELECT * FROM polls WHERE id=?').get(id);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  const opts = JSON.parse(poll.options);
  if (option_idx < 0 || option_idx >= opts.length) return res.status(400).json({ error: 'Bad option' });
  stmts.upsertVote.run(id, voter, option_idx);
  const votes = stmts.pollVotes.all(id).reduce((a,v) => (a[v.option_idx]=v.n, a), {});
  io.to('bbs').emit('poll_updated', { poll_id: id, post_id: poll.post_id, votes });
  res.json({ votes });
});

// ── Admin ────────────────────────────────────────────────────────────────────
app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM replies WHERE post_id=?').run(id);
  db.prepare('DELETE FROM post_reactions WHERE post_id=?').run(id);
  db.prepare('DELETE FROM polls WHERE post_id=?').run(id);
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

app.post('/api/admin/incident', requireAdmin, (req, res) => {
  const { kind = 'custom', title, body, location, severity = 2 } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Missing fields' });
  triggerIncident(kind, title, body, location, severity);
  res.json({ ok: true });
});

// ── Search ───────────────────────────────────────────────────────────────────
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

// ── Sightings ────────────────────────────────────────────────────────────────
app.get('/api/sightings', requireAuth, (req, res) => {
  res.json(stmts.getSightings.all());
});

app.post('/api/sightings', requireAuth, (req, res) => {
  const { user, text, location } = req.body || {};
  if (!user || !text) return res.status(400).json({ error: 'Missing fields' });
  const sanitized = String(text).trim().slice(0, 500);
  if (!sanitized) return res.status(400).json({ error: 'Empty text' });
  const loc = location && VALID_LOCATIONS.has(location) ? location : null;
  const info = stmts.insertSighting.run(String(user).trim().slice(0, 24), sanitized, loc);
  const sighting = stmts.getSighting.get(info.lastInsertRowid);
  io.to('bbs').emit('new_sighting', sighting);
  res.json(sighting);
});

// ── Map / Drops ──────────────────────────────────────────────────────────────
app.get('/api/map', requireAuth, (req, res) => {
  const sightings = stmts.getSightings.all().filter(s => s.location);
  const dropCounts = stmts.allActiveDrops.all().reduce((a, r) => (a[r.location] = r.n, a), {});
  res.json({ sightings, dropCounts });
});

app.get('/api/drops/:location', requireAuth, (req, res) => {
  const loc = String(req.params.location);
  if (!VALID_LOCATIONS.has(loc)) return res.status(400).json({ error: 'Invalid location' });
  res.json(stmts.dropsAtLoc.all(loc));
});

app.post('/api/drops', requireAuth, (req, res) => {
  const { user, location, text, ttl } = req.body || {};
  if (!user || !text || !location) return res.status(400).json({ error: 'Missing fields' });
  if (!VALID_LOCATIONS.has(location)) return res.status(400).json({ error: 'Invalid location' });
  const sanitized = String(text).trim().slice(0, 400);
  const ttlSec    = Math.min(86400, Math.max(3600, Number(ttl) || 86400));
  stmts.insertDrop.run(String(user).trim().slice(0,24), location, sanitized, ttlSec);
  io.to('bbs').emit('drop_added', { location });
  res.json({ ok: true });
});

// ── DMs ──────────────────────────────────────────────────────────────────────
app.get('/api/dms/conversations', requireAuth, (req, res) => {
  const me = String(req.query.me || '').trim();
  if (!me) return res.json([]);
  res.json(stmts.dmConversations.all(me));
});

app.get('/api/dms/:user', requireAuth, (req, res) => {
  const me    = String(req.query.me || '').trim();
  const other = String(req.params.user).trim();
  if (!me || !other) return res.json([]);
  const msgs = stmts.dmsForUser.all(me, other, other, me);
  stmts.markDMSeen.run(me, other);
  res.json(msgs);
});

// ── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications', requireAuth, (req, res) => {
  const me = String(req.query.me || '').trim();
  if (!me) return res.json([]);
  res.json(stmts.listNotifs.all(me));
});

app.post('/api/notifications/seen', requireAuth, (req, res) => {
  const { me } = req.body || {};
  if (me) stmts.markNotifsSeen.run(String(me));
  res.json({ ok: true });
});

// ── Incidents ────────────────────────────────────────────────────────────────
app.get('/api/incidents', requireAuth, (req, res) => {
  res.json(stmts.recentIncidents.all());
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MENTIONS & NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function extractMentions(text) {
  const out = new Set();
  const re = /@([A-Za-z0-9_]{2,24})/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

function emitNotif(user) {
  const unread = stmts.notifUnread.get(user)?.n || 0;
  io.to('user:' + user).emit('notif_update', { unread });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INCIDENTS (AI-driven narrative events)
// ═══════════════════════════════════════════════════════════════════════════════

const INCIDENT_TEMPLATES = [
  { kind: 'black_rider', severity: 3,
    titles: ['BLACK RIDER SIGHTED', 'MOTORCYCLE // SILENT // SUNSHINE 60', 'THE HEADLESS ONE MOVES'],
    bodies: [
      'Unit reports silent black motorcycle heading south on Sunshine 60. No registration. No exhaust.',
      'Ring Road camera caught it again — 2 seconds of footage, 200kph, no driver visible.',
      'Multiple members reporting the rider near the station. She is out tonight.',
    ],
    locations: ['sunshine60', 'ring_road', 'east_exit'],
  },
  { kind: 'gang_movement', severity: 2,
    titles: ['COLOR MOVEMENT DETECTED', 'GROUP FORMING NEAR UNDERPASS', 'HEADS-UP: COLORED SCARVES MOVING'],
    bodies: [
      'Yellow scarves spotted forming up behind Animate. Twenty-plus. Move carefully.',
      'Blue colors moving fast through the underpass. Whatever this is, it\'s starting.',
      'Unknown group, uniform dark clothes, heading toward the east exit. Stay aware.',
    ],
    locations: ['animate_alley', 'underpass', 'east_exit'],
  },
  { kind: 'city_anomaly', severity: 2,
    titles: ['SIGNAL NOISE OVER DISTRICT', 'POWER FLICKER: IKEBUKURO GRID', 'SOMETHING FELT WRONG'],
    bodies: [
      'Half the billboards on Sunshine 60 went dark for 8 seconds. No explanation yet.',
      'Multiple BBS members reported static on their devices simultaneously at 23:14.',
      'A cold wind through a closed corridor. Members report it at the same time.',
    ],
    locations: ['sunshine60', 'rooftops', 'park'],
  },
  { kind: 'help_request', severity: 1,
    titles: ['MEMBER NEEDS ASSIST', 'URGENT // MEMBER CALL', 'REQUEST FOR BACKUP'],
    bodies: [
      'Member stranded near the west exit — no cash, no train. Anyone nearby?',
      'Lost kid near Animate Alley. Someone please check.',
      'A fellow Dollar just asked for a walk home through the underpass. Quiet, worried.',
    ],
    locations: ['west_exit', 'animate_alley', 'underpass'],
  },
  { kind: 'izaya_notice', severity: 2,
    titles: ['INFORMATION LEAK DETECTED', 'SOMEONE IS ASKING QUESTIONS', 'FILES HAVE MOVED'],
    bodies: [
      'Someone was asking about Dollars membership lists in Shinjuku. Be careful what you post.',
      'A list of handles is circulating. Assume nothing is private.',
      'He is watching again. The vending machine at west exit has eyes tonight.',
    ],
    locations: ['west_exit', 'east_exit', 'station_yard'],
  },
];

function pickFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function triggerIncident(kind, title, body, location, severity = 2) {
  stmts.insertIncident.run(kind, title, body, location || null, severity);
  const payload = {
    kind, title, body,
    location: location || null,
    severity,
    created_at: Math.floor(Date.now() / 1000),
  };
  io.emit('incident', payload);

  // System message in all rooms
  for (const room of VALID_ROOMS) {
    const sysText = `⚠ INCIDENT: ${title} — ${body}`;
    const info = stmts.insertMessage.run(room, 'SYSTEM', sysText, null, JSON.stringify({ incident: true, kind, severity }));
    const msg = {
      id: info.lastInsertRowid, room, user: 'SYSTEM', text: sysText,
      meta: JSON.stringify({ incident: true, kind, severity }),
      timestamp: Math.floor(Date.now() / 1000),
    };
    io.to('chat:' + room).emit('message', msg);
  }

  // Trigger AI reactions from relevant personas
  if (anthropic) {
    const reactors = Object.entries(PERSONAS)
      .filter(() => Math.random() < 0.45)
      .slice(0, 3);
    reactors.forEach(([name], idx) => {
      setTimeout(() => {
        generateIncidentReaction(name, title, body);
      }, 5000 + idx * 7000 + Math.random() * 5000);
    });
  }
}

async function generateIncidentReaction(characterName, title, body) {
  const persona = PERSONAS[characterName];
  if (!persona || !anthropic) return;
  const now = Date.now();
  if (now - persona.lastResponse < persona.cooldown / 2) return;
  persona.lastResponse = now;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      system: persona.system,
      messages: [{
        role: 'user',
        content: `An incident just happened on the Dollars BBS:\nTITLE: ${title}\nBODY: ${body}\n\nReact in-character with one short line (how this makes you feel, or a quick observation). No username prefix.`,
      }],
    });
    const raw = response.content[0]?.text?.trim();
    if (!raw) return;
    const clean = raw.replace(/^[A-Za-z0-9_]+:\s*/, '').trim().slice(0, 300);
    if (!clean) return;

    // Post to main room
    const room = 'main';
    const info = stmts.insertMessage.run(room, characterName, clean, null, null);
    io.to('chat:' + room).emit('message', {
      id: info.lastInsertRowid, room, user: characterName, text: clean, timestamp: Math.floor(Date.now()/1000),
    });
  } catch (err) {
    if (err.status !== 429 && err.status !== 529) console.error('AI incident react:', err.message);
  }
}

function spawnRandomIncident() {
  const tpl = pickFrom(INCIDENT_TEMPLATES);
  const title = pickFrom(tpl.titles);
  const body  = pickFrom(tpl.bodies);
  const loc   = pickFrom(tpl.locations);
  triggerIncident(tpl.kind, title, body, loc, tpl.severity);
}

// Auto-spawn incidents every 15-35 min (only if people online)
setInterval(async () => {
  const sockets = await io.in('bbs').fetchSockets();
  const realUsers = sockets.map(s => s.username).filter(u => u && !AI_USERNAMES.has(u));
  if (realUsers.length === 0) return;
  if (Math.random() < 0.6) spawnRandomIncident();
}, (15 + Math.random() * 20) * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════════
//  CITY NEWS TICKER
// ═══════════════════════════════════════════════════════════════════════════════

const NEWS_HEADLINES = [
  '> IKEBUKURO STATION — crowd density NORMAL',
  '> WEATHER — partly cloudy, 18°C, wind 3m/s NE',
  '> TRAIN — Yamanote line running to schedule',
  '> ADVISORY — gang sightings elevated near east exit',
  '> BLACK RIDER — unconfirmed sighting ring road, 23:14',
  '> LOST ITEM — orange tabby, blue collar, reward offered',
  '> ANIMATE — new shipment expected Friday',
  '> NIGHT SHIFT — coin laundromat (Higashi) open, warm',
  '> IZAYA WATCH — unknown subject visible on CCTV',
  '> DOLLARS — member count 12,847 and rising',
  '> SIGNAL — satellite relay nominal, latency 42ms',
  '> MOOD — the city feels uneasy tonight',
  '> SUNSHINE 60 — billboards flickered at 23:08 (unexplained)',
  '> MISSING — requests for volunteer escorts: 3 open',
  '> FORECAST — light rain expected after midnight',
  '> POLICE BAND — quiet, no active calls',
  '> BROADCAST TOWER — all relays green',
  '> STATION YARD — unknown figure observed, no further report',
  '> DONATIONS — Dollars community fund: 3 contributions today',
  '> ENCRYPTION — key rotation complete, all members re-keyed',
];

// ═══════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

const EIGHT_BALL = [
  'Yes.', 'No.', 'Maybe.', 'Ask again later.', 'Certainly.',
  'Absolutely not.', 'The signs point to yes.', 'Doubtful.',
  'The headless one knows. You do not.', 'Without a doubt.',
  'Don\'t count on it.', 'Most likely.', 'Very doubtful.',
  'Signs point to yes.', 'The answer is in Ikebukuro.', 'Silence is the answer.',
];

const WEATHER_REPORTS = [
  'Light rain. 14°C. The streets shine.',
  'Clear. 17°C. Quiet wind from the west.',
  'Overcast. 15°C. The kind of grey that doesn\'t move.',
  'Humid. 22°C. Everyone is slow tonight.',
  'Dry cold. 9°C. Steam off the vents.',
  'Fog in the side streets. 12°C. Don\'t run.',
];

const BANNER_FONT = {
  A: ['  █  ', ' █ █ ', '█████', '█   █', '█   █'],
  B: ['████ ', '█   █', '████ ', '█   █', '████ '],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  F: ['█████', '█    ', '████ ', '█    ', '█    '],
  G: [' ████', '█    ', '█  ██', '█   █', ' ████'],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  J: ['█████', '    █', '    █', '█   █', ' ███ '],
  K: ['█   █', '█  █ ', '███  ', '█  █ ', '█   █'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  P: ['████ ', '█   █', '████ ', '█    ', '█    '],
  Q: [' ███ ', '█   █', '█ █ █', '█  █ ', ' ██ █'],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  V: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
  W: ['█   █', '█   █', '█ █ █', '██ ██', '█   █'],
  X: ['█   █', ' █ █ ', '  █  ', ' █ █ ', '█   █'],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  Z: ['█████', '   █ ', '  █  ', ' █   ', '█████'],
  ' ': ['     ','     ','     ','     ','     '],
  '0': [' ███ ', '█  ██', '█ █ █', '██  █', ' ███ '],
  '1': ['  █  ', ' ██  ', '  █  ', '  █  ', '█████'],
  '2': [' ███ ', '█   █', '   █ ', '  █  ', '█████'],
  '3': ['████ ', '    █', '  ██ ', '    █', '████ '],
  '4': ['█   █', '█   █', '█████', '    █', '    █'],
  '5': ['█████', '█    ', '████ ', '    █', '████ '],
  '6': [' ████', '█    ', '████ ', '█   █', ' ███ '],
  '7': ['█████', '    █', '   █ ', '  █  ', '  █  '],
  '8': [' ███ ', '█   █', ' ███ ', '█   █', ' ███ '],
  '9': [' ███ ', '█   █', ' ████', '    █', '████ '],
  '!': ['  █  ', '  █  ', '  █  ', '     ', '  █  '],
  '?': [' ███ ', '█   █', '   █ ', '     ', '  █  '],
};

function asciiBanner(text) {
  const s = String(text).toUpperCase().slice(0, 10);
  const lines = ['', '', '', '', ''];
  for (const ch of s) {
    const g = BANNER_FONT[ch] || BANNER_FONT[' '];
    for (let r = 0; r < 5; r++) lines[r] += g[r] + ' ';
  }
  return lines.join('\n');
}

// Parse a slash command. Returns { handled, replacement, systemText } or null if not a command.
// `replacement`: send this text as the user's normal message (after command transform)
// `systemText` : send this as a SYSTEM line in the room only
function parseSlash(text, username, room, socket) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  const rest = parts.join(' ');

  switch (cmd) {
    case 'me':
      if (!rest) return { handled: true, systemText: `* ${username} stands silent *` };
      return { handled: true, systemText: `* ${username} ${rest} *` };

    case 'shrug':
      return { handled: true, replacement: rest ? `${rest} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯' };

    case 'flip':
      return { handled: true, systemText: `🪙 ${username} flipped a coin: ${Math.random() < 0.5 ? 'HEADS' : 'TAILS'}` };

    case 'roll': {
      const max = Math.max(2, Math.min(9999, Number(rest) || 100));
      const n = 1 + Math.floor(Math.random() * max);
      return { handled: true, systemText: `🎲 ${username} rolled 1..${max}: ${n}` };
    }

    case '8ball':
    case 'eightball': {
      if (!rest) return { handled: true, systemText: `🎱 ask a question: /8ball will it rain tonight` };
      const ans = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
      return { handled: true, systemText: `🎱 ${username}: "${rest}" — ${ans}` };
    }

    case 'weather':
      return { handled: true, systemText: `🌆 IKEBUKURO WX: ${WEATHER_REPORTS[Math.floor(Math.random() * WEATHER_REPORTS.length)]}` };

    case 'time': {
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 3600000);
      return { handled: true, systemText: `⏱ JST ${String(jst.getUTCHours()).padStart(2,'0')}:${String(jst.getUTCMinutes()).padStart(2,'0')}` };
    }

    case 'ascii':
      if (!rest) return { handled: true, systemText: `/ascii <text>` };
      return { handled: true, replacement: '```\n' + asciiBanner(rest) + '\n```' };

    case 'w':
    case 'whisper': {
      if (!rest) return { handled: true, systemText: `/w <user> <message>` };
      const m = rest.match(/^(\S+)\s+(.+)$/);
      if (!m) return { handled: true, systemText: `/w <user> <message>` };
      const [, to, body] = m;
      stmts.insertDM.run(username, to, body);
      io.to('user:' + to).emit('dm', { from: username, to, text: body, created_at: Math.floor(Date.now()/1000) });
      io.to('user:' + username).emit('dm', { from: username, to, text: body, created_at: Math.floor(Date.now()/1000), echo: true });
      stmts.insertNotif.run(to, 'dm', username, String(body).slice(0, 80), null, null);
      emitNotif(to);
      return { handled: true, systemText: `→ whisper to ${to}: ${body}` };
    }

    case 'quote': {
      const id = Number(rest);
      if (!id) return { handled: true, systemText: `/quote <message-id>` };
      const orig = stmts.getMessage.get(id);
      if (!orig) return { handled: true, systemText: `quote: message not found` };
      return { handled: true, replacement: `> ${orig.user}: ${orig.text}` };
    }

    case 'help':
      return { handled: true, systemText:
        'COMMANDS: /me /shrug /flip /roll /8ball /weather /time /ascii /w /quote /help /who /np' };

    case 'who': {
      // List online usernames
      (async () => {
        const sockets = await io.in('bbs').fetchSockets();
        const users = [...new Set(sockets.map(s => s.username).filter(Boolean))];
        socket?.emit('message', {
          room, user: 'SYSTEM', text: `online (${users.length}): ${users.join(', ')}`,
          timestamp: Math.floor(Date.now()/1000),
          meta: JSON.stringify({ system: true, private: true }),
        });
      })();
      return { handled: true };
    }

    case 'np':
      // Now-playing / status poke
      return { handled: true, replacement: `♪ ${username} is listening to: ${rest || '[silence]'}` };

    default:
      return { handled: true, systemText: `unknown command: /${cmd} (try /help)` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HTTP + SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['x-auth-token', 'Access-Control-Allow-Private-Network'],
  },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

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

  socket.on('join', ({ username, faction }) => {
    socket.username = username;
    socket.join('user:' + username);
    if (faction && VALID_FACTIONS.has(faction)) {
      stmts.updateFaction.run(faction, username);
    }
    stmts.touchProfile.run(username);
    socket.to('bbs').emit('user_joined', { username });
    broadcastOnlineStats();

    // Welcome payload: unread notifs
    const unread = stmts.notifUnread.get(username)?.n || 0;
    socket.emit('notif_update', { unread });
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

  socket.on('chat_message', ({ text, reply_to }) => {
    if (!socket.username || !socket.currentRoom || typeof text !== 'string') return;
    const now = Date.now();
    if (socket.lastMsg && now - socket.lastMsg < 800) return;
    socket.lastMsg = now;
    const sanitized = text.trim().slice(0, 1000);
    if (!sanitized) return;

    // Slash command?
    const cmd = parseSlash(sanitized, socket.username, socket.currentRoom, socket);
    if (cmd?.handled) {
      if (cmd.systemText) {
        const info = stmts.insertMessage.run(socket.currentRoom, 'SYSTEM', cmd.systemText, null, JSON.stringify({ system: true }));
        io.to('chat:' + socket.currentRoom).emit('message', {
          id: info.lastInsertRowid, room: socket.currentRoom, user: 'SYSTEM', text: cmd.systemText,
          meta: JSON.stringify({ system: true }),
          timestamp: Math.floor(now / 1000),
        });
      }
      if (cmd.replacement) {
        const meta = reply_to ? JSON.stringify({ reply_to }) : null;
        const info = stmts.insertMessage.run(socket.currentRoom, socket.username, cmd.replacement, reply_to || null, meta);
        stmts.bumpMsgCount.run(socket.username);
        const msg = {
          id: info.lastInsertRowid, room: socket.currentRoom, user: socket.username, text: cmd.replacement,
          reply_to: reply_to || null, meta,
          timestamp: Math.floor(now / 1000),
        };
        io.to('chat:' + socket.currentRoom).emit('message', msg);
      }
      return;
    }

    const meta = reply_to ? JSON.stringify({ reply_to }) : null;
    const info = stmts.insertMessage.run(socket.currentRoom, socket.username, sanitized, reply_to || null, meta);
    stmts.bumpMsgCount.run(socket.username);
    const msg = {
      id: info.lastInsertRowid, room: socket.currentRoom, user: socket.username, text: sanitized,
      reply_to: reply_to || null, meta,
      timestamp: Math.floor(now / 1000),
    };
    io.to('chat:' + socket.currentRoom).emit('message', msg);

    // Mentions → notifs
    extractMentions(sanitized).forEach(u => {
      if (u !== socket.username) {
        stmts.insertNotif.run(u, 'mention', socket.username, sanitized.slice(0, 80), socket.currentRoom, info.lastInsertRowid);
        emitNotif(u);
      }
    });

    if (!AI_USERNAMES.has(socket.username)) {
      maybeTriggerAI(socket.currentRoom, sanitized, socket.username, 0);
    }
  });

  socket.on('dm_send', ({ to, text }) => {
    if (!socket.username || !to || !text) return;
    const now = Date.now();
    if (socket.lastDM && now - socket.lastDM < 500) return;
    socket.lastDM = now;
    const body = String(text).trim().slice(0, 1000);
    if (!body) return;
    stmts.insertDM.run(socket.username, to, body);
    const payload = { from: socket.username, to, text: body, created_at: Math.floor(now/1000) };
    io.to('user:' + to).emit('dm', payload);
    io.to('user:' + socket.username).emit('dm', { ...payload, echo: true });
    if (to !== socket.username) {
      stmts.insertNotif.run(to, 'dm', socket.username, body.slice(0, 80), null, null);
      emitNotif(to);
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

  socket.on('presence_ping', () => {
    if (socket.username) stmts.touchProfile.run(socket.username);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      socket.to('bbs').emit('user_left', { username: socket.username });
      stmts.touchProfile.run(socket.username);
    }
    if (socket.currentRoom) socket.leave('chat:' + socket.currentRoom);
    broadcastRoomCounts();
    broadcastOnlineStats();
  });
});

async function broadcastOnlineStats() {
  const sockets = await io.in('bbs').fetchSockets();
  const users   = [...new Set(sockets.map(s => s.username).filter(Boolean))];
  // Inject AI personas as "online" for narrative flavor
  const withAI  = [...users, ...AI_USERNAMES].filter((v, i, a) => a.indexOf(v) === i);
  io.emit('online_stats', { total: sockets.length, users: withAI });
}

async function broadcastRoomCounts() {
  const counts = {};
  for (const room of VALID_ROOMS) {
    const s = await io.in('chat:' + room).fetchSockets();
    counts[room] = s.length;
  }
  io.emit('room_counts', counts);
}

// News ticker: pick a headline every 40s and broadcast (client rotates)
setInterval(() => {
  const idx = Math.floor(Math.random() * NEWS_HEADLINES.length);
  io.emit('news_tick', { headline: NEWS_HEADLINES[idx], at: Math.floor(Date.now() / 1000) });
}, 40 * 1000);

// ═══════════════════════════════════════════════════════════════════════════════
//  AI (ambient responses)
// ═══════════════════════════════════════════════════════════════════════════════

async function maybeTriggerAI(room, text, fromUser, chainDepth) {
  if (!anthropic) return;
  if (chainDepth > 1) return;

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

    const cleanText = raw.replace(/^[A-Za-z0-9_]+:\s*/, '').trim().slice(0, 300);
    if (!cleanText) return;

    const info = stmts.insertMessage.run(room, characterName, cleanText, null, null);
    const msg = {
      id: info.lastInsertRowid, room, user: characterName, text: cleanText,
      timestamp: Math.floor(Date.now() / 1000),
    };
    io.to('chat:' + room).emit('message', msg);

    if (chainDepth === 0 && Math.random() < 0.20) {
      const chainDelay = 8000 + Math.random() * 12000;
      setTimeout(() => maybeTriggerAI(room, cleanText, characterName, chainDepth + 1), chainDelay);
    }
  } catch (err) {
    if (err.status !== 429 && err.status !== 529) {
      console.error(`AI [${characterName}]:`, err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════════════════

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║         DOLLARS BBS  v3.0             ║');
  console.log('║   — Ikebukuro Relay Node —            ║');
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
    console.log('  To enable AI characters in chat + incidents:');
    console.log('  1. Get a key: https://console.anthropic.com/');
    console.log('  2. Run: ANTHROPIC_API_KEY=sk-ant-... npm start');
    console.log('  ────────────────────────────────────────');
  }
  console.log('\n  Features: chat, forum, DMs, map, drops, incidents, polls, news ticker');
  console.log('  Share the Network URL with other devices on the same network.\n');
});
