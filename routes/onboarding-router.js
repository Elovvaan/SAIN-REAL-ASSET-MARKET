import { Router } from 'express';
import multer from 'multer';
import { AssetOnboardingService } from '../services/asset-onboarding-service.js';
import { PrivateDocumentService } from '../services/private-document-service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

export async function createOnboardingRouter(domainStore, database = null, persistentDomain = null, accessService = null) {
  const router = Router();
  const documentService = new PrivateDocumentService({ database });
  await documentService.initialize();
  const service = new AssetOnboardingService(domainStore, documentService, persistentDomain);
  await service.initialize();

  function readCookie(req, name) {
    const entry = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
  }

  async function currentUserId(req) {
    const token = readCookie(req, 'sra_session');
    if (!token || !accessService) return null;
    return (await accessService.getSession(token))?.id || null;
  }

  router.get('/configuration', (_req, res) => res.json(service.getConfiguration()));
  router.get('/applications', (_req, res) => res.json({ applications: service.listApplications() }));
  router.get('/registered-assets', async (req, res) => {
    const actorId = await currentUserId(req);
    if (!actorId || !persistentDomain) return res.json({ assets: [] });
    await persistentDomain.hydrate(['ONBOARDING_APPLICATION', 'ASSET_ACCOUNT']);
    const applicationAssetIds = new Set(
      persistentDomain.list('ONBOARDING_APPLICATION')
        .filter((record) => record.submittedByUserId === actorId && record.status === 'ONBOARDED')
        .map((record) => record.permanentAssetId)
        .filter(Boolean)
    );
    const assets = persistentDomain.list('ASSET_ACCOUNT')
      .filter((record) => applicationAssetIds.has(record.assetId) && record.registrationState === 'REGISTERED')
      .map((record) => ({ assetId:record.assetId, name:record.name, classification:record.classification, region:record.region, status:record.status }));
    return res.json({ assets });
  });
  router.get('/documents', (_req, res) => res.json({ documents: documentService.listMetadata() }));
  router.get('/documents/:documentId', (req, res) => {
    const document = documentService.toPublicMetadata(documentService.get(req.params.documentId));
    if (!document) return res.status(404).json({ error: 'Private document record not found.' });
    return res.json({ document });
  });
  router.post('/documents', upload.array('documents', 10), async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ ok: false, errors: ['At least one document file is required.'] });
      const documentTypes = Array.isArray(req.body.documentTypes) ? req.body.documentTypes : req.body.documentTypes ? [req.body.documentTypes] : [];
      const stored = [];
      for (let index = 0; index < files.length; index += 1) {
        const result = await documentService.store({ file: files[index], documentType: documentTypes[index] || 'OTHER', uploaderId: req.body.uploaderId || null });
        if (!result.ok) return res.status(400).json({ ok: false, errors: [result.error] });
        stored.push(result.document);
      }
      return res.status(201).json({ ok: true, documents: stored, privacy: 'PRIVATE_EVIDENCE' });
    } catch (error) {
      console.error('Private document upload failed:', error);
      return res.status(500).json({ ok: false, errors: ['Private documents could not be uploaded.'] });
    }
  });
  router.post('/assets', async (req, res) => {
    try {
      const userId = await currentUserId(req);
      if (!userId) return res.status(401).json({ ok: false, errors: ['An active SRA account is required to submit asset onboarding.'] });
      const result = await service.onboard(req.body, { userId });
      if (!result.ok) return res.status(400).json(result);
      return res.status(201).json(result);
    } catch (error) {
      console.error('Asset onboarding failed:', error);
      return res.status(500).json({ ok: false, errors: ['Asset onboarding could not be completed.'] });
    }
  });
  return router;
}
