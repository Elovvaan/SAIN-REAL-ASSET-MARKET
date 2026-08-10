export async function installTreasuryTransferReadinessRoutes() {
  return {
    status() {
      return { transferCount: 0 };
    },
  };
}
