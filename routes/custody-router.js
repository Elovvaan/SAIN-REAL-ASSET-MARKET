import { Router } from 'express';
import { InstitutionalCustodyService } from '../services/institutional-custody-service.js';

export function createCustodyRouter() {
  const router = Router();
  const service = new InstitutionalCustodyService();

  router.get('/', (_req, res) => res.json(service.snapshot()));
  router.get('/custody-records', (_req, res) => res.json({ records: service.snapshot().custodyRecords }));
  router.get('/collateral-schedules', (_req, res) => res.json({ schedules: service.snapshot().collateralSchedules }));
  router.get('/discharge-records', (_req, res) => res.json({ records: service.snapshot().dischargeRecords }));

  return router;
}
