// src/handlers/chatgpt_handler.js
import BaseHandler from './base_handler.js';
import ChatGptService from '../services/chatgpt_service.js';
import path from 'path';

class ChatGptHandler extends BaseHandler {
    constructor(options, logger) {
        super(options, logger); // Sets this.options, this.logger, this.platformKey ('chatgpt')
        // Get ready selectors specific to ChatGPT for checks within this handler
        this.readySelectors = options.selectors?.[this.platformKey]?.readySelectors || [];
        if (this.readySelectors.length === 0) {
            this.logger.warn("No 'readySelectors' configured for ChatGPT handler readiness checks.");
        }
        // Instantiate service once
        this.chatgptService = null;
    }

    /**
     * Processes a single image submission. Uploads, enters prompt, waits for submit
     * button enable, checks success of *previous* prompt using image count,
     * and clicks submit. Includes retry logic for submit timeout.
     *
     * @param {import('puppeteer').Page} page - The reusable Puppeteer page object.
     * @param {string} imagePath - Absolute path to the image file.
     * @param {string} prompt - The text prompt to use.
     * @returns {Promise<{submitted: boolean, successStatusOfPrevious: boolean}>}
     * Object indicating if submission occurred for the *current* image and
     * the success status determined for the *previous* image.
     */
    async processImage(page, imagePath, prompt) {
        const imageName = path.basename(imagePath);
        this.logger.info(`--- Starting ChatGPT submission process for: ${imageName} (Delayed Check Flow) ---`);

        // Instantiate or update service reference
        if (!this.chatgptService) {
            this.chatgptService = new ChatGptService(page, this.logger, this.options);
        }
        this.chatgptService.page = page; // Ensure service always has the correct page object

        const maxRetries = 1; // Allow one retry attempt after reload on submit timeout
        let retryAttempt = 0;
        let successStatusOfPrevious = false; // Default status for previous image check
        let submitted = false; // Track if submit was clicked successfully for *this* image

        while (retryAttempt <= maxRetries) {
            if (retryAttempt > 0) {
                this.logger.warn(`--- RETRYING ChatGPT submission process for: ${imageName} (Attempt ${retryAttempt + 1}) ---`);
            }

            try {
                // 1. Check page readiness (quick check, important after potential reload)
                this.logger.info('Verifying page UI elements are present before interaction...');
                // Run CAPTCHA check first
                await this.handlePotentialCaptcha(page, 5000, 120000); // Quick check, 2 min wait if needed
                // Then check if page seems generally slow/stuck
                await this.delayIfCaptcha(page, this.readySelectors, 5000);

                // Final check for essential elements needed to start
                try {
                    if (this.readySelectors?.length > 0) {
                        await Promise.all(
                            this.readySelectors.map(selector =>
                                page.waitForSelector(selector, { visible: true, timeout: 15000 })
                            )
                        );
                        this.logger.info('Required UI elements confirmed ready.');
                    } else {
                        this.logger.warn("No readySelectors configured to verify page state.");
                    }
                } catch (readyError) {
                    this.logger.error(`UI elements not ready for ${imageName} (Attempt ${retryAttempt + 1}). Skipping file.`, { error: readyError.message });
                    await this.takeScreenshot(page, `error_handler_${this.platformKey}_not_ready_${imageName}`);
                    submitted = false; // Ensure submission is marked false
                    successStatusOfPrevious = false; // Assume previous failed if current fails here
                    break; // Exit retry loop for this file
                }

                // 2. Perform core actions: Upload, Prompt, checkPreviousAndSubmit
                await this.chatgptService.uploadImage(imagePath);
                await this.chatgptService.enterPrompt(prompt);

                // This service method now waits for enable, checks PREVIOUS success, updates count, clicks submit
                successStatusOfPrevious = await this.chatgptService.checkPreviousSuccessAndSubmit();
                submitted = true; // If checkPreviousAndSubmit didn't throw, submission occurred

                this.logger.info(`--- ChatGPT submission successful for: ${imageName}. ---`);
                break; // Exit the while loop on successful submission

            } catch (error) {
                this.logger.error(`!!! ChatGPT Handler failed on attempt ${retryAttempt + 1} for ${imageName}: ${error.message}`, { stack: (retryAttempt === maxRetries ? error.stack : undefined) });
                await this.takeScreenshot(page, `error_handler_${this.platformKey}_${imageName}_attempt${retryAttempt + 1}`);

                // Check if it was the specific submit button timeout error AND if retries are left
                if (error.message.includes('Submit button did not become enabled') && retryAttempt < maxRetries) {
                    retryAttempt++;
                    this.logger.warn(`Submit button timeout detected. Reloading page and attempting retry ${retryAttempt}...`);
                    try {
                        await page.reload({ waitUntil: 'networkidle2', timeout: this.options.navigationTimeout });
                        this.logger.info('Page reloaded successfully.');
                        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait after reload
                        // Loop will continue to the next iteration (retry attempt)
                        continue; // Go to next iteration of while loop
                    } catch (reloadError) {
                        this.logger.error(`Failed to reload page after submit timeout: ${reloadError.message}`);
                        submitted = false; // Mark as not submitted
                        successStatusOfPrevious = false; // Assume previous failed
                        break; // Exit loop if reload fails
                    }
                } else {
                    // If it was a different error, or if max retries reached, record failure and exit the loop
                    this.logger.error(`Unrecoverable error or max retries reached for ${imageName}.`);
                    submitted = false; // Mark as not submitted
                    successStatusOfPrevious = false; // Assume previous failed
                    break; // Exit the while loop
                }
            }
        } // End while loop

        this.logger.info(`--- Finished processing attempts for: ${imageName} ---`);
        // Return the final determined status for the *previous* image and whether *this* image was submitted
        return { submitted, successStatusOfPrevious };
    }

    // Inherited methods: handlePotentialCaptcha, delayIfCaptcha, delay, takeScreenshot from BaseHandler
}

export default ChatGptHandler;