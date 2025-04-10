// src/file_manager.js
import fs from 'fs/promises';
import path from 'path';

class FileManager {
    constructor(logger, options) {
        this.logger = logger;
        this.extensions = options.supportedImageExtensions || [];
        this.logger.debug(`FileManager initialized with supported extensions: ${this.extensions.join(', ')}`);
    }

    /**
     * Finds immediate subdirectories within a given base path.
     * @param {string} basePath - The path to search for directories.
     * @returns {Promise<string[]>} A promise resolving to an array of absolute subdirectory paths.
     */
    async findSubdirectories(basePath) {
        const absoluteBasePath = path.resolve(basePath);
        this.logger.info(`Searching for subdirectories in: ${absoluteBasePath}`);
        let subdirectories = [];
        try {
            const entries = await fs.readdir(absoluteBasePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const fullPath = path.join(absoluteBasePath, entry.name);
                    this.logger.debug(`Found subdirectory: ${fullPath}`);
                    subdirectories.push(fullPath);
                }
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.error(`Base path not found: ${absoluteBasePath}`);
            } else {
                this.logger.error(`Error reading base path ${absoluteBasePath}: ${error.message}`, { stack: error.stack });
            }
            throw new Error(`Failed to list subdirectories for path: ${absoluteBasePath}`);
        }
        this.logger.info(`Found ${subdirectories.length} subdirectory(s).`);
        // Sort alphabetically for consistent pairing
        subdirectories.sort();
        return subdirectories;
    }


    /**
     * Finds image files in a given path, optionally recursively.
     * @param {string} inputPath - The starting directory or file path.
     * @param {boolean} recurse - Whether to search subdirectories *within* this inputPath.
     * @returns {Promise<string[]>} A promise resolving to an array of absolute image file paths.
     */
    async findImageFiles(inputPath, recurse = false) {
        // This method remains mostly the same, but clarify logging
        const absoluteInputPath = path.resolve(inputPath);
        this.logger.info(`Searching for images in: ${absoluteInputPath} (Recursive within this dir: ${recurse})`);
        let imageFiles = [];

        try {
            const stats = await fs.stat(absoluteInputPath);

            if (stats.isFile()) {
                if (this.isSupportedImage(absoluteInputPath)) {
                    this.logger.debug(`Found single supported image file: ${absoluteInputPath}`);
                    imageFiles.push(absoluteInputPath);
                } else {
                    this.logger.warn(`Input file is not a supported image type: ${absoluteInputPath}`);
                }
            } else if (stats.isDirectory()) {
                await this._readDirectoryForImages(absoluteInputPath, recurse, imageFiles);
            } else {
                this.logger.error(`Input path is neither a file nor a directory: ${absoluteInputPath}`);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.error(`Image input path not found: ${absoluteInputPath}`);
            } else {
                this.logger.error(`Error accessing image input path ${absoluteInputPath}: ${error.message}`, { stack: error.stack });
            }
            // Don't necessarily throw here, allow manager to handle empty list
        }

        this.logger.info(`Found ${imageFiles.length} supported image file(s) in ${absoluteInputPath}.`);
        return imageFiles;
    }

    /** Internal helper for recursively finding images */
    async _readDirectoryForImages(dirPath, recurse, imageFiles) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory() && recurse) {
                    // Only recurse if flag is true for *within* the dir
                    this.logger.debug(`Entering subdirectory for images: ${fullPath}`);
                    await this._readDirectoryForImages(fullPath, recurse, imageFiles);
                } else if (entry.isFile() && this.isSupportedImage(fullPath)) {
                    this.logger.debug(`Found supported image: ${fullPath}`);
                    imageFiles.push(path.resolve(fullPath));
                }
            }
        } catch (error) {
            this.logger.error(`Error reading directory ${dirPath} for images: ${error.message}`);
        }
    }

    /** Checks if a file path has a supported image extension. */
    isSupportedImage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.extensions.includes(ext);
    }
}

export default FileManager;