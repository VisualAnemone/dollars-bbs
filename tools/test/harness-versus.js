// 2P and 4P versus: rounds, eliminations, overtime, match completion.
const { install, loadGame } = require('./dom-stub');
const h = install();
eval(loadGame(__dirname + '/../../public/gravity-guy.html'));

function playMatch(nKey, flippers, label) {
  h.key(nKey);
  if (h.vis('ov-title')) throw new Error('versus did not start');
  let rounds = 0, frames = 0;
  while (rounds < 30 && frames < 200000) {
    h.step(1); frames++;
    for (const [period, code] of flippers) if (frames % period === 0) h.key(code);
    if (h.vis('ov-round')) {
      rounds++;
      const title = h.text('round-title');
      console.log(`  [${label}] round ${rounds}: ${title}`);
      if (title.includes('MATCH')) {
        h.bumpTime(1000); h.tap(500);
        console.log(`  [${label}] back to title:`, h.vis('ov-title'));
        return;
      }
      h.bumpTime(1000); h.key('Enter');
      if (h.vis('ov-round')) throw new Error('next round failed');
    }
  }
  throw new Error('match never completed');
}

h.step(10);
playMatch('Digit2', [[35, 'KeyW'], [97, 'ArrowUp']], '2P');
h.step(10);
playMatch('Digit4', [[35, 'KeyW'], [55, 'ArrowUp'], [75, 'KeyB'], [97, 'KeyI']], '4P');
console.log('2P and 4P matches: OK');

// overtime sanity: two survivors way past 40s should get pushed to a result
h.key('Digit2');
h.step(175);
let frames = 0, over = false;
while (frames < 20000 && !over) {
  h.step(1); frames++;
  if (frames % 30 === 0) h.key('KeyW');
  if (frames % 34 === 0) h.key('ArrowUp');
  over = h.vis('ov-round');
}
console.log('overtime round resolved:', over, 'in', Math.round(frames / 60), 's');
