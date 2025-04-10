// src/logger.js
import winston from 'winston';

const {combine, timestamp, printf, colorize, align, errors} = winston.format;

let loggerInstance = null;

function createLogger(level = 'info') {
    if (loggerInstance) {
        // Update level if already created? Or just return existing?
        // For simplicity, we'll return the existing one. Level is set on first call.
        return loggerInstance;
    }

    const logFormat = printf(({level, message, timestamp, stack}) => {
        // Include stack trace in the message if present
        const logMessage = stack ? `${message}\n${stack}` : message;
        return `${timestamp} [${level}]: ${logMessage}`;
    });

    loggerInstance = winston.createLogger({
        level: level || process.env.LOG_LEVEL || 'info',
        format: combine(
            colorize({all: true}),
            timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
            align(),
            errors({stack: true}), // Ensure stack traces are captured
            logFormat
        ),
        transports: [
            new winston.transports.Console({
                stderrLevels: ['error'], // Ensure errors go to stderr
            }),
            // TODO: Add file transport if needed, configure rotation
            // new winston.transports.File({ filename: path.join(options.outputDir, 'app.log'), level: 'debug' }),
        ],
        exceptionHandlers: [
            new winston.transports.Console(),
            // new winston.transports.File({ filename: path.join(options.outputDir, 'exceptions.log') })
        ],
        rejectionHandlers: [
            new winston.transports.Console(),
            // new winston.transports.File({ filename: path.join(options.outputDir, 'rejections.log') })
        ]
    });

    loggerInstance.info(`Logger initialized with level: ${loggerInstance.level}`);
    return loggerInstance;
}

// Export function to allow level setting during instantiation
export default createLogger;