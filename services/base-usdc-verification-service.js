const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEFAULT_BASE_RPC_URL = 'https://mainnet.base.org';
const DEFAULT_BASE_CHAIN_ID = 8453;
const DEFAULT_USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function normalizedAddress(value, field) {
  const address = String(value || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error(`${field} must be a valid EVM address.`);
  return address;
}

function normalizedHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(hash)) throw new Error('transactionHash must be a valid transaction hash.');
  return hash;
}

function hexNumber(value) {
  if (!value) return 0;
  return Number.parseInt(value, 16);
}

function topicAddress(topic) {
  return `0x${String(topic || '').slice(-40)}`.toLowerCase();
}

function unitsToDecimal(value, decimals = 6) {
  const units = BigInt(value || '0x0');
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const fraction = String(units % divisor).padStart(decimals, '0').replace(/0+$/, '');
  return Number(fraction ? `${whole}.${fraction}` : `${whole}`);
}

export class BaseUsdcVerificationService {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.BASE_RPC_URL || DEFAULT_BASE_RPC_URL;
    this.chainId = Number(options.chainId || process.env.BASE_CHAIN_ID || DEFAULT_BASE_CHAIN_ID);
    this.usdcContract = normalizedAddress(options.usdcContract || process.env.BASE_USDC_CONTRACT || DEFAULT_USDC_CONTRACT, 'USDC contract');
    this.minimumConfirmations = Number(options.minimumConfirmations || process.env.BASE_MINIMUM_CONFIRMATIONS || 2);
    this.fetch = options.fetch || globalThis.fetch;
  }

  async rpc(method, params = []) {
    const response = await this.fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!response.ok) throw new Error(`Base RPC request failed with HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'Base RPC request failed.');
    return payload.result;
  }

  async verifyTransfer(input) {
    const transactionHash = normalizedHash(input.transactionHash);
    const expectedRecipient = normalizedAddress(input.expectedRecipient, 'expectedRecipient');
    const expectedAmount = Number(input.expectedAmount);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) throw new Error('expectedAmount must be greater than zero.');

    const [chainIdHex, receipt, latestBlockHex] = await Promise.all([
      this.rpc('eth_chainId'),
      this.rpc('eth_getTransactionReceipt', [transactionHash]),
      this.rpc('eth_blockNumber')
    ]);

    if (hexNumber(chainIdHex) !== this.chainId) throw new Error(`RPC chain ID does not match configured Base chain ID ${this.chainId}.`);
    if (!receipt) return { verified: false, state: 'PENDING', reason: 'TRANSACTION_NOT_MINED', transactionHash };
    if (hexNumber(receipt.status) !== 1) return { verified: false, state: 'FAILED', reason: 'TRANSACTION_REVERTED', transactionHash };

    const transferLog = (receipt.logs || []).find((log) => {
      const topics = log.topics || [];
      return String(log.address || '').toLowerCase() === this.usdcContract
        && String(topics[0] || '').toLowerCase() === TRANSFER_TOPIC
        && topicAddress(topics[2]) === expectedRecipient;
    });
    if (!transferLog) return { verified: false, state: 'MISMATCH', reason: 'EXPECTED_USDC_TRANSFER_NOT_FOUND', transactionHash };

    const amount = unitsToDecimal(transferLog.data, 6);
    if (Math.abs(amount - expectedAmount) > 0.000001) {
      return { verified: false, state: 'MISMATCH', reason: 'AMOUNT_MISMATCH', transactionHash, amount, expectedAmount };
    }

    const blockNumber = hexNumber(receipt.blockNumber);
    const latestBlock = hexNumber(latestBlockHex);
    const confirmations = Math.max(0, latestBlock - blockNumber + 1);
    if (confirmations < this.minimumConfirmations) {
      return { verified: false, state: 'CONFIRMING', reason: 'INSUFFICIENT_CONFIRMATIONS', transactionHash, amount, confirmations, requiredConfirmations: this.minimumConfirmations };
    }

    return {
      verified: true,
      state: 'CONFIRMED',
      network: 'BASE',
      chainId: this.chainId,
      asset: 'USDC',
      tokenContract: this.usdcContract,
      transactionHash,
      blockNumber,
      confirmations,
      fromAddress: topicAddress(transferLog.topics?.[1]),
      toAddress: expectedRecipient,
      amount,
      verifiedAt: new Date().toISOString()
    };
  }
}

export const BASE_USDC_DEFAULTS = Object.freeze({
  rpcUrl: DEFAULT_BASE_RPC_URL,
  chainId: DEFAULT_BASE_CHAIN_ID,
  usdcContract: DEFAULT_USDC_CONTRACT,
  transferTopic: TRANSFER_TOPIC
});
