// src/core/browser_factory.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply the stealth plugin to puppeteer-extra
puppeteer.use(StealthPlugin());

let browser = null;
let logger = null; // Logger instance passed during launch

/**
 * Launches a browser instance using puppeteer-extra with stealth plugin.
 * Includes increased protocolTimeout.
 * @param {object} options - Launch options (headless, args, viewport, timeouts, etc.)
 * @param {object} extLogger - Logger instance.
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchBrowser(options, extLogger) {
    logger = extLogger;
    if (browser) {
        logger?.warn('Browser already launched. Returning existing instance.');
        return browser;
    }

    logger?.info(`Launching browser with puppeteer-extra (Headless: ${options.headless})...`);
    // Set a longer timeout for underlying CDP communication, crucial for long AI generations
    const protocolTimeoutDuration = 600000; // 600,000ms = 10 minutes
    logger?.info(`Setting protocolTimeout to ${protocolTimeoutDuration}ms.`);

    const launchOptions = {
        headless: options.headless,
        args: options.browserArgs || [],
        defaultViewport: options.viewport || null, // Use null viewport from config if set
        timeout: options.navigationTimeout || 60000, // Initial connection/launch timeout
        protocolTimeout: protocolTimeoutDuration,   // Pass the increased protocolTimeout
        ignoreDefaultArgs: ['--enable-automation'],
    };

    if (options.userDataDir) {
        launchOptions.userDataDir = options.userDataDir;
        logger?.info(`Using User Data Directory: ${options.userDataDir}`);
    }

    try {
        // Use puppeteer-extra's launch method
        browser = await puppeteer.launch(launchOptions);
        logger?.info('Browser launched successfully using puppeteer-extra.');

        browser.on('disconnected', () => {
            logger?.warn('Browser disconnected.');
            browser = null; // Reset instance
            logger = null; // Clear logger ref
        });

        return browser;
    } catch (error) {
        logger?.error(`Failed to launch browser with puppeteer-extra: ${error.message}`, {stack: error.stack});
        throw error; // Re-throw to allow manager to handle
    }
}

/**
 * Creates a new page in the existing browser instance and configures timeouts.
 * @param {object} options - Options containing timeout values.
 * @returns {Promise<import('puppeteer').Page>}
 */
async function newPage(options) {
    if (!browser) {
        logger?.error('Browser not launched. Call launchBrowser first.');
        throw new Error('Browser not available');
    }
    try {
        const page = await browser.newPage();
        logger?.info('New page created.');

        // Set default timeouts for the page instance
        const navTimeout = options.navigationTimeout || 60000; // 60 seconds default
        const actTimeout = options.actionTimeout || 30000; // 30 seconds default
        page.setDefaultNavigationTimeout(navTimeout);
        page.setDefaultTimeout(actTimeout);

        // Corrected Debug Log - log the values we SET
        logger?.debug(`Page timeouts configured: Navigation=${navTimeout}, Action=${actTimeout}`);
        return page;
    } catch (error) {
        logger?.error(`Failed to create new page: ${error.message}`, {stack: error.stack});
        throw error;
    }
}

/**
 * Closes the browser instance if it's running.
 */
async function close() {
    if (browser) {
        logger?.info('Closing browser (puppeteer-extra)...');
        try {
            await browser.close();
            logger?.info('Browser closed successfully.');
        } catch (error) {
            logger?.error(`Error closing browser: ${error.message}`);
        } finally {
            browser = null; // Ensure reset
            logger = null; // Clear logger reference
        }
    } else {
        // Optional: log if close is called when no browser exists
        // logger?.warn('Attempted to close browser, but no instance was running.');
    }
}

// Export the public methods
export default {
    launchBrowser,
    newPage,
    close,
};