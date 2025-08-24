const { pad2 } = require('../dist/lib/utils.cjs') || require('../src/lib/utils');

function assertEqual(a, b, msg) {
  if (a !== b) {
    console.error('FAIL:', msg, a, '!==', b);
    process.exit(1);
  }
}

console.log('Running pad2 tests...');
assertEqual(pad2(1), '01', 'pad2(1)');
assertEqual(pad2(10), '10', 'pad2(10)');
assertEqual(pad2(0), '00', 'pad2(0)');
console.log('OK');
