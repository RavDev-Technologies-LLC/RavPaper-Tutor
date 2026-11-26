---
name: Stripe sync backfill scope
description: Why Stripe initial synchronization must receive an explicit object scope.
---

Always pass an explicit object scope when running Stripe initial backfill, such as `object: "all"` or a specific object type. The installed sync package's no-argument path did not enter a valid backfill branch, even though startup logged that synchronization completed.

**Why:** The Stripe API account contained valid test products, but the app's synced catalog remained empty until the backfill scope was explicit.

**How to apply:** When provisioning or refreshing the Stripe sync database, specify the intended scope and verify that the expected product and price rows were actually imported. Keep provisioning restricted to development unless production changes are explicitly authorized.
