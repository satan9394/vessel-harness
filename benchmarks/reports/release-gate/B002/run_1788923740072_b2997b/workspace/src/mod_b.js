const { needle_a1b2c3 } = require('./util.js');

function bootstrap() {
  return needle_a1b2c3({ scope: 'b' });
}
module.exports = { bootstrap };
