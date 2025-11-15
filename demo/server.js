import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAIProvider, SelfHostedProvider } from 'ai-module'; // Imports your module!

// --- Server Setup ---
const app = express();
const port = process.env.PORT || 3000;

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
};

// --- Middleware ---
// 1. Serve static files (your index.html and main.js) from the current folder
app.use(express.static(__dirname));
// 2. Parse JSON bodies for our API
app.use(express.json());

// --- NEW API Endpoint: Fetch Models ---
app.post('/api/models', async (req, res) => {
  const { providerType, apiKey, modelUrl } = req.body;
  let provider;

  try {
    // --- Provider Setup (on the server) ---
    if (providerType === 'openai') {
      const key = apiKey || process.env.OPENAI_API_KEY; // Securely get key
      if (!key) {
        throw new Error('Missing OpenAI API key on server.');
      }
      provider = new OpenAIProvider(key, logger);

    } else if (providerType === 'selfhosted') {
      const url = modelUrl || process.env.MODEL_URL;
      if (!url) {
        throw new Error('Missing Self-Hosted model URL on server.');
      }
      provider = new SelfHostedProvider(url, logger);

    } else {
      throw new Error(`Unknown provider type: ${providerType}`);
    }

    // --- Fetch Models ---
    logger.info(`Fetching models for ${providerType}...`);
    const models = await provider.fetchModels();
    res.json(models); // Send the array of models back to the client

  } catch (error) {
    logger.error('An error occurred fetching models:', error.message || error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'An unknown server error occurred' });
    }
  }
});


// --- API Endpoint ---
// Your browser will send requests to this URL
app.post('/api/chat', async (req, res) => {
  const { providerType, model, messages, apiKey, modelUrl, stream, think, temperature, maxTokens } = req.body;

  let provider;

  try {
    // --- Provider Setup (on the server) ---
    if (providerType === 'openai') {
      const key = apiKey || process.env.OPENAI_API_KEY; // Securely get key
      if (!key) {
        throw new Error('Missing OpenAI API key on server.');
      }
      provider = new OpenAIProvider(key, logger);

    } else if (providerType === 'selfhosted') {
      const url = modelUrl || process.env.MODEL_URL;
      if (!url) {
        throw new Error('Missing Self-Hosted model URL on server.');
      }
      provider = new SelfHostedProvider(url, logger);

    } else {
      throw new Error(`Unknown provider type: ${providerType}`);
    }

    // --- AI Request Config ---
    const config = {
        model,
        messages,
        think,
        temperature,
        maxTokens,
        onContent: (chunk) => {
            if (stream) res.write(chunk); // Stream chunk to browser
        },
        onThinking: (thought) => {
            logger.info(`Thinking: ${thought}`);
        },
        onDone: () => {
            if (stream) res.end(); // Close the stream
            logger.info('--- Stream complete ---');
        },
    };

    logger.info(`Proxying ${stream ? 'stream' : 'bulk'} request to ${providerType} model ${model}`);

    if (stream) {
        // --- Streaming Path ---
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Transfer-Encoding', 'chunked');
        await provider.streamResponse(config);
    } else {
        // --- Bulk Path ---
        const content = await provider.generateResponse(config);
        res.json({ content }); // Send back as a single JSON object
    }

  } catch (error) {
    logger.error('An error occurred:', error.message || error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'An unknown server error occurred' });
    } else {
      res.end();
    }
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('Your frontend is now being served from this server.');
});