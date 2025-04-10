// src/services/gemini_service.js
import path from 'path';

/**
 * Provides detailed Puppeteer interaction logic for the Gemini website.
 */
class GeminiService {
    constructor(page, logger, options) {
        this.page = page;
        this.logger = logger;
        this.options = options;
        // Get selectors specific to Gemini from the global config
        this.selectors = options.selectors?.gemini;
        if (!this.selectors) {
            throw new Error("Gemini selectors not found in configuration.");
        }
        // Add specific checks for selectors needed by this service during initialization
        if (!this.selectors.promptTextarea ||
            !this.selectors.submitButton ||
            !this.selectors.uploadButtonInitiator ||
            !this.selectors.uploadButtonLocalImage ||
            !this.selectors.imagePreviewConfirmation ||
            !this.selectors.responseArea ||
            !this.selectors.imageInResponse /* || // loadingIndicator is optional
            !this.selectors.loadingIndicator */) {
            this.logger.error('Missing one or more required Gemini selectors in config:', this.selectors);
            throw new Error("One or more required Gemini selectors are missing in the configuration. Please check config.js.");
        }
        this.logger.debug('GeminiService initialized with selectors:', this.selectors);
    }

    /** Navigates to the configured Gemini URL. */
    async navigateToUrl() {
        if (!this.options.url && !this.options.geminiUrl) { // Check both possible option names
            throw new Error("Target URL (url or geminiUrl) is not defined in options.");
        }
        const targetUrl = this.options.url || this.options.geminiUrl;
        this.logger.info(`Navigating to Gemini URL: ${targetUrl}`);
        try {
            await this.page.goto(targetUrl, {
                waitUntil: 'networkidle2', // Wait for network activity to settle
                timeout: this.options.navigationTimeout
            });
            this.logger.info('Navigation complete.');
        } catch (error) {
            this.logger.error(`Navigation failed: ${error.message}`, {stack: error.stack});
            throw new Error(`Failed to navigate to ${targetUrl}: ${error.message}`);
        }
    }

    /** Uploads a single image file using the Gemini interface (handles two-step click). */
    async uploadImage(imagePath) {
        this.logger.info(`Attempting to upload image: ${path.basename(imagePath)}`);

        try {
            // --- Step 1: Click the initial upload button (opens menu) ---
            this.logger.info(`Waiting for upload initiator button: ${this.selectors.uploadButtonInitiator}`);
            const uploadInitiatorButton = await this.page.waitForSelector(this.selectors.uploadButtonInitiator, {
                visible: true,
                timeout: this.options.actionTimeout
            });
            this.logger.debug('Upload initiator button found. Clicking...');
            await uploadInitiatorButton.click();
            // CORRECTED DELAY:
            await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause for menu to open

            // --- Step 2: Click the specific "local image" upload button ---
            this.logger.info(`Waiting for local image upload button: ${this.selectors.uploadButtonLocalImage}`);
            const localImageUploadButton = await this.page.waitForSelector(this.selectors.uploadButtonLocalImage, {
                visible: true,
                timeout: this.options.actionTimeout
            });
            this.logger.debug('Local image upload button found.');

            // --- Step 3: Handle File Chooser ---
            this.logger.debug('Preparing to click local upload button and wait for file chooser...');
            let fileChooser;
            try {
                [fileChooser] = await Promise.all([
                    this.page.waitForFileChooser({timeout: this.options.actionTimeout}),
                    localImageUploadButton.click(),
                ]);
            } catch (fcError) {
                this.logger.error(`Error during file chooser interaction or button click: ${fcError.message}`, {stack: fcError.stack});
                throw new Error(`Could not initiate file chooser or click upload button: ${fcError.message}`);
            }

            if (!fileChooser) {
                throw new Error('File chooser was not created after clicking the upload button.');
            }
            this.logger.debug('File chooser opened.');

            await fileChooser.accept([imagePath]);
            this.logger.info(`File chooser accepted path: ${path.basename(imagePath)}`);

            // --- Step 4: Wait for Image Preview Confirmation ---
            this.logger.info(`Waiting for image preview confirmation: ${this.selectors.imagePreviewConfirmation}`);
            const previewTimeout = this.options.actionTimeout + 15000; // e.g., 30s + 15s
            await this.page.waitForSelector(this.selectors.imagePreviewConfirmation, {
                visible: true,
                timeout: previewTimeout
            });
            this.logger.info('Image preview confirmed.');
            // CORRECTED DELAY:
            await new Promise(resolve => setTimeout(resolve, 500)); // Small stabilization delay after preview

        } catch (error) {
            this.logger.error(`Failed during image upload steps: ${error.message}`, {stack: error.stack});
            if (error.name === 'TimeoutError' && error.message.includes(this.selectors.imagePreviewConfirmation)) {
                throw new Error(`Image upload failed for ${path.basename(imagePath)}: Preview did not appear within timeout.`);
            }
            throw new Error(`Image upload failed for ${path.basename(imagePath)}: ${error.message}`);
        }
    }

