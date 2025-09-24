
function calculateRetryDelay(error, attempt) {
  if (!error || typeof error.status !== 'number') {
    return 1000;
  }

  switch (error.status) {
    case 429: // Quota Exceeded
      // Exponential backoff: 1000ms * 2^attempt, with a max of 30000ms
      return Math.min(1000 * Math.pow(2, attempt), 30000);

    case 503: // Service Unavailable
      // Randomized delay to prevent thundering herd: 1000ms * (1 + random)
      return 1000 * (1 + Math.random());

    case 504: // Gateway Timeout
      // Linear backoff: 1000ms * attempt
      return 1000 * attempt;

    default: // All other errors
      // Fixed base delay
      return 1000;
  }
}

class AdaptiveTimeout {
  constructor(initialTimeout = 180000, maxTimeout = 600000) {
    this.initialTimeout = initialTimeout;
    this.maxTimeout = maxTimeout;
    this.currentTimeout = this.initialTimeout;
  }

  getTimeout() {
    return this.currentTimeout;
  }

  increaseTimeout() {
    this.currentTimeout = Math.min(this.currentTimeout * 1.2, this.maxTimeout);
  }

  decreaseTimeout() {
    this.currentTimeout = Math.max(this.currentTimeout * 0.9, this.initialTimeout);
  }

  resetTimeout() {
    this.currentTimeout = this.initialTimeout;
  }
}


function sendAlert(message) {
  console.log(`[ALERT] ${message}`);
}

class ErrorTracker {
  constructor() {
    this.errorStats = {};
  }

  trackError(error) {
    const status = error && error.status ? error.status : 'unknown';
    if (!this.errorStats[status]) {
      this.errorStats[status] = 0;
    }
    this.errorStats[status]++;

    if (status === 429 && this.errorStats[status] > 5) {
      sendAlert(`High rate of 429 errors detected. Count: ${this.errorStats[status]}`);
    }
  }
}

const errorTracker = new ErrorTracker();

module.exports = {
  calculateRetryDelay,
  AdaptiveTimeout,
  adaptiveTimeout,
  ErrorTracker,
  errorTracker,
};

