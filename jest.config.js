// eslint-disable-next-line @typescript-eslint/no-require-imports -- archivo de config de Node, no bundleado por Next
const nextJest = require("next/jest")

const createJestConfig = nextJest({ dir: "./" })

const customJestConfig = {
  testEnvironment: "node",
  moduleDirectories: ["node_modules", "<rootDir>/"],
  // Un import normal "@/lib/x" lo reescribe el compilador de Next (SWC) antes de que Jest lo vea,
  // pero jest.mock("@/lib/x") pasa un string literal que Jest tiene que resolver por su cuenta —
  // sin este mapper, jest.mock() con alias no encuentra el módulo (a diferencia de un import común).
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // /e2e usa Playwright (*.spec.ts), no Jest -- Jest matchea *.spec.ts por default y sin este
  // ignore intenta correrlos igual, chocando con el runner de Playwright (ver CLAUDE.md → Tests E2E).
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/", "<rootDir>/e2e/"],
}

module.exports = createJestConfig(customJestConfig)
