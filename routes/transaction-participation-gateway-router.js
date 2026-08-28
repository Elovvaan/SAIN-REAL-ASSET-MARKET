import { Router } from 'express';
import multer from 'multer';
import { PrivateDocumentService } from '../services/private-document-service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

function credentials(req) {
  return {
    packageReference: req.body?.packageReference || req.query?.packageReference || req.get('x-sra-package-reference'),
    windowId: req.body?.windowId || req.query?.windowId || req.get('x-sra-participation-window'),
    accessCode: req.body?.accessCode || req.query?.accessCode || req.get('x-sra-participation-code'),
  };
}

function failure(res, error) {
  const message = error?.message || String(error);
  const status = /not found/i.test(message) ? 404 : /access|expired|verified/i.test(message) ? 403 : 400;
  return res.status(status).json({ error: message });
}

export function createTransactionParticipationGatewayRouter(service, database = null) {
  const router = Router();
  const documents = new PrivateDocumentService({ database });

  router.post('/access', async (req, res) => {
    try {
      return res.json(await service.access(credentials(req)));
    } catch (error) {
      return failure(res, error);
    }
  });

  router.post('/receipt', async (req, res) => {
    try {
      return res.json(await service.confirmReceipt(credentials(req), req.body || {}));
    } catch (error) {
      return failure(res, error);
    }
  });

  router.post('/contact', async (req, res) => {
    try {
      return res.json(await service.identifyContact(credentials(req), req.body || {}));
    } catch (error) {
      return failure(res, error);
    }
  });

  router.post('/questions', async (req, res) => {
    try {
      return res.json(await service.askQuestion(credentials(req), req.body || {}));
    } catch (error) {
      return failure(res, error);
    }
  });

  router.post('/issues', async (req, res) => {
    try {
      return res.json(await service.reportIssue(credentials(req), req.body || {}));
    } catch (error) {
      return failure(res, error);
    }
  });

  router.post('/processing-confirmation', async (req, res) => {
    try {
      return res.json(await service.confirmProcessing(credentials(req), req.body || {}));
    } catch (error) {
      return failure(res, error);
    }
  });

  router.post('/documents', upload.single('document'), async (req, res) => {
    try {
      await service.ensureHydrated();
      const verified = service.authenticate(credentials(req));
      const documentType = String(req.body?.documentType || 'TRANSACTION_PARTICIPANT_DOCUMENT').toUpperCase();
      const stored = await documents.store({
        file: req.file,
        documentType,
        uploaderId: req.body?.contactName || verified.record.windowId,
        retentionPolicy: 'TRANSACTION_PARTICIPATION_EVIDENCE',
        retentionReferenceId: verified.pkg.exportPackageId,
      });
      if (!stored.ok) return res.status(400).json({ error: stored.error });
      const result = await service.recordDocument(credentials(req), stored.document, req.body || {});
      return res.status(201).json({ document: stored.document, ...result });
    } catch (error) {
      return failure(res, error);
    }
  });

  return router;
}
