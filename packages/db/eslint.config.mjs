// Strict, blocking lint — the standard for packages/* and future apps (DCS).
// apps/timesheet carries a relaxed config for inherited debt; new code follows this one.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...tseslint.configs.strict,
  {
    ignores: ['src/database.ts'], // generated file, never hand-edited
  }
)
