// src/manager.js
import pLimit from 'p-limit';
import puppeteer from 'puppeteer-extra';
import browserFactory from './core/browser_factory.js';
import handlerFactory from './core/handler_factory.js';
import path from 'path';
import fs from 'fs/promises';
// Import ExifWriter here if needed for type hints, but instantiation happens later
import ExifWriter from './exif_writer.js'; // Adjust path if needed

class Manager {
    constructor(fileManager, exifWriter, logger, options) {
        this.fileManager = fileManager;
        // Store the original exifWriter mainly for single mode or potential shared config access
        this.sharedExifWriter = exifWriter;
        this.logger = logger;
        this.options = options;
        this.logger.info('Manager initialized.');
    }

    /** Runs the main processing loop. */
    async run() {
        await this.ensureOutputDir();
        if (this.options.recurse) {
            await this.runRecursiveMode();
        } else {
            await this.runSingleMode();
        }
        // No global cleanup here; handled within modes or on process exit
        this.logger.info("Manager run finished.");
    }

    /** Executes processing logic for paired directories CONCURRENTLY. */
    async runRecursiveMode() {
        this.logger.info(`Starting processing in RECURSIVE mode (Concurrency: ${this.options.concurrency})...`);
        const aggregateSummary = { processed: 0, skipped: 0, success: 0, failed: 0, submitErrors: 0, exifErrors: 0 };
        let inputSubDirs = [];
        let userDataSubDirs = [];
        let numPairs = 0;

        try {
            inputSubDirs = await this.fileManager.findSubdirectories(this.options.input);
            userDataSubDirs = await this.fileManager.findSubdirectories(this.options.userDataDir);

            numPairs = Math.min(inputSubDirs.length, userDataSubDirs.length);
            if (inputSubDirs.length !== userDataSubDirs.length) {
                this.logger.warn(`Mismatch count: Found ${inputSubDirs.length} inputs, ${userDataSubDirs.length} profiles. Processing ${numPairs} pairs.`);
            } else { this.logger.info(`Found ${numPairs} pairs of directories.`); }
            if (numPairs === 0) { this.logger.warn("No matching pairs found."); return; }

            const limit = pLimit(this.options.concurrency);
            const tasks = [];

            for (let i = 0; i < numPairs; i++) {
                const currentInputPath = inputSubDirs[i];
                const currentUserDataPath = userDataSubDirs[i];
                const inputDirName = path.basename(currentInputPath);
                const profileDirName = path.basename(currentUserDataPath);

                // Define the async task function for p-limit
                const task = async () => {
                    this.logger.info(`\n▶️ Starting Task for Pair: Input [${inputDirName}] <-> Profile [${profileDirName}]`);
                    let browserForPair = null;
                    let page = null;
                    let handler = null;
                    // --- Create SEPARATE ExifWriter for this task ---
                    let exifWriterForPair = null;
                    let pairResult = { processed: 0, skipped: 0, success: 0, failed: 0, submitErrors: 0, exifErrors: 0 };

                    try {
                        // --- Instantiate ExifWriter for this pair ---
                        exifWriterForPair = new ExifWriter(this.logger, this.options);

                        this.logger.info(`Launching browser for profile: ${profileDirName}...`);
                        const launchOptions = { /* ... launch options using currentUserDataPath ... */
                            headless: this.options.headless,
                            executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                            timeout: this.options.navigationTimeout || 60000,
                            protocolTimeout: 600000,
                            userDataDir: currentUserDataPath,
                            defaultViewport: null,
                            args: this.options.browserArgs,
                        };
                        browserForPair = await puppeteer.launch(launchOptions);
                        this.logger.info(`Browser launched for profile: ${profileDirName}`);

                        handler = handlerFactory.getHandler(this.options, this.logger);
                        page = await browserForPair.newPage();
                        page.setDefaultNavigationTimeout(this.options.navigationTimeout || 60000);
                        page.setDefaultTimeout(this.options.actionTimeout || 30000);
                        this.logger.info('Page created.');

                        const initialUrl = this.options.url || this.options.chatgptUrl || this.options.geminiUrl;
                        if (!initialUrl) throw new Error("Target URL not defined.");
                        await page.goto(initialUrl, { waitUntil: 'networkidle2', timeout: this.options.navigationTimeout });
                        this.logger.info('Initial navigation complete.');

                        // Initial Readiness Check
                        const platformKey = handler.platformKey;
                        const readySelectors = this.options.selectors?.[platformKey]?.readySelectors || [];
                        if (readySelectors.length > 0) {
                            await Promise.all(readySelectors.map(s => page.waitForSelector(s, { visible: true, timeout: 20000 })));
                            this.logger.info('Initial page readiness confirmed.');
                        } else { await new Promise(resolve => setTimeout(resolve, 3000));}


                        // Process images for this pair, passing the DEDICATED exifWriter
                        const imagePaths = await this.fileManager.findImageFiles(currentInputPath, false);
                        this.logger.info(`Found ${imagePaths.length} image(s) in ${inputDirName}.`);
                        if(imagePaths.length > 0){
                            // Pass the dedicated exif writer instance to the batch processor
                            pairResult = await this.processImageBatch(page, handler, imagePaths, exifWriterForPair);
                        } else { this.logger.info(`No images to process in ${inputDirName}.`); }

                    } catch (pairError) {
                        this.logger.error(`Error processing pair (Input: ${inputDirName}, Profile: ${profileDirName}): ${pairError.message}`, { stack: pairError.stack });
                        // Result will be default (zeros), handle aggregation below
                    } finally {
                        // --- Close browser AND ExifWriter for this pair ---
                        this.logger.info(`Closing browser for profile: ${profileDirName}`);
                        if (browserForPair) await browserForPair.close().catch(e => this.logger.error(`Error closing browser: ${e.message}`));
                        // Cleanup specific exiftool instance for this pair
                        if (exifWriterForPair) await exifWriterForPair.cleanup();
                        this.logger.info(`⏹️ Finished Task for Pair: Input [${inputDirName}] <-> Profile [${profileDirName}]`);
                    }
                    return pairResult; // Return summary for this pair
                }; // End task definition
                tasks.push(limit(() => task()));
            } // End for loop creating tasks

            // --- Run Tasks Concurrently ---
            this.logger.info(`Running ${tasks.length} tasks with concurrency limit ${this.options.concurrency}...`);
            const results = await Promise.all(tasks);

            // --- Aggregate Results ---
            this.logger.info("Aggregating results from all pairs...");
            results.forEach(summary => {
                if (summary) { // Ensure summary object exists
                    aggregateSummary.processed += summary.processed;
                    aggregateSummary.skipped += summary.skipped;
                    aggregateSummary.success += summary.success;
                    aggregateSummary.failed += summary.failed;
                    aggregateSummary.submitErrors += summary.submitErrors;
                    aggregateSummary.exifErrors += summary.exifErrors;
                }
            });

        } catch (error) {
            this.logger.error(`Manager recursive run failed: ${error.message}`, { stack: error.stack });
        } finally {
            // Log Final Aggregated Recursive Summary
            this.logger.info('================ Recursive Run Summary ================');
            this.logger.info(`Total Input Dirs Processed: ${numPairs ?? 0}`);
            this.logger.info(`Total Files Skipped:        ${aggregateSummary.skipped}`);
            this.logger.info(`Total Files Attempted:      ${aggregateSummary.processed}`);
            this.logger.info(`Total Success Count:        ${aggregateSummary.success}`);
            this.logger.info(`Total Failed Count:         ${aggregateSummary.failed}`);
            this.logger.info(`Total Submit Phase Errors:  ${aggregateSummary.submitErrors}`);
            this.logger.info(`Total EXIF Write Errors:    ${aggregateSummary.exifErrors}`);
            this.logger.info('=======================================================');
        }
    }

