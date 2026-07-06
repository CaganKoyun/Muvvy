/** Unit + integration tests (default). E2E uses test/jest-e2e.json. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'node',
};
