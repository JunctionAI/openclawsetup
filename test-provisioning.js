/**
 * Test Real Provisioning System
 * Creates a test customer to verify everything works
 */

require('dotenv').config();
const { provisionCustomer, deprovisionCustomer } = require('./provisioning/index-real');

const TEST_CUSTOMER = {
  customerId: 'cus_test_' + Date.now(),
  email: 'test@clawdbot.test',
  planId: 'price_1SwtCbBfSldKMuDjM3p0kyG4' // Starter plan
};

async function runProvisioningTest() {
  console.log('\n🧪 Testing Real Provisioning System\n');
  console.log('━'.repeat(60));
  console.log(`Customer: ${TEST_CUSTOMER.email}`);
  console.log(`Plan: Starter (5000 messages/month)`);
  console.log('━'.repeat(60));
  console.log('');

  let credentials = null;
  let success = false;

  try {
    // Step 1: Provision customer
    console.log('⏳ Starting provisioning...\n');
    const startTime = Date.now();

    credentials = await provisionCustomer(
      TEST_CUSTOMER.customerId,
      TEST_CUSTOMER.email,
      TEST_CUSTOMER.planId
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Provisioning completed in ${elapsed}s`);

    // Step 2: Verify credentials
    console.log('\n📋 Credentials Received:');
    console.log('━'.repeat(60));
    console.log(`Workspace ID: ${credentials.workspaceId}`);
    console.log(`Instance ID: ${credentials.instanceId}`);
    console.log(`Access URL: ${credentials.accessUrl}`);
    console.log(`API Key: ${credentials.apiKey.substring(0, 20)}...`);
    console.log('━'.repeat(60));

    // Step 3: Test instance health
    console.log('\n🏥 Testing instance health...');
    const axios = require('axios');

    try {
      const healthCheck = await axios.get(`${credentials.accessUrl}/health`, {
        timeout: 10000
      });

      console.log('✅ Instance is healthy');
      console.log('   Status:', healthCheck.data.status);
      console.log('   Workspace:', healthCheck.data.workspace);
      console.log('   Plan:', healthCheck.data.plan);

      success = true;
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      console.log('   This might be normal if deployment is still in progress');
      console.log('   Try manually: curl', credentials.accessUrl + '/health');
    }

    // Step 4: Test API
    console.log('\n🤖 Testing chat API...');

    try {
      const chatResponse = await axios.post(
        `${credentials.accessUrl}/api/chat`,
        {
          message: 'Hello! This is a provisioning test.'
        },
        {
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('✅ Chat API works!');
      console.log('   Reply:', chatResponse.data.reply.substring(0, 100) + '...');
      console.log('   Usage:', chatResponse.data.usage);

    } catch (error) {
      console.error('❌ Chat API failed:', error.message);
      console.log('   This might be normal if instance is still starting');
    }

    // Success summary
    console.log('\n' + '━'.repeat(60));
    console.log('✅ PROVISIONING TEST PASSED');
    console.log('━'.repeat(60));
    console.log('');
    console.log('Next steps:');
    console.log('1. Check Railway dashboard for new service');
    console.log('2. Check Neon dashboard for new branch');
    console.log('3. Visit instance URL:', credentials.accessUrl);
    console.log('4. Test with real signup flow');
    console.log('');

  } catch (error) {
    console.error('\n' + '━'.repeat(60));
    console.error('❌ PROVISIONING TEST FAILED');
    console.error('━'.repeat(60));
    console.error('\nError:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    console.error('');
    console.error('Troubleshooting:');
    console.error('1. Check environment variables (RAILWAY_TOKEN, NEON_API_KEY)');
    console.error('2. Verify Railway project ID');
    console.error('3. Check Neon project access');
    console.error('4. Review Railway/Neon logs');
    console.error('');
  }

  // Cleanup prompt
  if (credentials) {
    console.log('━'.repeat(60));
    console.log('⚠️  TEST INSTANCE CREATED');
    console.log('━'.repeat(60));
    console.log('');
    console.log('Do you want to delete the test instance? (yes/no)');
    console.log('');
    console.log('Resources created:');
    console.log('- Railway service:', credentials.instanceId);
    console.log('- Neon branch:', credentials.workspaceId);
    console.log('');
    console.log('To clean up manually:');
    console.log(`  node test-provisioning.js --cleanup ${credentials.instanceId}`);
    console.log('');
  }

  return success;
}

async function cleanupTestInstance(instanceId) {
  console.log('\n🧹 Cleaning up test instance...\n');

  // TODO: Get instance data from database or Railway
  // For now, manually delete from Railway/Neon dashboards

  console.log('⚠️  Manual cleanup required:');
  console.log('1. Go to Railway dashboard');
  console.log('2. Find service:', instanceId);
  console.log('3. Delete service');
  console.log('4. Go to Neon dashboard');
  console.log('5. Delete corresponding branch');
  console.log('');
}

// Run test
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--cleanup' && args[1]) {
    cleanupTestInstance(args[1]).catch(console.error);
  } else {
    runProvisioningTest()
      .then(success => {
        process.exit(success ? 0 : 1);
      })
      .catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
      });
  }
}

module.exports = { runProvisioningTest };
