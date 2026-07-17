// Render real gameplay frames to PNG via @napi-rs/canvas.
// Usage: node render-shots.js [outdir]
const { createCanvas } = require('/tmp/node_modules/@napi-rs/canvas');
const fs = require('fs');
const { install, loadGame } = require('./dom-stub');

const out = process.argv[2] || '/tmp';
const real = createCanvas(960, 540);
const h = install({
  ctx2d: real.getContext('2d'),
  createElement: () => createCanvas(1, 1),
});
eval(loadGame(__dirname + '/../../public/gravity-guy.html'));

const snap = name => fs.writeFileSync(`${out}/shot-${name}.png`, real.toBuffer('image/png'));

h.step(300); snap('attract');
h.key('Digit1');
h.step(30); snap('countdown');
h.step(160 + 180); snap('run');
h.key('Space'); h.step(9); snap('flip');
for (let s = 0; s < 2200; s++) { h.step(1); if (s % 38 === 0) h.key('Space'); if (h.vis('ov-dead')) break; }
snap('late');
console.log('shots written to', out);
