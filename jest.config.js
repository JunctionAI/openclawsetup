module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    'api/**/*.js',
    '*.js',
    '!jest.config.js',
    '!coverage/**',
    '!node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
  testTimeout: 10000,
};
