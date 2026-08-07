import { createAuthoritativeAssetRegistryRouter } from './routes/authoritative-asset-registry-router.js';
import { AuthoritativeAssetRegistryService } from './services/authoritative-asset-registry-service.js';

export function installAuthoritativeAssetRegistry(app, { persistentDomain, accessService }) {
  const authoritativeAssetRegistryService = new AuthoritativeAssetRegistryService(persistentDomain);
  app.use(
    '/api/authoritative-registry',
    createAuthoritativeAssetRegistryRouter(authoritativeAssetRegistryService, accessService),
  );
  return authoritativeAssetRegistryService;
}
