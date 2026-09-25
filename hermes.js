'use strict';
// Legacy Render entry point. This gateway is not the Hermes Agent project.
const gateway = require('./src/gateway');
if (require.main === module) gateway.start();
module.exports = gateway;
