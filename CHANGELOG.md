# 0.1.1 (2026-05-18)

### Bug Fixes

- **preserve model types when applied:** rewrite `withForUpdate()` from the
  object form `Prisma.defineExtension({...})` to the closure form
  `Prisma.defineExtension((client) => client.$extends({...}))`. With the
  object form, calling `client.$extends(withForUpdate())` widened the
  extension's `extArgs` model parameter to `unknown`, which collapsed every
  generated model type in the extended client to `any`. The closure form
  preserves the consumer's concrete client type through the extension, so
  existing methods like `prisma.user.findMany()` keep their inferred
  `User[]` return type. Method implementations are unchanged.

# 0.1.0 (2026-05-15)
