// src/config.js
import path from 'path';
import os from 'os';

// --- User Configuration ---
const DEFAULT_PROMPT = "Render this image as a richly textured oil painting, resembling a museum-quality handmade canvas artwork. Style of Raja Ravi Varma. Wide aspect ratio.";
const DEFAULT_OUTPUT_DIR = './output'; // For logs, screenshots etc.
const DEFAULT_LOG_LEVEL = 'info';
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'];

// --- EXIF Configuration ---
const EXIF_APP_NAME = 'imageFromImage'; // Namespace for our data
const EXIF_SUCCESS_KEY = 'successCount';
const EXIF_FAILED_KEY = 'failedCount';

// --- Puppeteer Configuration ---
const DEFAULT_WAIT_TIMEOUT = 5000; // General purpose wait (can be overridden by CLI)
const DEFAULT_NAVIGATION_TIMEOUT = 60000; // Page navigation timeout
const DEFAULT_ACTION_TIMEOUT = 30000; // Timeout for clicks, typing etc.
const HEADLESS_MODE = false; // User preference
const BROWSER_ARGS = [
    // User preference: Only UA uncommented
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    // '--disable-infobars',
    // '--window-position=0,0',
    // '--ignore-certificate-errors',
    // '--ignore-certificate-errors-spki-list',
    // '--disable-gpu',
];
const VIEWPORT = null; // User preference

// --- Platform Selectors ---
// !!! IMPORTANT: Verify selectors regularly, websites change! !!!
const SELECTORS = {
    gemini: {
        readySelectors: [
            'div.ql-editor.textarea.new-input-ui',
            'button[aria-label="Open upload file menu"]'
        ],
        promptTextarea: 'div.ql-editor.textarea.new-input-ui',
        uploadButtonInitiator: 'button[aria-label="Open upload file menu"]',
        uploadButtonLocalImage: 'button#image-uploader-local',
        imagePreviewConfirmation: 'img[data-test-id="image-preview"]',
        submitButton: 'button.send-button.submit',
        responseArea: 'model-response',
        imageInResponse: 'img',
        loadingIndicator: 'progress-indicator', // Placeholder
        captchaSelectors: [ // Example
            // 'iframe[src*="recaptcha"]',
            // '#captcha-container'
        ],
    },
    chatgpt: {
        readySelectors: [
            // Only check visible button now
            'button[aria-label="Upload files and more"]'
        ],
        promptTextarea: '#prompt-textarea', // The contenteditable div
        uploadButtonInitiator: 'button[aria-label="Upload files and more"]', // The '+' button
        fileInputHidden: 'input[type="file"][tabindex="-1"]', // The hidden input for upload
        imagePreviewConfirmation: 'div.w-fit span[style*="background-image"]', // Span showing preview via style
        submitButton: 'button[data-testid="send-button"]', // Send button
        loadingIndicator: 'button[data-testid="stop-button"]', // Stop button
        responseArea: 'div[data-message-author-role="assistant"]', // Assistant response block
        imageInResponse: 'img[alt="Generated image"]', // The generated image
        captchaSelectors: [ // Selectors for CAPTCHA detection
            'iframe[src*="challenges.cloudflare.com"]',
            'iframe[src*="hcaptcha"]',
            '#turnstile-wrapper',
        ],
    }
    // seaart: { ... }
};


// --- Exported Configuration ---
export default {
    defaultPrompt: DEFAULT_PROMPT,
    outputDir: DEFAULT_OUTPUT_DIR,
    logLevel: DEFAULT_LOG_LEVEL,
    supportedImageExtensions: SUPPORTED_IMAGE_EXTENSIONS,
    exifAppName: EXIF_APP_NAME,
    exifSuccessKey: EXIF_SUCCESS_KEY,
    exifFailedKey: EXIF_FAILED_KEY,
    headless: HEADLESS_MODE,
    browserArgs: BROWSER_ARGS,
    viewport: VIEWPORT,
    userDataDir: null, // Set via CLI
    waitTimeout: DEFAULT_WAIT_TIMEOUT, // General wait, used between files by Manager
    navigationTimeout: DEFAULT_NAVIGATION_TIMEOUT,
    actionTimeout: DEFAULT_ACTION_TIMEOUT, // Default for clicks/waits within service methods

    // --- ADDED THIS LINE ---
    chatGptResponseRenderWaitSeconds: 120, // Fixed wait in seconds (e.g., 2 minutes). ADJUST AS NEEDED!

    selectors: SELECTORS,

    // Default URLs (can be overridden by --url)
    geminiUrl: 'https://gemini.google.com/app',
    chatgptUrl: 'https://chatgpt.com/',

    // Optional ExifTool Path
    // exiftoolPath: process.env.EXIFTOOL_PATH || 'path/to/exiftool',
};