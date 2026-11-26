import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: ["**/.next/**", "**/node_modules/**", "**/out/**", "**/build/**", "next-env.d.ts", "public/**"],
  },
  {
    rules: {
      // Data-fetching effects legitimately update UI state after requests complete.
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]

export default eslintConfig
