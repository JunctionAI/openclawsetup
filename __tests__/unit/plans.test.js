/**
 * Unit Tests for Plans Module
 * Tests plan configuration, limits, and feature access
 */

const {
  PLANS,
  DEFAULT_PLAN_ID,
  getPlan,
  getPlanLimits,
  hasFeature,
  getAllPriceIds,
  isValidPriceId,
} = require('../../plans');

describe('Plans Module', () => {
  describe('PLANS constant', () => {
    it('should have all expected plans', () => {
      const planNames = Object.values(PLANS).map((p) => p.name);
      expect(planNames).toContain('Starter');
      expect(planNames).toContain('Pro');
      expect(planNames).toContain('Team');
    });

    it('should have valid message limits', () => {
      Object.values(PLANS).forEach((plan) => {
        expect(plan.messageLimit).toBeGreaterThan(0);
      });
    });

    it('should have valid agent limits', () => {
      Object.values(PLANS).forEach((plan) => {
        // -1 means unlimited, otherwise positive
        expect(plan.agents === -1 || plan.agents > 0).toBe(true);
      });
    });

    it('should have valid prices', () => {
      Object.values(PLANS).forEach((plan) => {
        expect(plan.priceMonthly).toBeGreaterThan(0);
      });
    });

    it('should have features array', () => {
      Object.values(PLANS).forEach((plan) => {
        expect(Array.isArray(plan.features)).toBe(true);
        expect(plan.features.length).toBeGreaterThan(0);
      });
    });

    // BUG CATCHER: Plan configuration consistency
    it('should have increasing message limits by tier', () => {
      const starter = Object.values(PLANS).find((p) => p.name === 'Starter');
      const pro = Object.values(PLANS).find((p) => p.name === 'Pro');
      const team = Object.values(PLANS).find((p) => p.name === 'Team');

      expect(starter.messageLimit).toBeLessThan(pro.messageLimit);
      expect(pro.messageLimit).toBeLessThan(team.messageLimit);
    });
  });

  describe('DEFAULT_PLAN_ID', () => {
    it('should be a valid price ID', () => {
      expect(isValidPriceId(DEFAULT_PLAN_ID)).toBe(true);
    });

    it('should correspond to Starter plan', () => {
      const defaultPlan = getPlan(DEFAULT_PLAN_ID);
      expect(defaultPlan.name).toBe('Starter');
    });
  });

  describe('getPlan', () => {
    it('should return correct plan for valid price ID', () => {
      const priceIds = getAllPriceIds();
      priceIds.forEach((priceId) => {
        const plan = getPlan(priceId);
        expect(plan).toBeDefined();
        expect(plan.name).toBeDefined();
        expect(plan.messageLimit).toBeDefined();
      });
    });

    it('should return default plan for invalid price ID', () => {
      const plan = getPlan('invalid_price_id');
      expect(plan).toBeDefined();
      expect(plan.name).toBe('Starter'); // Falls back to default
    });

    it('should return default plan for null/undefined', () => {
      expect(getPlan(null).name).toBe('Starter');
      expect(getPlan(undefined).name).toBe('Starter');
    });
  });

  describe('getPlanLimits', () => {
    it('should return correct limits for Starter', () => {
      const limits = getPlanLimits('Starter');
      expect(limits.messagesPerMonth).toBe(5000);
      expect(limits.maxAgents).toBe(3);
    });

    it('should return correct limits for Pro', () => {
      const limits = getPlanLimits('Pro');
      expect(limits.messagesPerMonth).toBe(20000);
      expect(limits.maxAgents).toBe(10);
    });

    it('should return correct limits for Team', () => {
      const limits = getPlanLimits('Team');
      expect(limits.messagesPerMonth).toBe(100000);
      expect(limits.maxAgents).toBe(-1); // unlimited
    });

    it('should return default limits for unknown plan', () => {
      const limits = getPlanLimits('UnknownPlan');
      expect(limits.messagesPerMonth).toBe(5000);
      expect(limits.maxAgents).toBe(3);
    });

    // BUG CATCHER: Make sure limits can't be bypassed
    it('should not return negative message limits', () => {
      const planNames = ['Starter', 'Pro', 'Team', 'Unknown'];
      planNames.forEach((name) => {
        const limits = getPlanLimits(name);
        expect(limits.messagesPerMonth).toBeGreaterThan(0);
      });
    });
  });

  describe('hasFeature', () => {
    it('should return true for basic features on all plans', () => {
      expect(hasFeature('Starter', 'chat')).toBe(true);
      expect(hasFeature('Pro', 'chat')).toBe(true);
      expect(hasFeature('Team', 'chat')).toBe(true);
    });

    it('should return false for Pro features on Starter', () => {
      expect(hasFeature('Starter', 'gmail')).toBe(false);
      expect(hasFeature('Starter', 'browser')).toBe(false);
    });

    it('should return true for Pro features on Pro', () => {
      expect(hasFeature('Pro', 'gmail')).toBe(true);
      expect(hasFeature('Pro', 'browser')).toBe(true);
    });

    it('should return true for all features on Team (features: ["all"])', () => {
      const features = [
        'chat',
        'memory',
        'web_search',
        'gmail',
        'browser',
        'arbitrary_feature',
      ];
      features.forEach((feature) => {
        expect(hasFeature('Team', feature)).toBe(true);
      });
    });

    it('should return false for invalid plan name', () => {
      expect(hasFeature('InvalidPlan', 'chat')).toBe(false);
      expect(hasFeature(null, 'chat')).toBe(false);
    });

    // BUG CATCHER: Feature name case sensitivity
    it('should be case-sensitive for feature names', () => {
      // If the system stores features lowercase, uppercase should fail
      // This catches bugs where feature checks are inconsistent
      const starterFeatures = Object.values(PLANS).find(
        (p) => p.name === 'Starter'
      ).features;
      const actualFeature = starterFeatures[0];
      const wrongCase = actualFeature.toUpperCase();

      // The test documents expected behavior
      // If it fails, the code might have case-sensitivity bugs
      if (actualFeature !== wrongCase) {
        expect(hasFeature('Starter', wrongCase)).toBe(false);
      }
    });
  });

  describe('getAllPriceIds', () => {
    it('should return an array', () => {
      const priceIds = getAllPriceIds();
      expect(Array.isArray(priceIds)).toBe(true);
    });

    it('should return all price IDs from PLANS', () => {
      const priceIds = getAllPriceIds();
      expect(priceIds.length).toBe(Object.keys(PLANS).length);
    });

    it('should only contain valid Stripe price ID format', () => {
      const priceIds = getAllPriceIds();
      priceIds.forEach((priceId) => {
        expect(priceId).toMatch(/^price_[A-Za-z0-9]+$/);
      });
    });
  });

  describe('isValidPriceId', () => {
    it('should return true for valid price IDs', () => {
      const priceIds = getAllPriceIds();
      priceIds.forEach((priceId) => {
        expect(isValidPriceId(priceId)).toBe(true);
      });
    });

    it('should return false for invalid price IDs', () => {
      expect(isValidPriceId('invalid')).toBe(false);
      expect(isValidPriceId('price_fake')).toBe(false);
      expect(isValidPriceId('')).toBe(false);
      expect(isValidPriceId(null)).toBe(false);
    });

    // BUG CATCHER: Price ID manipulation
    it('should reject price IDs with modified characters', () => {
      const validPriceId = getAllPriceIds()[0];
      // Try modifying a character
      const modified = validPriceId.slice(0, -1) + 'X';
      expect(isValidPriceId(modified)).toBe(false);
    });
  });

  describe('Plan upgrade paths', () => {
    // BUG CATCHER: Ensure logical upgrade paths
    it('should have prices increasing with tier', () => {
      const starter = Object.values(PLANS).find((p) => p.name === 'Starter');
      const pro = Object.values(PLANS).find((p) => p.name === 'Pro');
      const team = Object.values(PLANS).find((p) => p.name === 'Team');

      expect(starter.priceMonthly).toBeLessThan(pro.priceMonthly);
      expect(pro.priceMonthly).toBeLessThan(team.priceMonthly);
    });

    it('should have increasing agents with tier', () => {
      const starter = Object.values(PLANS).find((p) => p.name === 'Starter');
      const pro = Object.values(PLANS).find((p) => p.name === 'Pro');
      const team = Object.values(PLANS).find((p) => p.name === 'Team');

      expect(starter.agents).toBeLessThan(pro.agents);
      // Team has -1 (unlimited) which is conceptually > any positive number
      expect(team.agents).toBe(-1);
    });

    it('should have trial days for all paid plans', () => {
      Object.values(PLANS).forEach((plan) => {
        expect(plan.trialDays).toBeDefined();
        expect(plan.trialDays).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
