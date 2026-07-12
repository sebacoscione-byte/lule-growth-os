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
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
}

module.exports = createJestConfig(customJestConfig)
