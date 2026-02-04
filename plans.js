/**
 * Clawdbot SaaS Plans Configuration
 * Single source of truth for plan definitions
 * 
 * PAT-001 fix: Deduplicate PLANS constant
 */

// Plan configurations mapped to Stripe price IDs
const PLANS = {
  // Starter Plan
  'price_1SwtCbBfSldKMuDjM3p0kyG4': {
    name: 'Starter',
    displayName: 'Starter',
    messageLimit: 5000,
    agents: 3,
    features: ['chat', 'memory', 'web_search'],
    priceMonthly: 29,
    trialDays: 14,
    description: 'Perfect for individuals getting started with AI automation'
  },
  
  // Pro Plan
  'price_1SwtCbBfSldKMuDjDmRHqErh': {
    name: 'Pro',
    displayName: 'Pro',
    messageLimit: 20000,
    agents: 10,
    features: ['chat', 'memory', 'web_search', 'gmail', 'calendar', 'browser'],
    priceMonthly: 79,
    trialDays: 14,
    description: 'For power users who need advanced integrations'
  },
  
  // Team Plan
  'price_1SwtCcBfSldKMuDjEKBqQ6lH': {
    name: 'Team',
    displayName: 'Team',
    messageLimit: 100000,
    agents: -1, // unlimited
    features: ['all'],
    priceMonthly: 199,
    trialDays: 14,
    description: 'For teams who want shared workspaces and unlimited agents'
  }
};

// Default plan if price ID not found
const DEFAULT_PLAN_ID = 'price_1SwtCbBfSldKMuDjM3p0kyG4';

/**
 * Get plan configuration by Stripe price ID
 * @param {string} priceId - Stripe price ID
 * @returns {object} Plan configuration
 */
function getPlan(priceId) {
  return PLANS[priceId] || PLANS[DEFAULT_PLAN_ID];
}

/**
 * Get plan limits for rate limiting
 * @param {string} planName - Plan name (Starter, Pro, Team)
 * @returns {object} Plan limits
 */
function getPlanLimits(planName) {
  const plan = Object.values(PLANS).find(p => p.name === planName);
  return plan ? {
    messagesPerMonth: plan.messageLimit,
    maxAgents: plan.agents
  } : {
    messagesPerMonth: 5000,
    maxAgents: 3
  };
}

/**
 * Check if a feature is available for a plan
 * @param {string} planName - Plan name
 * @param {string} feature - Feature name
 * @returns {boolean}
 */
function hasFeature(planName, feature) {
  const plan = Object.values(PLANS).find(p => p.name === planName);
  if (!plan) return false;
  return plan.features.includes('all') || plan.features.includes(feature);
}

/**
 * Get all price IDs
 * @returns {string[]}
 */
function getAllPriceIds() {
  return Object.keys(PLANS);
}

/**
 * Validate a price ID
 * @param {string} priceId
 * @returns {boolean}
 */
function isValidPriceId(priceId) {
  return priceId in PLANS;
}

module.exports = {
  PLANS,
  DEFAULT_PLAN_ID,
  getPlan,
  getPlanLimits,
  hasFeature,
  getAllPriceIds,
  isValidPriceId
};
