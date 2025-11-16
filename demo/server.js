import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAIProvider, SelfHostedProvider } from 'ai-module';
import multer from 'multer';

// --- Server Setup ---
const app = express();
const port = process.env.PORT || 3000;

// --- Add multer setup ---
const upload = multer({ storage: multer.memoryStorage() });

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
app.post('/api/chat', upload.single('image'), async (req, res) => {
  
  // The config now comes from a 'payload' field in the form data
  if (!req.body.payload) {
    return res.status(400).json({ error: 'Missing payload' });
  }
  
  // 1. Parse the main configuration
  const config = JSON.parse(req.body.payload);
  const { providerType, model, modelUrl, apiKey, stream } = config;
  let provider;

  try {
    // 2. Provider Setup
    if (providerType === 'openai') {
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error('Missing OpenAI API key on server.');
      provider = new OpenAIProvider(key, logger);

    } else if (providerType === 'selfhosted') {
      const url = modelUrl || process.env.MODEL_URL;
      if (!url) throw new Error('Missing Self-Hosted model URL on server.');
      provider = new SelfHostedProvider(url, logger);

    } else {
      throw new Error(`Unknown provider type: ${providerType}`);
    }

    // 3. Handle Image (if provided)
    if (req.file) {
      logger.info('Image file detected, injecting into message payload.');
      const mimeType = req.file.mimetype || 'image/png';
      const imageBase64 = req.file.buffer.toString('base64');
      const imageData = `data:${mimeType};base64,${imageBase64}`;
      
      // Find the last user message and add the image to it
      const lastUserMsg = config.messages.slice().reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        // Convert simple string content to complex array content
        const originalText = lastUserMsg.content;
        lastUserMsg.content = [
          { type: 'text', text: originalText },
          { type: 'image_url', image_url: { url: imageData } }
        ];
      } else {
        logger.warn('Image provided but no user message found to attach it to.');
      }
    }

    // 4. Set up callbacks (for streaming)
    config.onContent = (chunk) => {
        if (stream) res.write(chunk);
    };
    config.onThinking = (thought) => {
        logger.info(`Thinking: ${thought}`);
    };
    config.onDone = () => {
        if (stream) res.end();
        logger.info('--- AI response complete ---');
    };

    logger.info(`Proxying ${stream ? 'stream' : 'bulk'} request to ${providerType} model ${model}`);

    // 5. Conditionally handle stream vs. bulk
    if (stream) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Transfer-Encoding', 'chunked');
        // streamResponse will use the onContent/onDone callbacks
        await provider.streamResponse(config);
    } else {
        // generateResponse will return the full text content
        const content = await provider.generateResponse(config);
        res.json({ content: content }); // Send back as a single JSON object
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