// Solo + daily flow: countdown, death, autopsy, retry cycles, pause, daily ghost.
const { install, loadGame } = require('./dom-stub');
const h = install();
eval(loadGame(__dirname + '/../../public/gravity-guy.html'));

h.step(1200);
console.log('attract 20s: OK');

h.key('Digit1');
h.key('Space');                       // ignored during countdown
h.step(170);
let died = false;
for (let f = 0; f < 3600 && !died; f++) { h.step(1); died = h.vis('ov-dead'); }
console.log('solo no-flip dies:', died, '|', h.text('dead-score'), '|', h.text('dead-stats'));
console.log('autopsy:', h.text('dead-autopsy'));

h.bumpTime(1000); h.tap(400);
let deaths = 0;
for (let s = 0; s < 7000; s++) {
  h.step(1);
  if (s % 38 === 0) h.key('Space');
  if (h.vis('ov-dead')) { deaths++; h.bumpTime(1000); h.key('Space'); }
}
console.log('flip/retry cycles:', deaths, 'deaths | best:', h.store().dollars_gg_best);

// back to title from dead, then DAILY twice (second run must have a ghost)
let guard = 0;
while (!h.vis('ov-dead') && guard++ < 20000) h.step(1);
h.bumpTime(1000); h.key('Backspace');
console.log('backspace to title:', h.vis('ov-title'));
h.key('Digit5');
h.step(175);
for (let f = 0; f < 5000 && !h.vis('ov-dead'); f++) { h.step(1); if (f % 45 === 0) h.key('Space'); }
const daily1 = JSON.parse(h.store().dollars_gg_daily);
console.log('daily #1:', h.text('dead-autopsy').includes('DAILY ATTEMPT #1'), '| ghost len:', (daily1.ghost || '').length);
h.bumpTime(1000); h.key('Space');     // retry daily -> ghost should now exist
h.step(200);
for (let f = 0; f < 5000 && !h.vis('ov-dead'); f++) { h.step(1); if (f % 40 === 0) h.key('Space'); }
const daily2 = JSON.parse(h.store().dollars_gg_daily);
console.log('daily #2 attempts:', daily2.attempts, '| profile runs:', JSON.parse(h.store().dollars_gg_profile).runs);

h.bumpTime(1000); h.key('Space'); h.step(20);
h.key('KeyP'); h.step(5); h.key('KeyP'); h.step(200);
h.key('KeyP'); h.step(5); h.key('KeyP'); h.step(5);
console.log('pause in countdown + play: OK');
