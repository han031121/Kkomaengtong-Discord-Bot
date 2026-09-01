export class AsyncKeyedLock {
    private readonly pendingOperations = new Map<string, Promise<unknown>>();

    public async runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previousOperation = this.pendingOperations.get(key) ?? Promise.resolve();
        const currentOperation = previousOperation.then(operation, operation);
        this.pendingOperations.set(key, currentOperation);

        try {
            return await currentOperation;
        } finally {
            if (this.pendingOperations.get(key) === currentOperation) {
                this.pendingOperations.delete(key);
            }
        }
    }
}
