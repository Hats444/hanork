'use strict';

const HanorkLogger = require('./HanorkLogger');
const { getLogConfig, detectEnvironment } = require('./config');
const { getMemory, getCpuLoad, getUptime, getBootIso } = require('./systemMetrics');
const { createBenchmark } = require('./benchmark');
const { renderBootBanner } = require('./banner');

const { installConsolePipeGuard } = require('./safeStreamWrite');

installConsolePipeGuard();

const instance = new HanorkLogger();

module.exports = instance;
module.exports.HanorkLogger = HanorkLogger;
module.exports.createLogger = () => new HanorkLogger();
module.exports.getLogConfig = getLogConfig;
module.exports.detectEnvironment = detectEnvironment;
module.exports.metrics = { getMemory, getCpuLoad, getUptime, getBootIso };
module.exports.renderBootBanner = renderBootBanner;
module.exports.printConsoleBanner = require('./banner').printConsoleBanner;
module.exports.printStartupBanner = require('./banner').printStartupBanner;
module.exports.createBenchmark = createBenchmark;
