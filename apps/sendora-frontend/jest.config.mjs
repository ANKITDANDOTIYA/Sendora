/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  transform: {
    // Use babel-jest to transpile ESM → CJS for route handler tests
    "^.+\\.js$": ["babel-jest", { configFile: "./babel.config.cjs" }],
  },
  // Map Next.js path aliases so Jest can resolve @/lib/...
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // Stub Next.js server utilities
    "^next/server$": "<rootDir>/__mocks__/next-server.js",
  },
};

export default config;
