# Bootstrap Health Startup

The Railway web process now binds to `PORT` before full platform initialization.

```text
Process starts
-> Bootstrap Express server binds to PORT
-> /api/health returns 200 with STARTING state
-> createApp initializes the platform
-> READY: requests are delegated to the full SRA app
-> FAILED: /api/startup exposes the initialization error
```

This prevents Railway from terminating the deployment before the application can report the real startup failure.

Endpoints during initialization:

```text
GET /api/health
GET /api/startup
```

The bootstrap layer does not hide initialization failures. It keeps the process reachable so the failure can be diagnosed and corrected.
