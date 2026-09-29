'use strict';
process.chdir('/home/vendetta/hanork');
const sqlite = require('./src/config/database-sqlite');
const db = sqlite.connect();
const { serviceDisplayLabel, platformDisplayLabel, subcategoryDisplayLabel, categoryBreadcrumb } = require('./src/modules/smm/services/displayLabelService');

const iptv = db.prepare("SELECT id, name, platform, subcategory, service_type, service_family FROM smm_services WHERE active=1 AND platform='IPTV' LIMIT 1").get();
const outros = db.prepare("SELECT id, name, platform, subcategory, service_type, service_family FROM smm_services WHERE active=1 AND platform='Outros' LIMIT 1").get();

console.log('IPTV label:', serviceDisplayLabel(iptv));
console.log('IPTV breadcrumb:', categoryBreadcrumb(iptv.platform, iptv.subcategory));
console.log('Platform Outros UI:', platformDisplayLabel('Outros'));
console.log('Sub Outros IPTV:', subcategoryDisplayLabel('Outros', 'IPTV'));
if (outros) console.log('Outros platform svc:', serviceDisplayLabel(outros));
