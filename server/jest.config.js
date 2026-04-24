module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  coverageReporters: ['text', 'lcov', 'cobertura'],
  coverageDirectory: '../coverage', // Output coverage reports to the root-level 'coverage' directory
  collectCoverageFrom: [
    '**/*.js',
    '!node_modules/**',
    '!jest.config.js',
    '!eslint.config.mjs',
    '!server.js'
  ],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '..',  // Output jest-results.xml to the root directory for Jenkins to archive
        outputName: 'jest-results.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}'
      }
    ]
  ]
};
