export async function billingAdmin(accessService) {
  const user = await accessService.createUser({ displayName: 'Billing Administrator', email: `billing-${Math.random()}@example.test`, password: 'BillingTest123!', capacities: ['PLATFORM_ADMIN'] });
  const { token } = await accessService.startSession(user);
  await accessService.switchRole(token, 'PLATFORM_ADMIN');
  return { Cookie: `sra_admin_session=${token}` };
}
