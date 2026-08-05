import fs from 'node:fs';

const path = new URL('../server.js', import.meta.url);
let source = fs.readFileSync(path, 'utf8');
source = source.replace("import { authorizeOperationsRequest } from './middleware/operations-authorization.js';", "import { createServerSessionAuthorization } from './middleware/server-session-authorization.js';");
source = source.replace("bootstrap.use(authorizeOperationsRequest);\n", '');
source = source.replace("let productionReadinessService = null;", "let productionReadinessService = null;\nlet serverSessionAuthorization = null;");
source = source.replace("bootstrap.use(async (req, res, next) => {\n", "bootstrap.use(async (req, res, next) => {\n  if (serverSessionAuthorization) {\n    let completed = false;\n    await serverSessionAuthorization(req, res, () => { completed = true; });\n    if (!completed || res.headersSent) return;\n  }\n");
source = source.replace("database = created.database;\n", "database = created.database;\n  serverSessionAuthorization = createServerSessionAuthorization(created.accessService);\n");
fs.writeFileSync(path, source);