    /** Enters the text prompt into the Gemini input field. */
    async enterPrompt(prompt) {
        this.logger.info(`Entering prompt (length: ${prompt.length})...`);

        try {
            const promptInput = await this.page.waitForSelector(this.selectors.promptTextarea, {
                visible: true,
                timeout: this.options.actionTimeout
            });
            this.logger.debug('Prompt textarea found.');

            await promptInput.focus();
            await promptInput.evaluate(el => el.innerText = '');
            // CORRECTED DELAY:
            await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay after clearing

            await promptInput.evaluate((el, value) => el.innerText = value, prompt);
            await promptInput.evaluate(el => el.dispatchEvent(new Event('input', {bubbles: true})));

            this.logger.info('Prompt entered.');
        } catch (error) {
            this.logger.error(`Failed to enter prompt: ${error.message}`, {stack: error.stack});
            throw new Error(`Entering prompt failed: ${error.message}`);
        }
    }

    /** Clicks the submit button. */
    async submit() {
        this.logger.info('Clicking submit button...');

        try {
            const submitButton = await this.page.waitForSelector(this.selectors.submitButton, {
                visible: true,
                timeout: this.options.actionTimeout
            });
            this.logger.debug('Submit button found.');
            const isDisabled = await submitButton.evaluate(el => el.disabled);
            if (isDisabled) {
                this.logger.warn('Submit button is disabled. Waiting briefly...');
                // CORRECTED DELAY:
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
                if (await submitButton.evaluate(el => el.disabled)) {
                    throw new Error("Submit button remained disabled.");
                }
                this.logger.debug('Submit button became enabled.');
            }

            await submitButton.click({delay: 100});
            this.logger.info('Submit button clicked.');
        } catch (error) {
            this.logger.error(`Failed to click submit button: ${error.message}`, {stack: error.stack});
            throw new Error(`Clicking submit failed: ${error.message}`);
        }
    }

    /** Waits for the response and checks if it contains an image. */
    async waitForResponse() {
        this.logger.info('Waiting for AI response...');
        const {responseArea, imageInResponse, loadingIndicator} = this.selectors;

        let imageFound = false;
        let responseText = null;

        try {
            // 1. Wait for loading indicator (optional, based on config)
            if (loadingIndicator && loadingIndicator !== 'progress-indicator') {
                try {
                    this.logger.debug(`Waiting for loading indicator ('${loadingIndicator}') to appear (optional)...`);
                    await this.page.waitForSelector(loadingIndicator, {visible: true, timeout: 15000});
                    this.logger.debug('Loading indicator appeared. Waiting for it to disappear...');
                    await this.page.waitForSelector(loadingIndicator, {hidden: true, timeout: 240000}); // 4 minutes
                    this.logger.debug('Loading indicator disappeared.');
                } catch (e) {
                    this.logger.warn(`Loading indicator ('${loadingIndicator}') wait condition met or timed out: ${e.message}. Proceeding...`);
                }
            } else {
                this.logger.debug(`Skipping loading indicator wait (selector: '${loadingIndicator}')`);
                // CORRECTED DELAY (if skipping spinner check):
                await new Promise(resolve => setTimeout(resolve, 2000)); // Small fixed wait
            }

            // 2. Wait for the response area container ('model-response') to appear.
            this.logger.debug(`Waiting for a new response area ('${responseArea}') to appear...`);
            const responseWaitTimeout = 240000; // 4 minutes
            await this.page.waitForSelector(responseArea, {visible: true, timeout: responseWaitTimeout});
            this.logger.debug(`At least one response area ('${responseArea}') found. Waiting briefly for content...`);
            // CORRECTED DELAY:
            await new Promise(resolve => setTimeout(resolve, 1500)); // Wait slightly longer for content/image rendering

            const responseElements = await this.page.$$(responseArea);
            if (!responseElements || responseElements.length === 0) {
                throw new Error(`No response areas found matching selector '${responseArea}' after waiting.`);
            }
            const latestResponseElement = responseElements[responseElements.length - 1];
            this.logger.debug(`Targeting the last of ${responseElements.length} response areas.`);

            // 3. Check for the image *within* the latest response area
            this.logger.debug(`Checking for image selector ('${imageInResponse}') within the last response area...`);
            try {
                imageFound = await latestResponseElement.$eval(imageInResponse, (img) => !!img)
                    .then(() => true)
                    .catch(() => false);
            } catch (evalError) {
                this.logger.warn(`Error during image check within response area: ${evalError.message}. Assuming no image found.`);
                imageFound = false;
            }

            this.logger.info(`Image found in response: ${imageFound}`);

            // 4. Optional: Extract text content from the latest response area
            try {
                responseText = await latestResponseElement.evaluate(el => el.innerText || el.textContent);
                this.logger.debug(`Response text length: ${responseText?.length ?? 0}`);
            } catch (textError) {
                this.logger.warn(`Could not extract text content from response area: ${textError.message}`);
            }

            return {success: imageFound, responseText: responseText?.trim()};

        } catch (error) {
            this.logger.error(`Failed while waiting for or evaluating response: ${error.message}`, {stack: error.stack});
            if (this.page && !this.page.isClosed()) {
                try {
                    const responseErrorPath = path.join(this.options.outputDir || '.', `error_response_wait_${Date.now()}.png`);
                    await this.page.screenshot({path: responseErrorPath, fullPage: true});
                    this.logger.info(`Response error screenshot saved to ${responseErrorPath}`);
                } catch (ssError) {
                    this.logger.error(`Failed to take screenshot on response error: ${ssError.message}`);
                }
            }
            if (error.name === 'TimeoutError') {
                this.logger.error(`Timeout waiting for response area ('${responseArea}') or elements within it. Assuming failure.`);
                return {success: false, responseText: null}; // Treat timeout as failure
            }
            throw new Error(`Error during response processing: ${error.message}`);
        }
    }
}

export default GeminiService;