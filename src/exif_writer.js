// src/exif_writer.js
import { ExifTool } from 'exiftool-vendored';
import path from 'path';

class ExifWriter {
    constructor(logger, options) {
        this.logger = logger;
        this.appName = options.exifAppName;
        this.successKey = options.exifSuccessKey;
        this.failedKey = options.exifFailedKey;
        const exiftoolOptions = options.exiftoolPath ? { exiftoolPath: options.exiftoolPath } : {};
        this.exiftool = new ExifTool(exiftoolOptions);
        this.targetExifField = 'Make'; // This field will have count of successful creation and unsuccessful creation
        this.logger.info(`ExifWriter initialized for app '${this.appName}'. Success key: '${this.successKey}', Failed key: '${this.failedKey}'.`);
        this.logger.info(`Targeting EXIF field: ${this.targetExifField}`);
        this.logger.debug(`Using ExifTool path: ${this.exiftool.exiftoolPath}`);
    }

    /**
     * Reads the application-specific JSON data from the target EXIF tag.
     * Kept private as it's an internal detail.
     * @param {string} filePath - Absolute path to the image file.
     * @returns {Promise<object|null>} The parsed data object or null on error/not found.
     * @private
     */
    async _readAppDataInternal(filePath) {
        // Renamed to avoid conflict if user wants different public read later
        try {
            const tags = await this.exiftool.read(filePath, [`-${this.targetExifField}`]);
            const tagValue = tags?.[this.targetExifField];

            if (!tagValue || typeof tagValue !== 'string') {
                return null;
            }

            let parsedData;
            try {
                parsedData = JSON.parse(tagValue);
            } catch (parseError) {
                // Log only if parsing fails on existing data, ignore for overwrite warning here
                this.logger.debug(`Data in ${this.targetExifField} of ${path.basename(filePath)} is not valid JSON: "${tagValue}".`);
                return null;
            }

            if (parsedData && typeof parsedData === 'object' && parsedData[this.appName]) {
                this.logger.debug(`Found existing app data in ${this.targetExifField} for ${path.basename(filePath)}.`);
                return parsedData[this.appName]; // Return only our app's nested data
            } else {
                return null;
            }

        } catch (error) {
            // Only log errors not related to file missing (which is handled by Manager checking existence first)
            if (!error.message.includes("File not found")) {
                this.logger.error(`EXIF Read Error for ${this.targetExifField} in ${path.basename(filePath)}: ${error.message}`);
            }
            return null;
        }
    }

    /**
     * Public method to get the application-specific data (including counts).
     * @param {string} filePath - Absolute path to the image file.
     * @returns {Promise<object|null>} Object like { successCount: N, failedCount: M } or null if no data.
     */
    async getAppData(filePath) {
        this.logger.debug(`Reading app data from ${this.targetExifField} for ${path.basename(filePath)}`);
        const appData = await this._readAppDataInternal(filePath);
        // Return the app data directly, or null if not found/error
        return appData;
    }


    /**
     * Increments a success or failure counter in the image's target EXIF tag.
     * @param {string} filePath - Absolute path to the image file.
     * @param {string} keyToIncrement - Either the successKey or failedKey from config.
     * @returns {Promise<boolean>} True if the update was successful, false otherwise.
     */
    async incrementCounter(filePath, keyToIncrement) {
        if (keyToIncrement !== this.successKey && keyToIncrement !== this.failedKey) {
            this.logger.error(`Invalid key provided to incrementCounter: ${keyToIncrement}`);
            return false;
        }

        this.logger.info(`Attempting to increment '${keyToIncrement}' counter in ${this.targetExifField} for: ${path.basename(filePath)}`);

        // Use the internal reader, default to 0 counts if no data exists
        let currentAppData = await this._readAppDataInternal(filePath);
        const defaultData = { [this.successKey]: 0, [this.failedKey]: 0 };
        currentAppData = { ...defaultData, ...(currentAppData || {}) }; // Merge with defaults

        // Increment the specified counter
        currentAppData[keyToIncrement]++;

        this.logger.debug(`New counts for ${path.basename(filePath)}: Success=${currentAppData[this.successKey]}, Failed=${currentAppData[this.failedKey]}`);

        const finalTagData = {
            [this.appName]: currentAppData,
        };
        const jsonString = JSON.stringify(finalTagData);

        try {
            const updateData = {};
            updateData[this.targetExifField] = jsonString;

            await this.exiftool.write(filePath, updateData, ['-overwrite_original']);
            this.logger.info(`Successfully updated EXIF ${this.targetExifField} for ${path.basename(filePath)}.`);
            return true;
        } catch (error) {
            this.logger.error(`EXIF Write Error for ${this.targetExifField} in ${path.basename(filePath)}: ${error.message}`, { stack: error.stack });
            return false;
        }
    }

    /** Cleans up the ExifTool process. */
    async cleanup() {
        this.logger.info('Shutting down ExifTool process...');
        try {
            if (this.exiftool && typeof this.exiftool.end === 'function') {
                // Added check for syncShutdown to potentially speed up exit on Windows
                const shouldSyncShutdown = process.platform === 'win32';
                await this.exiftool.end(shouldSyncShutdown);
                if (shouldSyncShutdown) {
                    this.logger.debug('ExifTool end called with syncShutdown=true for Windows.');
                }
                this.logger.info('ExifTool process ended successfully.');
            } else {
                this.logger.warn('Exiftool instance or end method not available for cleanup.');
            }
        } catch (error) {
            this.logger.error(`Error ending ExifTool process: ${error.message}`);
        }
    }
}

export default ExifWriter;