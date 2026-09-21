import crypto from 'node:crypto';
import express from 'express';

function text(value) { return String(value ?? '').trim(); }
function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'PUBLIC_SRA_EXCHANGE_ERROR' });
}

export function createPublicSraExchangeRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => {
    try { return res.json(service.status()); }
    catch (error) { return handle(res, error); }
  });

  router.post('/quotes', async (req, res) => {
    try {
      const quoteId = `PHQ-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
      const quote = await service.quote({ quoteId, assetId: req.body?.assetId, sourceAddress: req.body?.sourceAddress, sellAmount: req.body?.sellAmount, slippageBps: req.body?.slippageBps });
      await service.domain.put('PUBLIC_HOLDER_EXCHANGE_QUOTE', quoteId, quote, { actorId: quote.sourceAddress, eventType: 'PUBLIC_HOLDER_SRA_USDC_QUOTED' });
      return res.status(201).json(quote);
    } catch (error) { return handle(res, error); }
  });

  router.post('/exchanges', async (req, res) => {
    const quoteId = text(req.body?.quoteId);
    try {
      if (!quoteId) throw new Error('quoteId is required.');
      if (!text(req.body?.signedXdr)) throw new Error('The wallet-signed transaction is required.');
      const quote = service.domain.get('PUBLIC_HOLDER_EXCHANGE_QUOTE', quoteId);
      if (!quote) throw Object.assign(new Error('The public exchange quote was not found.'), { code: 'PUBLIC_EXCHANGE_QUOTE_NOT_FOUND' });
      if (quote.state !== 'AWAITING_WALLET_SIGNATURE') throw new Error(`This exchange quote is ${quote.state || 'unavailable'}.`);
      const exchange = await service.submit(quote, req.body.signedXdr);
      const completedQuote = { ...quote, state: 'CONFIRMED', exchangeId: exchange.exchangeId, transactionId: exchange.transactionId, confirmedAt: exchange.confirmedAt };
      await service.domain.atomicPut([
        { type: 'PUBLIC_HOLDER_EXCHANGE_QUOTE', id: quoteId, payload: completedQuote, actorId: quote.sourceAddress, eventType: 'PUBLIC_HOLDER_SRA_USDC_QUOTE_COMPLETED' },
        { type: 'PUBLIC_HOLDER_EXCHANGE', id: exchange.exchangeId, payload: exchange, actorId: quote.sourceAddress, eventType: 'PUBLIC_HOLDER_SRA_USDC_CONFIRMED' },
      ]);
      return res.status(201).json(exchange);
    } catch (error) { return handle(res, error); }
  });

  return router;
}
