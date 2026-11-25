// One retry timer per WhatsApp instance; never changes stored credentials.
class ConnectionRecovery {
    constructor(connect, onError) {
        this.connect = connect;
        this.onError = onError;
        this.attempts = 0;
        this.retryTimer = null;
        this.stableTimer = null;
        this.stopped = false;
    }

    schedule() {
        if (this.stopped || this.retryTimer) return null;
        this.markDisconnected();

        const attempt = ++this.attempts;
        const delay = Math.min(60000, 2000 * 2 ** Math.min(attempt - 1, 5));
        this.retryTimer = setTimeout(async () => {
            this.retryTimer = null;
            try {
                await this.connect();
            } catch (error) {
                this.onError(error);
                this.schedule();
            }
        }, delay);

        return { attempt, delay };
    }

    markConnected() {
        this.cancelRetry();
        this.markDisconnected();
        this.stableTimer = setTimeout(() => {
            this.attempts = 0;
            this.stableTimer = null;
        }, 30000);
    }

    markDisconnected() {
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = null;
    }

    cancelRetry() {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    resume() {
        this.stopped = false;
    }

    stop() {
        this.stopped = true;
        this.cancelRetry();
        this.markDisconnected();
    }
}

module.exports = ConnectionRecovery;
