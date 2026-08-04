import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseUsdcVerificationService, BASE_USDC_DEFAULTS } from '../services/base-usdc-verification-service.js';

const txHash = `0x${'a'.repeat(64)}`;
const recipient = '0x1111111111111111111111111111111111111111';
const sender = '0x2222222222222222222222222222222222222222';
const padded = (address) => `0x${'0'.repeat(24)}${address.slice(2)}`;
const amountData = (amount) => `0x${BigInt(Math.round(amount * 1_000_000)).toString(16).padStart(64, '0')}`;

function rpcFetch(results) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result: results[request.method] }) };
  };
}

function receipt(amount = 100, to = recipient) {
  return {
    status: '0x1',
    blockNumber: '0x64',
    logs: [{
      address: BASE_USDC_DEFAULTS.usdcContract,
      topics: [BASE_USDC_DEFAULTS.transferTopic, padded(sender), padded(to)],
      data: amountData(amount)
    }]
  };
}

test('verifies a confirmed Base USDC transfer to the configured recipient', async () => {
  const service = new BaseUsdcVerificationService({
    minimumConfirmations: 2,
    fetch: rpcFetch({ eth_chainId: '0x2105', eth_getTransactionReceipt: receipt(), eth_blockNumber: '0x66' })
  });
  const result = await service.verifyTransfer({ transactionHash: txHash, expectedRecipient: recipient, expectedAmount: 100 });
  assert.equal(result.verified, true);
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.amount, 100);
  assert.equal(result.confirmations, 3);
  assert.equal(result.toAddress, recipient);
});

test('does not verify before the required confirmation count', async () => {
  const service = new BaseUsdcVerificationService({
    minimumConfirmations: 3,
    fetch: rpcFetch({ eth_chainId: '0x2105', eth_getTransactionReceipt: receipt(), eth_blockNumber: '0x64' })
  });
  const result = await service.verifyTransfer({ transactionHash: txHash, expectedRecipient: recipient, expectedAmount: 100 });
  assert.equal(result.verified, false);
  assert.equal(result.state, 'CONFIRMING');
  assert.equal(result.confirmations, 1);
});

test('rejects a transfer with the wrong amount or recipient', async () => {
  const wrongAmount = new BaseUsdcVerificationService({
    fetch: rpcFetch({ eth_chainId: '0x2105', eth_getTransactionReceipt: receipt(99), eth_blockNumber: '0x66' })
  });
  const amountResult = await wrongAmount.verifyTransfer({ transactionHash: txHash, expectedRecipient: recipient, expectedAmount: 100 });
  assert.equal(amountResult.reason, 'AMOUNT_MISMATCH');

  const wrongRecipient = new BaseUsdcVerificationService({
    fetch: rpcFetch({ eth_chainId: '0x2105', eth_getTransactionReceipt: receipt(100, sender), eth_blockNumber: '0x66' })
  });
  const recipientResult = await wrongRecipient.verifyTransfer({ transactionHash: txHash, expectedRecipient: recipient, expectedAmount: 100 });
  assert.equal(recipientResult.reason, 'EXPECTED_USDC_TRANSFER_NOT_FOUND');
});

test('returns pending when the transaction has not been mined', async () => {
  const service = new BaseUsdcVerificationService({
    fetch: rpcFetch({ eth_chainId: '0x2105', eth_getTransactionReceipt: null, eth_blockNumber: '0x66' })
  });
  const result = await service.verifyTransfer({ transactionHash: txHash, expectedRecipient: recipient, expectedAmount: 100 });
  assert.equal(result.state, 'PENDING');
  assert.equal(result.verified, false);
});
