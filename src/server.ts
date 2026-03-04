import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ApplicationModule } from './modules/app.module';
import { CommonModule, LogInterceptor } from './modules/common';
import { SecurityConfigService } from './modules/config/service/security-config.service';

/**
 * These are API defaults that can be changed using environment variables,
 * it is not required to change them (see the `.env.example` file)
 */
const PORT = process.env.API_PORT || 3000;
const API_DEFAULT_PREFIX = '/api/v1/';

/**
 * The defaults below are dedicated to Swagger configuration, change them
 * following your needs (change at least the title & description).
 *
 * @todo Change the constants below following your API requirements
 */
const SWAGGER_TITLE = 'API Pelezi Whatsapp Bot';
const SWAGGER_DESCRIPTION = 'API completa para gerenciar o Pelezi Whatsapp Bot e suas integrações.';
const SWAGGER_PREFIX = '/docs';

/**
 * Register a Swagger module in the NestJS application.
 * This method mutates the given `app` to register a new module dedicated to
 * Swagger API documentation. Any request performed on `SWAGGER_PREFIX` will
 * receive a documentation page as response.
 *
 * @todo See the `nestjs/swagger` NPM package documentation to customize the
 *       code below with API keys, security requirements, tags and more.
 */
function createSwagger(app: INestApplication) {

    const options = new DocumentBuilder()
        .setTitle(SWAGGER_TITLE)
        .setDescription(SWAGGER_DESCRIPTION)
        .addBearerAuth()
        .addApiKey({
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
            description: 'API Key para autenticação de APIs externas'
        }, 'api-key')
        .build();

    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup(SWAGGER_PREFIX, app, document);
}

/**
 * Build & bootstrap the NestJS API.
 * This method is the starting point of the API; it registers the application
 * module and registers essential components such as the logger and request
 * parsing middleware.
 */
async function bootstrap(): Promise<void> {

    const app = await NestFactory.create<NestFastifyApplication>(
        ApplicationModule,
        new FastifyAdapter()
    );

    // Register multipart/form-data support for file uploads
    await app.register(require('@fastify/multipart'), {
        limits: {
            fileSize: 50 * 1024 * 1024, // 50MB max file size
            files: 10, // Maximum number of file fields
            fieldSize: 100 * 1024 * 1024, // 100MB max field size (for JSON data)
            fields: 100, // Maximum number of non-file fields

        }
    });

    // Validate security configuration on startup
    // This ensures that JWT_SECRET, JWT_ISSUER and other critical configs are set
    // The SecurityConfigService constructor will throw if validation fails
    try {
        app.get(SecurityConfigService);
        console.log('✓ Configuração de segurança validada com sucesso');
    } catch (error: unknown) {
        console.error('✗ Falha na validação da configuração de segurança');
        throw error;
    }
    // Enable CORS for frontend access
    // Support multiple origins using `CORS_ORIGINS` (comma-separated) or
    // the legacy single `CORS_ORIGIN` env var.
    // const corsOriginsEnv = process.env.CORS_ORIGIN || 'http://localhost:3005';
    // const allowedOrigins = corsOriginsEnv
    //     .split(',')
    //     .map(o => o.trim())
    //     .filter(Boolean);

    app.enableCors({
        // Use a function so we can validate dynamically and support Fastify/Express
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    });

    // @todo Enable Helmet for better API security headers

    app.setGlobalPrefix(process.env.API_PREFIX || API_DEFAULT_PREFIX);

    if (!process.env.SWAGGER_ENABLE || process.env.SWAGGER_ENABLE === '1') {
        createSwagger(app);
    }

    const logInterceptor = app.select(CommonModule).get(LogInterceptor);
    app.useGlobalInterceptors(logInterceptor);

    await app.listen(PORT, '0.0.0.0', () => {
        console.log(`Example app listening on port ${PORT}`);
    });
}

/**
 * It is now time to turn the lights on!
 * Any major error that can not be handled by NestJS will be caught in the code
 * below. The default behavior is to display the error on stdout and quit.
 *
 * @todo It is often advised to enhance the code below with an exception-catching
 *       service for better error handling in production environments.
 */
bootstrap().catch(err => {

    // eslint-disable-next-line no-console
    console.error(err);

    const defaultExitCode = 1;
    process.exit(defaultExitCode);
});
