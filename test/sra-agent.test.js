import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { SraAgentService } from '../services/sra-agent-service.js';

const domain = {
  snapshot: () => ({ counts: { ASSET_ACCOUNT: 1, PROJECT_ACCOUNT: 1 } }),
  get: () => null
};

const marketplace = {
  marketStatus: 'LIVE',
  verifiedValue: 735000,
  projectedMarketplaceGain: 107000,
  assets: [{ assetId: 'A-1042', name: 'North District Market', verifiedValue: 735000 }],
  projects: [{ projectId: 'SRA-RE-0021', title: 'Neighborhood Grocery Expansion', verifiedValue: 735000 }]
};

test('SRA agent builds platform context and calls the Responses API without write access', async () => {
  let captured = null;
  const fakeClient = {
    responses: {
      create: async (payload) => {
        captured = payload;
        return { id: 'resp_test', output_text: 'The marketplace is live with one recorded project.' };
      }
    }
  };

  const service = new SraAgentService({
    persistentDomain: domain,
    marketplace,
    client: fakeClient,
    model: 'test-model'
  });

  const result = await service.chat({
    message: 'What is happening in the marketplace?',
    scope: { activeView: 'marketplace', operatingTier: 'UNIVERSAL' }
  });

  assert.equal(result.agent, 'SANE');
  assert.equal(result.message, 'The marketplace is live with one recorded project.');
  assert.equal(result.writeAccess, 'DISABLED');
  assert.equal(result.approvalRequiredForStateChanges, true);
  assert.equal(captured.model, 'test-model');
  assert.match(captured.input[0].content[1].text, /North District Market/);
});

test('agent status endpoint reports runtime availability without exposing the API key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { app } = await createApp({ serveStatic: false, seedMarketplace: false });
    const status = await request(app).get('/api/sane/agent/status').expect(200);
    assert.equal(status.body.agent, 'SANE');
    assert.equal(status.body.available, false);
    assert.equal(status.body.writeAccess, 'DISABLED');
    assert.equal(Object.hasOwn(status.body, 'apiKey'), false);

    await request(app)
      .post('/api/sane/agent/chat')
      .send({ message: 'Explain Verified Value.' })
      .expect(503);
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});