    /** Executes original single-directory processing logic. */
    async runSingleMode() {
        this.logger.info('Starting processing in SINGLE mode...');
        let page = null;
        let handler = null;
        let imagePaths = [];
        let resultSummary = { processed: 0, skipped: 0, success: 0, failed: 0, submitErrors: 0, exifErrors: 0 };
        const exifWriterInstance = this.sharedExifWriter; // Use the shared instance for single mode

        try {
            const userDataDir = this.options.userDataDir;
            this.logger.info(`Using User Data Dir: ${userDataDir || 'None (Default Profile)'}`);

            imagePaths = await this.fileManager.findImageFiles(this.options.input, this.options.recurse);
            if (imagePaths.length === 0) { this.logger.warn("No images found."); return; }
            this.logger.info(`Found ${imagePaths.length} image(s) to process.`);

            await browserFactory.launchBrowser(this.options, this.logger);
            handler = handlerFactory.getHandler(this.options, this.logger);
            page = await browserFactory.newPage(this.options);

            const initialUrl = this.options.url || this.options.chatgptUrl || this.options.geminiUrl;
            if (!initialUrl) throw new Error("Target URL not defined.");
            await page.goto(initialUrl, { waitUntil: 'networkidle2', timeout: this.options.navigationTimeout });
            this.logger.info('Initial navigation complete.');
            this.logger.info('Performing initial page readiness check...');
            const platformKey = handler.platformKey;
            const readySelectors = this.options.selectors?.[platformKey]?.readySelectors || [];
            if (readySelectors.length > 0) {
                await Promise.all(readySelectors.map(s => page.waitForSelector(s, { visible: true, timeout: 20000 })));
                this.logger.info('Initial page readiness confirmed.');
            } else { await new Promise(resolve => setTimeout(resolve, 3000)); }

            // Pass the shared exif writer instance
            resultSummary = await this.processImageBatch(page, handler, imagePaths, exifWriterInstance);

        } catch (error) {
            this.logger.error(`Manager single run failed: ${error.message}`, { stack: error.stack });
        } finally {
            // Cleanup browser (managed by factory)
            await browserFactory.close();
            // Explicitly cleanup the *shared* exif writer used in single mode
            await exifWriterInstance.cleanup();

            // Log Summary for Single Mode
            this.logger.info('================ Single Run Summary ================');
            this.logger.info(`Total Files Found:      ${imagePaths?.length ?? 0}`);
            this.logger.info(`Files Skipped:          ${resultSummary.skipped}`);
            this.logger.info(`Files Processed:        ${resultSummary.processed}`);
            this.logger.info(`Successfully Processed: ${resultSummary.success}`);
            this.logger.info(`Failed Processing:      ${resultSummary.failed}`);
            this.logger.info(`Submit Phase Errors:    ${resultSummary.submitErrors}`);
            this.logger.info(`EXIF Write Errors:    ${resultSummary.exifErrors}`);
            this.logger.info('====================================================');
        }
    }


