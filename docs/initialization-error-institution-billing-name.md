# Initialization Error Resolution

The SANE agent wiring referenced an undefined variable named `institutionBillingService`.

The instantiated service is named `institutionalBillingService`.

The application wiring must pass it explicitly as:

```js
institutionBillingService: institutionalBillingService
```
