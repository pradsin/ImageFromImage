// src/handlers/gemini_handler.js
import BaseHandler from './base_handler.js';
import GeminiService from '../services/gemini_service.js';
import path from 'path';

class GeminiHandler extends BaseHandler {
    constructor(options, logger) {
        super(options, logger); // Sets this.options, this.logger, this.platformKey ('gemini')
        // Get ready selectors specific to Gemini for checks within this handler
        this.readySelectors = options.selectors?.[this.platformKey]?.readySelectors || [];
        if (this.readySelectors.length === 0) {
            this.logger.warn("No 'readySelectors' configured for Gemini handler readiness checks.");
        }
        // Instantiate service once
        this.geminiService = null;
    }

    /**
     * Processes a single image using the Gemini platform service on the provided reusable page,
     * WITHOUT navigating or reloading between images. Includes CAPTCHA checks.
     * @param {import('puppeteer').Page} page - The reusable Puppeteer page object.
     * @param {string} imagePath - Absolute path to the image file.
     * @param {string} prompt - The text prompt to use.
     * @returns {Promise<{success: boolean}>} Object indicating if an image was found in the response.
     */
    async processImage(page, imagePath, prompt) {
        const imageName = path.basename(imagePath);
        this.logger.info(`--- Starting Gemini processing for: ${imageName} (REUSING PAGE STATE) ---`);

        // Instantiate or update service reference
        if (!this.geminiService) {
            this.geminiService = new GeminiService(page, this.logger, this.options);
        }
        this.geminiService.page = page; // Ensure service has the correct page object

        try {
            // 1. <<< HANDLE POTENTIAL CAPTCHA / CHECK PAGE READINESS >>>
            // Actively check for known CAPTCHA elements first
            const captchaHandled = await this.handlePotentialCaptcha(page);
            // Passively wait if expected ready elements aren't visible (slow load/unknown blocker)
            await this.delayIfCaptcha(page, this.readySelectors);

            // 1b. Final readiness check after potential waits/CAPTCHA solving
            this.logger.info('Verifying page UI elements are present before interaction...');
            try {
                if (!this.readySelectors || this.readySelectors.length === 0) {
                    this.logger.warn("No 'readySelectors' to verify page state before processing.");
                } else {
                    await Promise.all(
                        this.readySelectors.map(selector =>
                            page.waitForSelector(selector, {visible: true, timeout: 15000}) // Give 15s
                        )
                    );
                    this.logger.info('Required UI elements confirmed ready.');
                }
            } catch (readyError) {
                this.logger.error(`Required UI elements not found for ${imageName}. Page might be stuck or state invalid. Skipping file.`, {error: readyError.message});
                await this.takeScreenshot(page, `error_handler_${this.platformKey}_not_ready_${imageName}`);
                return {success: false};
            }


            // 2. Perform core actions (upload, prompt, submit, wait)
            await this.geminiService.uploadImage(imagePath);
            await this.geminiService.enterPrompt(prompt);
            await this.geminiService.submit();
            const result = await this.geminiService.waitForResponse();

            this.logger.info(`--- Gemini processing finished for: ${imageName}. Success: ${result.success} ---`);

            return {success: result.success};

        } catch (error) {
            this.logger.error(`!!! Gemini Handler failed for ${imageName}: ${error.message}`, {stack: error.stack});
            // Use screenshot helper from BaseHandler
            await this.takeScreenshot(page, `error_handler_${this.platformKey}_${imageName}`);
            return {success: false}; // Indicate failure
        }
    }
}

export default GeminiHandler;