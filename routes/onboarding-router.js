import { Router } from 'express';
import multer from 'multer';
import { AssetOnboardingService } from '../services/asset-onboarding-service.js';
import { PrivateDocumentService } from '../services/private-document-service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

export function createOnboardingRouter(domainStore, database = null) {
  const router = Router();
  const documentService = new PrivateDocumentService({ database });
  const service = new AssetOnboardingService(domainStore, documentService);

  router.get('/configuration', (_req, res) => res.json(service.getConfiguration()));
  router.get('/applications', (_req, res) => res.json({ applications: service.listApplications() }));
  router.get('/documents', async (_req, res) => {
    await documentService.initialize();
    res.json({ documents: documentService.listMetadata() });
  });
  router.get('/documents/:documentId', async (req, res) => {
    await documentService.initialize();
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
  router.post('/assets', (req, res) => {
    try {
      const result = service.onboard(req.body);
      if (!result.ok) return res.status(400).json(result);
      return res.status(201).json(result);
    } catch (error) {
      console.error('Asset onboarding failed:', error);
      return res.status(500).json({ ok: false, errors: ['Asset onboarding could not be completed.'] });
    }
  });
  return router;
}
