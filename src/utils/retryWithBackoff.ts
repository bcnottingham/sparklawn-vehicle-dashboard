/**
 * Retry utility with exponential backoff for API calls
 * Production-ready error handling for transient failures
 */

export interface RetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    retryableStatusCodes?: number[];
    onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    onRetry: () => {}
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
    const delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
    return Math.min(delay, options.maxDelayMs);
}

/**
 * Check if error is retryable
 */
function isRetryable(error: any, options: Required<RetryOptions>): boolean {
    // Network errors are always retryable
    if (error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED') {
        return true;
    }

    // Check HTTP status codes
    if (error.response?.status) {
        return options.retryableStatusCodes.includes(error.response.status);
    }

    // Check for specific error messages
    if (error.message) {
        const retryableMessages = [
            'timeout',
            'network',
            'ECONNRESET',
            'socket hang up',
            'Client network socket disconnected'
        ];
        return retryableMessages.some(msg =>
            error.message.toLowerCase().includes(msg.toLowerCase())
        );
    }

    return false;
}

/**
 * Retry an async function with exponential backoff
 *
 * @example
 * const data = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 5, initialDelayMs: 500 }
 * );
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Don't retry if this is the last attempt
            if (attempt > opts.maxRetries) {
                break;
            }

            // Don't retry if error is not retryable
            if (!isRetryable(error, opts)) {
                throw error;
            }

            // Calculate delay and log retry attempt
            const delay = calculateDelay(attempt, opts);
            console.warn(
                `⚠️ API call failed (attempt ${attempt}/${opts.maxRetries + 1}): ${error.message}. ` +
                `Retrying in ${delay}ms...`
            );

            // Call retry callback if provided
            opts.onRetry(attempt, error);

            // Wait before retrying
            await sleep(delay);
        }
    }

    // All retries exhausted
    if (lastError) {
        console.error(`❌ API call failed after ${opts.maxRetries + 1} attempts:`, lastError);
        throw lastError;
    }
    throw new Error('Retry failed with no error captured');
}

/**
 * Retry wrapper specifically for fetch requests
 * Automatically handles response status codes
 *
 * @example
 * const response = await retryFetch('https://api.example.com/data', {
 *   headers: { 'Authorization': 'Bearer token' }
 * });
 */
export async function retryFetch(
    url: string,
    init?: RequestInit,
    retryOptions?: RetryOptions
): Promise<Response> {
    return retryWithBackoff(
        async () => {
            const response = await fetch(url, init);

            // Throw error for retryable status codes
            if (!response.ok) {
                const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.response = response;
                throw error;
            }

            return response;
        },
        retryOptions
    );
}

/**
 * Retry wrapper for JSON API calls
 * Combines fetch retry with JSON parsing
 *
 * @example
 * const data = await retryFetchJSON<UserData>(
 *   'https://api.example.com/user/123',
 *   { headers: { 'Authorization': 'Bearer token' } }
 * );
 */
export async function retryFetchJSON<T>(
    url: string,
    init?: RequestInit,
    retryOptions?: RetryOptions
): Promise<T> {
    const response = await retryFetch(url, init, retryOptions);
    return response.json();
}

export default retryWithBackoff;
