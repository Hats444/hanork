#!/usr/bin/env node
/**
 * Teste Rápido de Integração
 * Valida se todos os módulos carregam corretamente
 */

console.log('══════════════════════════════════════════');
console.log('  TESTE DE INTEGRAÇÃO - FASE 1');
console.log('══════════════════════════════════════════\n');

const tests = [];

// Test 1: Infra
tests.push(['DistributedLock', () => {
  const DistributedLock = require('./src/modules/infra/DistributedLock');
  return typeof DistributedLock.acquire === 'function';
}]);

tests.push(['TransactionManager', () => {
  const TransactionManager = require('./src/modules/infra/TransactionManager');
  return typeof TransactionManager.execute === 'function';
}]);

// Test 2: Delivery
tests.push(['SafeDeliveryService', () => {
  const SafeDeliveryService = require('./src/modules/delivery/SafeDeliveryService');
  return typeof SafeDeliveryService.deliverSafe === 'function';
}]);

tests.push(['DeliveryService', () => {
  const DeliveryService = require('./src/modules/delivery/DeliveryService');
  return typeof DeliveryService.deliver === 'function';
}]);

// Test 3: Payment
tests.push(['SafeWebhookHandler', () => {
  const SafeWebhookHandler = require('./src/modules/payment/SafeWebhookHandler');
  return typeof SafeWebhookHandler.processPayment === 'function';
}]);

tests.push(['PaymentService', () => {
  const PaymentService = require('./src/modules/payment/PaymentService');
  return typeof PaymentService.createPix === 'function';
}]);

// Test 4: Queue
tests.push(['QueueHardening', () => {
  const QueueHardening = require('./src/modules/queue/QueueHardening');
  return typeof QueueHardening.initHardenedQueue === 'function';
}]);

tests.push(['deliveryJob', () => {
  const { processDelivery } = require('./src/modules/queue/jobs/deliveryJob');
  return typeof processDelivery === 'function';
}]);

// Test 5: Cache
tests.push(['CacheInvalidator', () => {
  const CacheInvalidator = require('./src/modules/cache/CacheInvalidator');
  return typeof CacheInvalidator.invalidate === 'function';
}]);

tests.push(['CacheService', () => {
  const CacheService = require('./src/modules/cache/CacheService');
  return typeof CacheService.get === 'function';
}]);

// Run tests
let passed = 0;
let failed = 0;

for (const [name, testFn] of tests) {
  try {
    const result = testFn();
    if (result) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name} (retornou false)`);
      failed++;
    }
  } catch (e) {
    console.log(`❌ ${name}: ${e.message.split('\n')[0]}`);
    failed++;
  }
}

console.log('\n══════════════════════════════════════════');
console.log(`  RESULTADO: ${passed}/${tests.length} OK`);
console.log('══════════════════════════════════════════');

if (failed === 0) {
  console.log('\n🎉 TODOS OS MÓDULOS CARREGARAM CORRETAMENTE!');
  console.log('\nPróximo passo:');
  console.log('  cd ~/hanork && npm test  (ou pm2 restart all)');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${failed} módulo(s) com problema`);
  process.exit(1);
}
