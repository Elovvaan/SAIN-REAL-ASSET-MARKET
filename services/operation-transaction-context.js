import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function currentOperationTransaction() {
  return storage.getStore() || null;
}

export function runWithOperationTransaction(context, callback) {
  return storage.run(context, callback);
}

export function operationQueryTarget(defaultPool) {
  return currentOperationTransaction()?.client || defaultPool;
}

export function afterOperationCommit(callback) {
  const context = currentOperationTransaction();
  if (!context) {
    callback();
    return;
  }
  context.afterCommit.push(callback);
}

export function afterOperationRollback(callback) {
  const context = currentOperationTransaction();
  if (!context) return;
  context.afterRollback.push(callback);
}