    /**
     * Processes a batch of image files sequentially on a given page/handler.
     * Uses the provided ExifWriter instance.
     * @param {import('puppeteer').Page} page
     * @param {BaseHandler} handler
     * @param {string[]} imagePaths
     * @param {ExifWriter} exifWriterInstance - The specific ExifWriter instance to use.
     * @returns {Promise<object>} Summary object with counts for this batch.
     */
    async processImageBatch(page, handler, imagePaths, exifWriterInstance) {
        let summary = { processed: 0, skipped: 0, success: 0, failed: 0, submitErrors: 0, exifErrors: 0 };
        let previousImagePath = null;
        let successStatusForPreviousImage = null;
        let fileIndex = 0;

        for (const currentImagePath of imagePaths) {
            fileIndex++;
            const imageName = path.basename(currentImagePath);
            this.logger.info(`---------------- Preparing file ${fileIndex}/${imagePaths.length}: ${imageName} ----------------`);

            // --- Update EXIF for the PREVIOUS image (if status is known) ---
            if (previousImagePath && successStatusForPreviousImage !== null) {
                this.logger.info(`Updating EXIF for PREVIOUS image: ${path.basename(previousImagePath)} -> ${successStatusForPreviousImage}`);
                // <<< Use the passed exifWriterInstance >>>
                const keyToIncrement = successStatusForPreviousImage ? this.options.exifSuccessKey : this.options.exifFailedKey;
                const exifUpdated = await exifWriterInstance.incrementCounter(previousImagePath, keyToIncrement);
                if (exifUpdated) { if (successStatusForPreviousImage) summary.success++; else summary.failed++; }
                else { summary.exifErrors++; }
            }
            successStatusForPreviousImage = null;

            // --- Skip Check for CURRENT image ---
            try {
                // <<< Use the passed exifWriterInstance >>>
                const existingData = await exifWriterInstance.getAppData(currentImagePath);
                const existingSuccessCount = existingData?.[this.options.exifSuccessKey] || 0;
                if (existingSuccessCount > 0 && this.options.skipIfCreated !== false) {
                    this.logger.info(`⏭️ Skipping ${imageName} - already has successCount: ${existingSuccessCount}`);
                    summary.skipped++;
                    previousImagePath = null;
                    continue;
                }
            } catch (readError) { this.logger.warn(`EXIF read error for ${imageName}: ${readError.message}. Proceeding.`); }

            // --- Process CURRENT image ---
            this.logger.info(`--- Submitting file ${fileIndex}/${imagePaths.length}: ${imageName} ---`);
            let attemptResult = null;
            try {
                summary.processed++;
                // Handler determines success of PREVIOUS prompt just before submitting current
                attemptResult = await handler.processImage(page, currentImagePath, this.options.prompt);

                if (attemptResult && attemptResult.submitted !== undefined) {
                    successStatusForPreviousImage = attemptResult.successStatusOfPrevious;
                    this.logger.info(`Submission for ${imageName} reported as: ${attemptResult.submitted}. Status for previous: ${successStatusForPreviousImage}`);
                    if(!attemptResult.submitted) summary.submitErrors++;
                } else {
                    this.logger.error(`Handler for ${imageName} did not return expected result object. Assuming submit failure.`);
                    successStatusForPreviousImage = false;
                    summary.submitErrors++;
                }
            } catch (error) {
                this.logger.error(`Critical error processing ${imageName}: ${error.message}`, { stack: error.stack });
                successStatusForPreviousImage = false;
                summary.submitErrors++;
            } finally {
                // Always store path for next iteration's EXIF update
                previousImagePath = currentImagePath;
            }

            this.logger.info(`---------------- Finished SUBMIT phase for ${fileIndex}/${imagePaths.length}: ${imageName} ----------------`);
            if (fileIndex < imagePaths.length) {
                this.logger.info(`Waiting ${this.options.waitTimeout}ms before next file...`);
                await new Promise(resolve => setTimeout(resolve, this.options.waitTimeout));
            }
        } // End for loop

        // --- Update EXIF for the VERY LAST image processed in the batch ---
        if (previousImagePath && successStatusForPreviousImage !== null) {
            this.logger.info(`Updating EXIF for FINAL image of batch: ${path.basename(previousImagePath)} -> ${successStatusForPreviousImage}`);
            // <<< Use the passed exifWriterInstance >>>
            const keyToIncrement = successStatusForPreviousImage ? this.options.exifSuccessKey : this.options.exifFailedKey;
            const exifUpdated = await exifWriterInstance.incrementCounter(previousImagePath, keyToIncrement);
            if (exifUpdated) { if (successStatusForPreviousImage) summary.success++; else summary.failed++; }
            else { summary.exifErrors++; }
        } else if (previousImagePath && successStatusForPreviousImage === null && summary.processed > 0) {
            this.logger.warn(`Success status for last processed image (${path.basename(previousImagePath)}) undetermined. Marking as failed.`);
            // <<< Use the passed exifWriterInstance >>>
            const keyToIncrement = this.options.exifFailedKey;
            const exifUpdated = await exifWriterInstance.incrementCounter(previousImagePath, keyToIncrement);
            if (exifUpdated) summary.failed++; else summary.exifErrors++;
        }

        return summary;
    }

    async ensureOutputDir() {
        try { await fs.mkdir(this.options.outputDir, { recursive: true }); }
        catch (err) { this.logger.error(`Could not create output directory: ${err.message}`); }
    }
}

export default Manager;