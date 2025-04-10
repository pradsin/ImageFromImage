// src/cli.js
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
// import os from 'os'; // Not currently needed

import defaultConfig from './config.js';
import createLogger from './logger.js'; // Import the factory function
import FileManager from './file_manager.js';
import ExifWriter from './exif_writer.js';
import Manager from './manager.js';

async function runCli() {
    const argv = yargs(hideBin(process.argv))
        .usage('Usage: node index.js --input <path> [options]')
        .option('input', {
            alias: 'i',
            describe: 'Path to the input image file OR directory containing images (or subdirectories if --recurse)',
            type: 'string',
            demandOption: true, // Input is always required
        })
        .option('url', {
            alias: 'u',
            describe: 'Target URL for the AI platform (e.g., https://chatgpt.com/c/...)',
            type: 'string',
            // No default, uses platform-specific defaults from config if not provided
        })
        .option('platform', {
            alias: 'P', // Uppercase P to avoid conflict with prompt
            describe: 'Explicitly specify the platform handler (e.g., gemini, chatgpt)',
            type: 'string',
            choices: ['gemini', 'chatgpt'], // Add more as implemented
            // No default, relies on URL detection if omitted
        })
        .option('prompt', {
            alias: 'p',
            describe: 'Text prompt to use with the image',
            type: 'string',
            // Ensures DEFAULT_PROMPT from config is used if --prompt is omitted
            default: defaultConfig.defaultPrompt,
        })
        .option('recurse', {
            alias: 'r',
            describe: 'Enable recursive mode: Processes subdirectories in --input matched with subdirectories in --userDataDir.',
            type: 'boolean',
            default: false,
        })
        .option('userDataDir', {
            alias: 'd',
            describe: 'Path to Chrome user data directory. In recursive mode, path to directory containing multiple user data subdirectories.',
            type: 'string',
            default: defaultConfig.userDataDir // Default is null from config
        })
        .option('concurrency', {
            alias: 'c',
            describe: 'Number of browser profiles to run in parallel (recursive mode only).',
            type: 'number',
            default: 4, // Default to 4 concurrent processes
        })
        .option('headless', {
            describe: `Run browser in headless mode ('new', true, false)`,
            type: 'string', // Keep as string to handle 'new'
            default: String(defaultConfig.headless), // Default from config
        })
        .option('logLevel', {
            alias: 'l',
            describe: 'Logging level',
            type: 'string',
            choices: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
            default: defaultConfig.logLevel, // Default from config
        })
        .option('outputDir', {
            alias: 'o',
            describe: 'Directory for output logs/screenshots',
            type: 'string',
            default: defaultConfig.outputDir, // Default from config
        })
        .option('waitTimeout', { // This is the delay BETWEEN files in Manager loop
            alias: 'w',
            describe: 'Wait timeout (ms) between processing files/submissions',
            type: 'number',
            default: defaultConfig.waitTimeout, // Default from config
        })
        .option('navigationTimeout', {
            describe: 'Page navigation timeout (ms)',
            type: 'number',
            default: defaultConfig.navigationTimeout, // Default from config
        })
        .option('actionTimeout', {
            describe: 'Puppeteer action timeout (ms) for clicks, waits etc.',
            type: 'number',
            default: defaultConfig.actionTimeout, // Default from config
        })
        .option('skipIfCreated', {
            alias: 's',
            describe: 'Skip processing images that already have successCount > 0 in EXIF data.',
            type: 'boolean',
            default: true, // Default to skipping already processed images
        })
        .help('help')
        .alias('help', '?') // Standard help alias
        .epilog('ImageFromImage EXIF Updater - Copyright 2025')
        .check((argv) => {
            // Validation: If recurse is true, userDataDir must be provided
            if (argv.recurse && !argv.userDataDir) {
                throw new Error("The --userDataDir option pointing to a directory of profiles is required when using --recurse mode.");
            }
            // Validation: Check if platform is provided if URL detection might fail
            if (!argv.platform && !argv.url && !defaultConfig.chatgptUrl && !defaultConfig.geminiUrl) {
                throw new Error("Please provide a target --url or specify the --platform.");
            }
            if (argv.concurrency < 1) {
                throw new Error("Concurrency must be at least 1.");
            }
            return true;
        })
        .parse(); // Use parse()

    // --- Setup ---
    // Create logger instance using level from args/defaults
    const logger = createLogger(argv.logLevel);
    logger.info('CLI arguments parsed:', argv);

    // Merge Config and CLI Args (argv takes precedence, including yargs defaults)
    let headlessValue = defaultConfig.headless;
    const cliHeadless = String(argv.headless).toLowerCase();
    if (cliHeadless === 'true') headlessValue = true;
    else if (cliHeadless === 'false') headlessValue = false;
    else if (cliHeadless === 'new') headlessValue = 'new';

    const options = {
        ...defaultConfig,
        ...argv, // Let argv (with yargs defaults applied) override defaultConfig
        headless: headlessValue, // Apply specifically parsed headless value
        outputDir: path.resolve(argv.outputDir), // Resolve output dir
        // Concurrency ensures minimum of 1
        concurrency: Math.max(1, argv.concurrency),
    };
    logger.debug('Effective options:', options);


    // Instantiate Core Components
    let fileManager;
    let exifWriter;
    let manager;
    try {
        fileManager = new FileManager(logger, options);
        exifWriter = new ExifWriter(logger, options);
        manager = new Manager(fileManager, exifWriter, logger, options);
    } catch (initError) {
        logger.error(`Fatal Error during initialization: ${initError.message}`, { stack: initError.stack });
        process.exitCode = 1;
        if (exifWriter && typeof exifWriter.cleanup === 'function') {
            await exifWriter.cleanup(); // Attempt cleanup
        }
        return; // Stop execution
    }

    // Run the Manager
    try {
        await manager.run(); // Manager handles recursive vs single mode internally
        logger.info('CLI process finished.');
    } catch (runError) {
        logger.error(`Unhandled error during Manager run: ${runError.message}`, { stack: runError.stack });
        process.exitCode = 1; // Indicate failure
        // Ensure cleanup is called even if manager.run throws early
        // Cleanup is now inside Manager's finally block, but call again just in case? Redundant is okay.
        await exifWriter.cleanup();
    }
}

export default runCli;