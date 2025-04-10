// src/services/chatgpt_service.js
import path from 'path';

class ChatGptService {
    constructor(page, logger, options) {
        this.page = page;
        this.logger = logger;
        this.options = options;
        this.selectors = options.selectors?.chatgpt;
        // No imageCountBeforeLastSubmit state needed in this version

        if (!this.selectors) {
            throw new Error("ChatGPT selectors not found in configuration.");
        }
        // Validation list for this specific flow
        const requiredSelectors = [
            'promptTextarea', 'submitButton', 'uploadButtonInitiator',
            'fileInputHidden', 'imagePreviewConfirmation', 'responseArea',
            'imageInResponse'
        ];
        for (const key of requiredSelectors) {
            if (!(key in this.selectors)) {
                this.logger.error(`Missing required ChatGPT selector in config: selectors.chatgpt.${key}`);
                throw new Error(`Required ChatGPT selector 'selectors.chatgpt.${key}' is missing.`);
            }
        }
        this.logger.debug('ChatGptService initialized (Simple Image Count Check Flow).');
    }

    /** Navigates to the configured ChatGPT URL. */
    async navigateToUrl() {
        const targetUrl = this.options.url || this.options.chatgptUrl;
        if (!targetUrl) throw new Error("Target URL not defined.");
        this.logger.info(`Navigating to ChatGPT URL: ${targetUrl}`);
        try {
            await this.page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: this.options.navigationTimeout });
            this.logger.info('Navigation complete.');
        } catch (error) {
            this.logger.error(`Navigation failed: ${error.message}`, { stack: error.stack });
            await this.takeScreenshot(this.page, `error_navigation`);
            throw new Error(`Failed to navigate to ${targetUrl}: ${error.message}`);
        }
    }

    /** Uploads a single image file using the HIDDEN file input element. */
    async uploadImage(imagePath) {
        this.logger.info(`Attempting to upload image via hidden input: ${path.basename(imagePath)}`);
        const { fileInputHidden, imagePreviewConfirmation } = this.selectors;
        try {
            this.logger.info(`Waiting for hidden file input: ${fileInputHidden}`);
            const fileInput = await this.page.waitForSelector(fileInputHidden, { timeout: this.options.actionTimeout });
            if (!fileInput) throw new Error(`File input element not found: ${fileInputHidden}`);
            this.logger.debug('Hidden file input found.');

            this.logger.info(`Uploading file to hidden input: ${path.basename(imagePath)}`);
            await fileInput.uploadFile(imagePath);
            this.logger.info(`File path sent to hidden input.`);

            this.logger.info(`Waiting for image preview confirmation: ${imagePreviewConfirmation}`);
            const previewTimeout = this.options.actionTimeout + 15000;
            await this.page.waitForSelector(imagePreviewConfirmation, { visible: true, timeout: previewTimeout });
            this.logger.info('Image preview confirmed in message area.');
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            this.logger.error(`Failed during ChatGPT image upload using hidden input: ${error.message}`, { stack: error.stack });
            await this.takeScreenshot(this.page, `error_upload_hidden`);
            throw new Error(`ChatGPT Image upload failed: ${error.message}`);
        }
    }

    /** Enters the text prompt into the ChatGPT contenteditable input field. */
    async enterPrompt(prompt) {
        this.logger.info(`Entering prompt (length: ${prompt.length})...`);
        const { promptTextarea } = this.selectors;
        try {
            const promptInput = await this.page.waitForSelector(promptTextarea, { visible: true, timeout: this.options.actionTimeout });
            this.logger.debug(`Visible prompt input element (${promptTextarea}) found.`);
            await promptInput.focus();
            // Clear content more reliably for contenteditable
            await promptInput.evaluate(el => el.innerHTML = '');
            await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause needed after clearing sometimes
            this.logger.debug('Existing content cleared.');

            await promptInput.type(prompt, { delay: 40 });
            this.logger.info('Prompt entered successfully.');

        } catch (error) {
            this.logger.error(`Failed to enter prompt into ${promptTextarea}: ${error.message}`, { stack: error.stack });
            await this.takeScreenshot(this.page, `error_enter_prompt`);
            throw new Error(`Entering prompt failed: ${error.message}`);
        }
    }

    /**
     * Waits for submit button, checks for image presence in the latest response block
     * (determining success of the PREVIOUS prompt), and then clicks submit.
     * @returns {Promise<boolean>} Success status of the PREVIOUS prompt.
     */
    async checkPreviousSuccessAndSubmit() {
        this.logger.info('Waiting for Submit button to enable before checking previous prompt success...');
        const { submitButton, responseArea, imageInResponse } = this.selectors;
        const enableTimeout = 360000; // 6 minutes
        const enabledSubmitSelector = `${submitButton}:not([disabled])`;
        let successOfPrevious = false; // Assume failure unless image found

        try {
            // --- Wait for Submit button of CURRENT prompt to be ready ---
            this.logger.debug(`Waiting up to ${enableTimeout/1000}s for submit button: ${enabledSubmitSelector}`);
            const button = await this.page.waitForSelector(enabledSubmitSelector, { visible: true, timeout: enableTimeout });
            this.logger.debug('Submit button is enabled.');

            // --- Check the LATEST response block for success of PREVIOUS prompt ---
            this.logger.info(`Checking latest response block ('${responseArea}') for generated image ('${imageInResponse}')...`);
            let currentImageCount = 0;
            try {
                // Find the elements matching the response area selector
                const responseElements = await this.page.$$(responseArea);
                if (responseElements.length > 0) {
                    // Get the handle for the very last response element on the page
                    const latestResponseElement = responseElements[responseElements.length - 1];
                    this.logger.debug(`Checking last of ${responseElements.length} response blocks.`);

                    // Ensure the element is still attached to the DOM before evaluating
                    const isAttached = await latestResponseElement.evaluate(el => !!(el && el.isConnected));
                    if (!isAttached) {
                        this.logger.warn('Latest response element became detached before image count check.');
                        currentImageCount = 0; // Treat as 0 if detached
                    } else {
                        // Count images *within* the specific latest block using querySelectorAll in evaluate
                        currentImageCount = await latestResponseElement.evaluate(
                            (el, selector) => el.querySelectorAll(selector).length, // Function to execute in browser
                            imageInResponse // Argument to pass to the function (the selector string)
                        );
                        this.logger.info(`Found ${currentImageCount} image(s) in latest block.`);
                    }
                } else {
                    this.logger.warn(`No response blocks ('${responseArea}') found to check.`);
                    currentImageCount = 0; // Set to 0 if no blocks found
                }
            } catch (checkError) {
                // Catch errors during the checking process (e.g., evaluate fails)
                this.logger.error(`Error checking/counting images in latest response block: ${checkError.message}`);
                currentImageCount = 0; // Assume 0 on error
            }

            // --- Determine Success (Simple Check: > 0 images?) ---
            successOfPrevious = currentImageCount > 0;
            this.logger.info(`Success status for PREVIOUS prompt determined as: ${successOfPrevious}`);

            // --- Click Submit for CURRENT prompt ---
            this.logger.debug(`Clicking Submit button...`);
            await button.click({ delay: 100 });
            this.logger.info('Submit button clicked.');

            // Return the success status determined for the *previous* prompt
            return successOfPrevious;

        } catch (error) {
            // Handle errors finding/clicking submit button primarily
            if (error.name === 'TimeoutError' && error.message.includes(submitButton)) {
                this.logger.error(`Submit button ('${submitButton}') did not become enabled within ${enableTimeout/1000}s.`);
                await this.takeScreenshot(this.page, `error_submit_disabled`);
                // Let the handler catch this specific error message to trigger reload if implemented
                throw new Error(`Submit button did not become enabled within the ${enableTimeout/1000}s timeout.`);
            } else {
                // Handle other errors during the check/submit process
                this.logger.error(`Error in checkPreviousSuccessAndSubmit: ${error.message}`, { stack: error.stack });
                await this.takeScreenshot(this.page, `error_check_submit`);
                throw new Error(`checkPreviousSuccessAndSubmit failed: ${error.message}`);
            }
        }
    }

    // No waitForResponse method needed in this workflow

    /** Helper to take screenshots */
    async takeScreenshot(page, prefix = 'screenshot') {
        const currentPage = page || this.page;
        if (currentPage && !currentPage.isClosed()) {
            try {
                const screenshotPath = path.join(this.options.outputDir || '.', `${prefix}_${Date.now()}.png`);
                await currentPage.screenshot({ path: screenshotPath, fullPage: true });
                this.logger.info(`Screenshot saved to ${screenshotPath}`);
            } catch (ssError) {
                this.logger.error(`Failed to take screenshot (${prefix}): ${ssError.message}`);
            }
        } else { this.logger.warn(`Skipping screenshot (${prefix}) - page invalid.`); }
    }
}

export default ChatGptService;