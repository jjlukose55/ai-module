/* ====================  ai-streaming-module.js  ==================== */
/* A reusable, decoupled ES Module for streaming AI responses.      */
/* ================================================================== */

import fetch from 'node-fetch';

export const LOG_LEVELS = { INFO: 'INFO', DEBUG: 'DEBUG', ERROR: 'ERROR', WARN: 'WARN' };

/**
 * Abstract base class for AI model providers.
 */
export class AIProvider {
  /**
   * @param {object} [logger=console] - A logger object (e.g., console).
   */
  constructor(logger = console) {
    if (this.constructor === AIProvider) {
      throw new Error("Abstract class AIProvider cannot be instantiated directly.");
    }
    this.logger = logger;
  }

  async fetchModels() {
    throw new Error("Method 'fetchModels()' must be implemented.");
  }

  /**
   * Generates a complete (non-streamed) response.
   * @param {object} config - Configuration for the request.
   */
  async generateResponse(config) {
    throw new Error("Method 'generateResponse()' must be implemented.");
  }

  async streamResponse(config) {
    throw new Error("Method 'streamResponse()' must be implemented.");
  }

  async _streamNDJSON(resp, callbacks) {
    const { onContent, onThinking, onDone } = callbacks;
    const decoder = new TextDecoder();
    let leftover = '';

    try {
      this.logger.debug('--- Stream NDJSON: START ---');
      
      // Use 'for await...of' to iterate the Node.js stream from node-fetch
      for await (const chunk of resp.body) {
        // 'chunk' is a Buffer, which TextDecoder handles
        const text = decoder.decode(chunk, { stream: true });
        const lines = (leftover + text).split('\n');
        leftover = lines.pop(); // Keep the last, possibly incomplete, line

        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          const result = this._parseStreamLine(line);

          if (result.isDone) {
            onDone();
            this.logger.debug(`--- Stream NDJSON: END (${result.reason}) ---`);
            return; // Exit the loop and function
          }
          if (typeof result.content === 'string') onContent(result.content);
          if (typeof result.thinking === 'string') onThinking(result.thinking);
        }
      }
      
      // Process any remaining text after the loop
      if (leftover.trim()) {
          const line = leftover.trim();
          const result = this._parseStreamLine(line);
          if (!result.isDone) {
             if (typeof result.content === 'string') onContent(result.content);
             if (typeof result.thinking === 'string') onThinking(result.thinking);
          }
      }

      onDone();
      this.logger.debug('--- Stream NDJSON: END (normal close) ---');
    } catch (error) {
        this.logger.error('Error during stream processing:', error);
        onDone(); // Ensure onDone is always called
    }
    // No 'finally { reader.releaseLock() }' block is needed
  }
  
  _parseStreamLine(line){
      throw new Error("Method '_parseStreamLine()' must be implemented.");
  }
}

/**
 * Provider for OpenAI models.
 */
export class OpenAIProvider extends AIProvider {
    constructor(apiKey, logger = console) {
        super(logger);
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.openai.com/v1';
    }

    async fetchModels() {
        if (!this.apiKey) {
            throw new Error('Please enter an API key first');
        }
        this.logger.info(`Fetching models from ${this.baseUrl}/models`);
        const resp = await fetch(`${this.baseUrl}/models`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        
        this.logger.info(`Fetched ${data.data.length} OpenAI models`);
        return data.data.map(m => ({ id: m.id, name: m.id }));
    }

    _getUrlAndHeaders() {
        return {
            url: `${this.baseUrl}/chat/completions`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
        };
    }

    _buildPayload(config) {
        return {
            model: config.model,
            messages: config.messages,
            temperature: config.temperature,
            stream: config.stream, // Use the stream flag from config
            max_tokens: config.maxTokens,
        };
    }
    
    _parseStreamLine(line) {
        if (line === 'data: [DONE]') {
            return { isDone: true, reason: 'DONE sentinel' };
        }
        if (!line.startsWith('data: ')) {
            return {};
        }

        const jsonStr = line.substring('data: '.length);
        try {
            const obj = JSON.parse(jsonStr);
            const msg = obj.choices?.[0]?.delta ?? {};
            return { content: msg.content };
        } catch (e) {
            this.logger.error(`Invalid JSON line: ${jsonStr}`, e);
            return {};
        }
    }

    /**
     * Internal fetch helper for OpenAI
     */
    async _sendRequestInternal(config) {
        const { url, headers } = this._getUrlAndHeaders();
        const payload = this._buildPayload(config); // Config already has stream flag

        this.logger.info(`>>> POST ${config.stream ? '(stream)' : '(bulk)'} ${url}`);
        this.logger.debug(`Request body: ${JSON.stringify(payload)}`);

        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!resp.ok) {
            const txt = await resp.text();
            throw { status: resp.status, body: txt };
        }
        return resp;
    }

    async generateResponse(config) {
        const resp = await this._sendRequestInternal({ ...config, stream: false });
        const data = await resp.json();
        // Parse the bulk response
        return data?.choices?.[0]?.message?.content || '';
    }

    async streamResponse(config) {
        const resp = await this._sendRequestInternal({ ...config, stream: true });
        await this._streamNDJSON(resp, config);
    }
}

