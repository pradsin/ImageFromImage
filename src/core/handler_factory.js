// src/core/handler_factory.js
import GeminiHandler from '../handlers/gemini_handler.js';
import ChatGptHandler from '../handlers/chatgpt_handler.js'; // Import the new handler
// Future imports:
// import SeaArtHandler from '../handlers/seaart_handler.js';

/**
 * Creates and returns the appropriate platform handler based on URL or options.
 * @param {object} options - Application configuration options.
 * @param {object} logger - The shared logger instance.
 * @returns {BaseHandler} An instance of a platform-specific handler.
 * @throws {Error} If no suitable handler is found.
 */
function getHandler(options, logger) {
    // Prefer explicit platform flag
    const platform = options.platform?.toLowerCase();
    // Fallback to URL detection
    const url = options.url || options.geminiUrl || options.chatgptUrl || ''; // Get URL from options
    const lowerCaseUrl = url.toLowerCase();

    logger.info(`Determining handler... (Platform flag: ${platform}, URL: ${url})`);

    // Explicit platform selection
    if (platform === 'gemini') {
        logger.info('Selected GeminiHandler based on --platform flag.');
        return new GeminiHandler(options, logger);
    } else if (platform === 'chatgpt') {
        logger.info('Selected ChatGptHandler based on --platform flag.');
        return new ChatGptHandler(options, logger); // Return new handler
    }
    // Add other explicit platform checks here...

    // Fallback to URL detection if platform not specified
    if (!platform && url) {
        if (lowerCaseUrl.includes('gemini.google.com')) {
            logger.info('Selected GeminiHandler based on URL.');
            return new GeminiHandler(options, logger);
        } else if (lowerCaseUrl.includes('chatgpt.com') || lowerCaseUrl.includes('chat.openai.com')) { // UPDATED CHECK
            logger.info('Selected ChatGptHandler based on URL.');
            return new ChatGptHandler(options, logger); // Return new handler
        }
        // Add other URL checks here...
    }

    // If neither platform nor a matching URL was provided/found
    const message = `Could not determine platform handler for platform='${platform}', url='${url}'. Provide a supported --url or use --platform (e.g., --platform gemini, --platform chatgpt).`;
    logger.error(message);
    throw new Error(message);
}

export default {
    getHandler,
};