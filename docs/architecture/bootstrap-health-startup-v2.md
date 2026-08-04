# Bootstrap startup diagnostic

The process binds to Railway's assigned port before full platform initialization. `/api/health` remains reachable during startup, and `/api/startup` reports initialization state and errors.
