const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function parseDate(value, field) {
  const dateText = String(value || '').slice(0, 10);
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (!value || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) throw new Error(`${field} must be a valid date.`);
  return date;
}

function addMonths(date, months) {
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function buildMonthlyAmortizationSchedule({ principal, annualRatePercent, termMonths, firstPaymentDate, currency = 'USD' }) {
  const amount = Number(principal);
  if (annualRatePercent === null || annualRatePercent === undefined || String(annualRatePercent).trim() === '') throw new Error('Annual rate is required.');
  const rate = Number(annualRatePercent);
  const months = Number(termMonths);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Principal must be greater than zero.');
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Annual rate must be between 0 and 100 percent.');
  if (!Number.isInteger(months) || months < 1 || months > 600) throw new Error('Term must be a whole number of months from 1 to 600.');
  const firstDate = parseDate(firstPaymentDate, 'First payment date');
  const monthlyRate = rate / 1200;
  const regularPayment = cents(monthlyRate === 0
    ? amount / months
    : amount * monthlyRate / (1 - (1 + monthlyRate) ** -months));
  let balance = cents(amount);
  const payments = [];

  for (let paymentNumber = 1; paymentNumber <= months; paymentNumber += 1) {
    const interest = cents(balance * monthlyRate);
    const total = paymentNumber === months ? cents(balance + interest) : regularPayment;
    const principalPaid = cents(total - interest);
    balance = cents(Math.max(0, balance - principalPaid));
    payments.push({
      paymentNumber,
      dueDate: addMonths(firstDate, paymentNumber - 1),
      paymentAmount: total,
      principal: principalPaid,
      interest,
      endingBalance: balance,
      currency,
    });
  }

  return {
    method: 'FIXED_MONTHLY_AMORTIZATION',
    principal: cents(amount),
    currency,
    annualRatePercent: rate,
    termMonths: months,
    firstPaymentDate: payments[0].dueDate,
    maturityDate: payments.at(-1).dueDate,
    regularPaymentAmount: regularPayment,
    totalPayments: cents(payments.reduce((sum, payment) => sum + payment.paymentAmount, 0)),
    totalInterest: cents(payments.reduce((sum, payment) => sum + payment.interest, 0)),
    payments,
  };
}
