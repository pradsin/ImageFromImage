// src/handlers/base_handler.js
import path from 'path'; // Needed for potential screenshots inside captcha handler

/**
 * Abstract base class for platform-specific handlers.
 * Defines the contract for processing images and common utilities like CAPTCHA handling.
 */
class BaseHandler {
    constructor(options, logger) {
        if (this.constructor === BaseHandler) {
            throw new Error("Abstract class 'BaseHandler' cannot be instantiated directly.");
        }
        this.options = options;
        this.logger = logger;
        // Determine platform key (lowercase handler name without 'Handler') for accessing selectors
        this.platformKey = this.constructor.name.replace('Handler', '').toLowerCase();
        this.logger.debug(`${this.constructor.name} initialized for platform key: ${this.platformKey}`);
    }

    /**
     * Abstract method to process a single image on the target platform.
     * Must be implemented by subclasses.
     * @param {import('puppeteer').Page} page - The Puppeteer page object.
     * @param {string} imagePath - Absolute path to the image file.
     * @param {string} prompt - The text prompt to use.
     * @returns {Promise<{success: boolean}>} A promise resolving to an object indicating if the process succeeded (found image in response).
     * @throws {Error} If a critical error occurs during processing specific to this handler.
     */
    async processImage(page, imagePath, prompt) {
        throw new Error("Method 'processImage()' must be implemented by subclasses.");
    }

    /**
     * Actively checks for known CAPTCHA elements and pauses execution for manual solving.
     * Relies on `captchaSelectors` being defined in `config.js` for the specific platform.
     * Should be called early in the processImage flow, typically after navigation.
     * @param {import('puppeteer').Page} page - The Puppeteer page object.
     * @param {number} [checkTimeout=5000] - Timeout (ms) for the initial CAPTCHA check.
     * @param {number} [manualSolveWaitTimeMs=300000] - Milliseconds to wait for manual solving (default: 5 mins).
     * @returns {Promise<boolean>} True if a CAPTCHA was detected and waited for, false otherwise.
     */
    async handlePotentialCaptcha(page, checkTimeout = 5000, manualSolveWaitTimeMs = 300000) {
        const platformSelectors = this.options.selectors?.[this.platformKey];
        const captchaSelectors = platformSelectors?.captchaSelectors || []; // Get platform-specific captcha selectors
        const readySelectors = platformSelectors?.readySelectors || []; // Need ready selectors for post-captcha check

        if (!captchaSelectors || captchaSelectors.length === 0) {
            this.logger.debug(`No captchaSelectors configured for platform '${this.platformKey}'. Skipping active CAPTCHA check.`);
            return false; // Indicate no CAPTCHA handled
        }

        const captchaSelectorString = captchaSelectors.join(', ');
        this.logger.info(`Checking for known CAPTCHA elements (${captchaSelectorString})...`);

        try {
            // Use Promise.race to wait for EITHER the CAPTCHA or the ready selectors (if CAPTCHA doesn't appear quickly)
            // This avoids waiting the full checkTimeout if the page loads normally.
            await Promise.race([
                page.waitForSelector(captchaSelectorString, {visible: true, timeout: checkTimeout}),
                // If ready selectors appear first, assume no CAPTCHA
                page.waitForSelector(readySelectors.join(', '), {visible: true, timeout: checkTimeout})
            ]);

            // If the race didn't throw, check *which* selector was found
            const captchaElement = await page.$(captchaSelectorString);

            if (captchaElement) {
                this.logger.warn(`CAPTCHA detected! Please solve it manually in the browser window. Waiting for ${manualSolveWaitTimeMs / 1000} seconds...`);
                // Optional: Take a screenshot before waiting
                await this.takeScreenshot(page, `captcha_detected_${this.platformKey}`);

                // Pause execution - user solves it in the non-headless window
                await new Promise(resolve => setTimeout(resolve, manualSolveWaitTimeMs));
                this.logger.info('Resuming after manual CAPTCHA delay. Re-checking page readiness...');

                // Re-validate the page is usable after CAPTCHA using readySelectors
                if (readySelectors.length > 0) {
                    await page.waitForSelector(readySelectors.join(', '), {visible: true, timeout: 30000}); // Wait 30s for page to be ready after CAPTCHA
                    this.logger.info(`Page seems ready after CAPTCHA based on readySelectors: ${readySelectors.join(', ')}`);
                } else {
                    this.logger.warn("No readySelectors configured to verify page state after potential CAPTCHA.");
                }
                return true; // Indicate CAPTCHA was handled
            } else {
                // If readySelectors were found first by Promise.race
                this.logger.debug('Page ready selectors appeared before CAPTCHA check timed out. Assuming no CAPTCHA.');
                return false;
            }

        } catch (error) {
            // Timeout most likely means neither CAPTCHA nor ready selectors appeared quickly.
            if (error.name === 'TimeoutError') {
                this.logger.debug('No known CAPTCHA detected within the check period.');
            } else {
                this.logger.warn(`Error checking for CAPTCHA: ${error.message}`);
            }
            return false; // Indicate no CAPTCHA handled
        }
    }


    /**
     * Waits for a specified time if essential 'readySelectors' are NOT found quickly after navigation/action.
     * Infers a potential slow load or unknown blocker (could be an undetected CAPTCHA).
     * @param {import('puppeteer').Page} page - The Puppeteer page object.
     * @param {string[]} readySelectors - Selectors indicating the page is ready.
     * @param {number} [checkTimeout=5000] - Timeout (ms) for the initial check.
     * @param {number} [delayMs=this.options.waitTimeout] - Milliseconds to wait if check fails.
     */
    async delayIfCaptcha(page, readySelectors = [], checkTimeout = 5000, delayMs) {
        // This method remains separate - it's a fallback/slow-load handler
        const waitTime = delayMs || this.options.waitTimeout || 5000;

        if (!readySelectors || readySelectors.length === 0) {
            this.logger.debug("No readySelectors provided for 'delayIfCaptcha' check, skipping.");
            return;
        }

        const selectorString = readySelectors.join(', ');
        this.logger.info(`Checking if page seems ready (selectors: ${selectorString}, timeout: ${checkTimeout}ms)...`);

        try {
            await page.waitForSelector(selectorString, {visible: true, timeout: checkTimeout});
            this.logger.info('Page seems ready, proceeding without extra delay.');
        } catch (error) {
            if (error.name === 'TimeoutError') {
                this.logger.warn(`Ready selector(s) not found within ${checkTimeout}ms in 'delayIfCaptcha'. Assuming potential blocker or slow load. Waiting ${waitTime}ms.`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                this.logger.info("Wait finished after potential blocker/delay.");
            } else {
                this.logger.error(`Error checking for ready selectors in 'delayIfCaptcha': ${error.message}`, {stack: error.stack});
            }
        }
    }

    /** Simple delay function. */
    async delay(ms) {
        this.logger.debug(`Waiting for ${ms} ms...`);
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Helper to take screenshots on error/detection */
    async takeScreenshot(page, prefix = 'screenshot') {
        if (page && !page.isClosed()) {
            try {
                const screenshotPath = path.join(this.options.outputDir || '.', `${prefix}_${Date.now()}.png`);
                await page.screenshot({path: screenshotPath, fullPage: true});
                this.logger.info(`Screenshot saved to ${screenshotPath}`);
            } catch (ssError) {
                this.logger.error(`Failed to take screenshot (${prefix}): ${ssError.message}`);
            }
        }
    }
}

export default BaseHandler;