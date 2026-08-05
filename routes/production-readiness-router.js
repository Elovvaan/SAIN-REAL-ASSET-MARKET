import express from 'express';

function staff(req) {
  const roles = String(req.get('x-sra-roles') || req.get('x-sra-role') || '').split(',').map((role) => role.trim().toUpperCase()).filter(Boolean);
  return roles.some((role) => ['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'AUDITOR'].includes(role));
}
function actorId(req) { return req.get('x-sra-actor-id') || req.body?.actorId || 'SRA_PLATFORM'; }

export function createProductionReadinessRouter({ readinessService, database }) {
  const router = express.Router();

  router.get('/readiness', async (_req, res) => { try { return res.json(await readinessService.assess()); } catch (error) { return res.status(500).json({ error: error.message, code: 'PRODUCTION_READINESS_FAILED' }); } });
  router.post('/internal-lifecycle/inspect', (req, res) => { try { return res.json(readinessService.inspectInternalLifecycle(req.body?.references || req.body || {})); } catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_INTERNAL_LIFECYCLE_INSPECTION_FAILED' }); } });
  router.post('/internal-lifecycle/ownership-recognitions', async (req, res) => { try { const result = await readinessService.recognizeOwnership(req.body || {}, actorId(req)); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_OWNERSHIP_RECOGNITION_FAILED' }); } });
  router.post('/internal-lifecycle/export-packages', async (req, res) => { try { const result = await readinessService.createExportPackage(req.body || {}, actorId(req)); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_EXPORT_PACKAGE_FAILED' }); } });
  router.get('/internal-lifecycle/export-packages', (req, res) => { try { return res.json(readinessService.listExportPackages({ state: req.query.state ? String(req.query.state).toUpperCase() : null, destinationClass: req.query.destinationClass ? String(req.query.destinationClass).toUpperCase() : null })); } catch (error) { return res.status(500).json({ error: error.message, code: 'SRA_EXPORT_PACKAGE_LIST_FAILED' }); } });
  router.get('/internal-lifecycle/export-packages/:exportPackageId', (req, res) => { const record = readinessService.getExportPackage(req.params.exportPackageId); if (!record) return res.status(404).json({ error: 'Export package not found.', code: 'SRA_EXPORT_PACKAGE_NOT_FOUND' }); return res.json(record); });
  router.get('/internal-lifecycle/export-packages/:exportPackageId/integrity', (req, res) => { const result = readinessService.verifyExportPackage(req.params.exportPackageId); return res.status(result.valid ? 200 : 409).json(result); });

  router.get('/products/status', (_req, res) => res.json(readinessService.productQualificationStatus()));
  router.get('/products', (req, res) => res.json({ products: readinessService.listProducts({ state: req.query.state || null, category: req.query.category || null }) }));
  router.get('/products/:productCode', (req, res) => { const product = readinessService.getProduct(req.params.productCode); if (!product) return res.status(404).json({ error: 'Product definition not found.', code: 'SRA_PRODUCT_NOT_FOUND' }); return res.json(product); });
  router.post('/products', async (req, res) => { try { return res.status(201).json(await readinessService.registerProduct(req.body || {}, actorId(req))); } catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_PRODUCT_REGISTRATION_FAILED' }); } });
  router.post('/products/qualifications/assess', (req, res) => { try { const result = readinessService.assessProduct(req.body || {}, actorId(req)); return res.status(result.passed ? 200 : 422).json(result); } catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_PRODUCT_ASSESSMENT_FAILED' }); } });
  router.post('/products/qualifications', async (req, res) => { try { const result = await readinessService.qualifyProduct(req.body || {}, actorId(req)); return res.status(result.created ? 201 : 200).json(result); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_PRODUCT_QUALIFICATION_FAILED' }); } });
  router.get('/products/qualifications/records', (req, res) => res.json({ qualifications: readinessService.listProductQualifications({ productCode: req.query.productCode || null, state: req.query.state || null }) }));
  router.get('/products/qualifications/records/:qualificationId', (req, res) => { const record = readinessService.getProductQualification(req.params.qualificationId); if (!record) return res.status(404).json({ error: 'Product qualification not found.', code: 'SRA_PRODUCT_QUALIFICATION_NOT_FOUND' }); return res.json(record); });

  router.get('/audit/events', async (req, res) => {
    if (!staff(req)) return res.status(403).json({ error: 'Audit access requires Platform Admin, Operations Admin, or Auditor role.', code: 'SRA_AUDIT_ROLE_REQUIRED' });
    try { return res.json({ records: await database.listAuditEvents({ actorId: req.query.actorId || null, eventType: req.query.eventType || null, objectType: req.query.objectType || null, objectId: req.query.objectId || null, since: req.query.since || null, limit: req.query.limit || 100 }) }); }
    catch (error) { return res.status(500).json({ error: error.message, code: 'SRA_AUDIT_QUERY_FAILED' }); }
  });
  router.get('/audit/summary', async (req, res) => { if (!staff(req)) return res.status(403).json({ error: 'Audit access requires Platform Admin, Operations Admin, or Auditor role.', code: 'SRA_AUDIT_ROLE_REQUIRED' }); try { return res.json(await database.auditSummary({ since: req.query.since || null })); } catch (error) { return res.status(500).json({ error: error.message, code: 'SRA_AUDIT_SUMMARY_FAILED' }); } });
  return router;
}
