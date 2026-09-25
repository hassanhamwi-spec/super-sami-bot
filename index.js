'use strict';
const gateway = require('./src/gateway');
if (require.main === module) gateway.start();
module.exports = gateway;