/**
 * Provider for Self-Hosted (Ollama-compatible) models.
 */
export class SelfHostedProvider extends AIProvider {
    constructor(baseUrl, logger = console) {
        super(logger);
        this.baseUrl = baseUrl;
    }

    async fetchModels() {
        if (!this.baseUrl) {
            throw new Error('Please enter a model URL first');
        }
        this.logger.info(`Fetching models from ${this.baseUrl}/api/tags`);
        const resp = await fetch(`${this.baseUrl}/api/tags`);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        this.logger.info(`Fetched ${data.models.length} local models`);
        return data.models.map(m => ({ id: m.name, name: m.name }));
    }

    _getUrlAndHeaders() {
        return {
            url: `${this.baseUrl}/api/chat`,
            headers: { 'Content-Type': 'application/json' },
        };
    }

    /**
     * NEW Helper: Processes messages for Ollama's /api/chat format.
     * Transforms OpenAI-style complex messages into Ollama-style
     * complex messages (with a message-level 'images' array).
     */
    _processMessagesForOllama(messages) {
        const processedMessages = [];

        for (const msg of messages) {
            // Check for complex content (image + text)
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                const ollamaMsg = { role: 'user', content: '', images: [] };
                let textContent = '';

                for (const part of msg.content) {
                    if (part.type === 'text') {
                        textContent += part.text + ' ';
                    } else if (part.type === 'image_url' && part.image_url.url) {
                        // This is the data URL (e.g., "data:image/png;base64,iVBOR...")
                        const dataUrl = part.image_url.url;
                        // Strip the prefix to get only the Base64 data
                        const base64Data = dataUrl.substring(dataUrl.indexOf(',') + 1);
                        ollamaMsg.images.push(base64Data);
                    }
                }
                
                ollamaMsg.content = textContent.trim();

                // Only add the 'images' key if there are images
                if (ollamaMsg.images.length === 0) {
                    // No images found, send as a simple text message
                    processedMessages.push({ role: 'user', content: ollamaMsg.content });
                } else {
                    // Images found, send the complex object
                    processedMessages.push(ollamaMsg);
                }

            } else {
                // This is a simple (text-only) message, so pass it through
                processedMessages.push(msg);
            }
        }
        return processedMessages;
    }


    /**
     * UPDATED Payload Builder
     */
    _buildPayload(config) {
        // Process messages to get the correct Ollama format
        const processedMessages = this._processMessagesForOllama(config.messages);

        const payload = {
            model: config.model,
            messages: processedMessages, // Use the processed, correctly-formatted messages
            stream: config.stream,
            options: {
                temperature: config.temperature,
                num_predict: config.maxTokens,
            },
            think: config.think,
        };
        
        // NO top-level 'images' key. It's now inside the 'messages' array.
        this.logger.debug(`Built Ollama payload.`);
        return payload;
    }

    _parseStreamLine(line) {
        try {
            const obj = JSON.parse(line);
            if (obj.done === true) {
                return { isDone: true, reason: 'self-hosted DONE' };
            }
            const msg = obj.message ?? {};
            return { content: msg.content, thinking: msg.thinking };
        } catch (e) {
            this.logger.error(`Invalid JSON line: ${line}`, e);
            return {};
        }
    }
    
    async _sendRequestInternal(config) {
        const { url, headers } = this._getUrlAndHeaders();
        // _buildPayload now correctly formats for vision/text
        const payload = this._buildPayload(config);

        this.logger.info(`>>> POST ${config.stream ? '(stream)' : '(bulk)'} ${url}`);
        this.logger.debug(`Request body: ${JSON.stringify(payload)}`);
        
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });

        if (!resp.ok) {
            const txt = await resp.text();
            let body;
            try { body = JSON.parse(txt); } catch { body = txt; }
            this.logger.error(`Error body: ${JSON.stringify(body)}`);
            throw { status: resp.status, body };
        }
        return resp;
    }

    async generateResponse(config) {
        // First try with "thinking" if requested
        if (config.think) {
            try {
                const resp = await this._sendRequestInternal({ ...config, stream: false, think: true });
                const data = await resp.json();
                return data?.message?.content || '';
            } catch (err) {
                const errorMsg = err.body?.error || '';
                if (/does not support thinking/.test(errorMsg)) {
                    this.logger.warn('Thinking not supported, retrying without thinking...');
                    // Fall through to retry without thinking
                } else {
                    throw err; // Re-throw other errors
                }
            }
        }
        
        // Standard request without thinking (or fallback)
        const resp = await this._sendRequestInternal({ ...config, stream: false, think: false });
        const data = await resp.json();
        return data?.message?.content || '';
    }

    async streamResponse(config) {
        if (config.think) {
            try {
                const resp = await this._sendRequestInternal({ ...config, stream: true, think: true });
                await this._streamNDJSON(resp, config);
                return;
            } catch (err) {
                const errorMsg = err.body?.error || '';
                if (/does not support thinking/.test(errorMsg)) {
                    this.logger.warn('Thinking not supported, retrying without thinking...');
                } else {
                    throw err;
                }
            }
        }
        
        const resp = await this._sendRequestInternal({ ...config, stream: true, think: false });
        await this._streamNDJSON(resp, config);
    }
}