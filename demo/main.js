import {
    LOG_LEVELS,
    OpenAIProvider,
    SelfHostedProvider
} from './ai-module.js';

// ===================================================================
// =================  Application-Specific Logic  ====================
// ===================================================================
// These functions are specific to this HTML page and handle all
// DOM interaction, state management, and orchestration.
// ===================================================================

const now = () => new Date().toISOString();

/**
 * Application-specific logging helper. Writes to the DOM.
 */
function log(msg, level = LOG_LEVELS.INFO, raw = null) {
  const line = `${now()} [${level}] ${msg}\n`;
  console.log(level === LOG_LEVELS.ERROR ? msg : line.trim());
  const logEl = document.getElementById('log');
  if (logEl) {
    logEl.textContent += raw ? `${line}${JSON.stringify(raw, null, 2)}\n` : line;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

/**
 * Application-specific spinner helper.
 */
function showSpinner(show) {
  const spinnerEl = document.getElementById('spinner');
  if (spinnerEl) {
    spinnerEl.style.display = show ? 'block' : 'none';
  }
  log(`Spinner ${show ? 'SHOW' : 'HIDE'}`, LOG_LEVELS.DEBUG);
}

/**
 * Application-specific status helper.
 */
function showStatus(message, type = 'info') {
    log(message, type === 'error' ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO);
}

/**
 * Application-specific factory to get the correct provider instance.
 * It reads from the DOM and injects the application logger.
 */
function getProvider() {
    const type = document.getElementById('modelType').value;
    
    // Create a logger object that matches the `console` interface
    // but routes to our application's `log` function.
    const appLogger = {
        info: (msg) => log(msg, LOG_LEVELS.INFO),
        debug: (msg) => log(msg, LOG_LEVELS.DEBUG),
        warn: (msg) => log(msg, LOG_LEVELS.WARN),
        error: (msg, err) => log(msg, LOG_LEVELS.ERROR, err),
    };

    if (type === 'openai') {
        const apiKey = document.getElementById('apiKey').value.trim();
        return new OpenAIProvider(apiKey, appLogger);
    }
    if (type === 'selfhosted') {
        const url = document.getElementById('modelUrl').value.trim();
        return new SelfHostedProvider(url, appLogger);
    }
    return null;
}

/**
 * Fetches models using the currently selected provider and updates the UI.
 */
async function fetchModels() {
    const provider = getProvider();
    const select = document.getElementById('modelSelect');
    const refreshBtn = document.getElementById('refreshModels');

    if (!provider) {
        showStatus('Please select a valid model type.', 'error');
        return;
    }
    
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    refreshBtn.disabled = true;
    select.innerHTML = '<option value="">Fetching...</option>';

    try {
        const models = await provider.fetchModels();
        select.innerHTML = '<option value="">Select a model...</option>';
        models.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            select.appendChild(opt);
        });
        showStatus(`Loaded ${models.length} models`);
    } catch (err) {
        console.error(err);
        select.innerHTML = '<option value="">No Models Found</option>';
        showStatus(`Error fetching models: ${err.message}`, 'error');
    } finally {
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
        refreshBtn.disabled = false;
    }
}

/**
 * Main orchestration function to stream or bulk-generate AI responses.
 * Manages spinners and UI updates based on callbacks.
 * @param {object} config - Configuration object
 * @param {boolean} config.stream - Whether to stream the response.
 */
async function handleAIRequest(config) {
  const provider = getProvider();
  
  if (!provider) {
    const error = { message: 'Invalid model provider selected.' };
    if (config.onError) config.onError(error);
    else log(error.message, LOG_LEVELS.ERROR);
    return;
  }
  
  try {
    showSpinner(true);
    
    if (config.stream) {
        // --- Streaming Path ---
        log('Requesting stream response...', LOG_LEVELS.DEBUG);
        // Pass callbacks directly to the provider
        await provider.streamResponse(config);
    } else {
        // --- Bulk Response Path ---
        log('Requesting bulk response...', LOG_LEVELS.DEBUG);
        const content = await provider.generateResponse(config);
        
        // Manually trigger callbacks
        if (config.onContent) {
            config.onContent(content);
        }
        if (config.onDone) {
            config.onDone();
        }
    }
  } catch (error) {
    console.error('AI Streaming Error:', error);
    if (config.onError) {
      config.onError(error);
    } else {
      log(`AI request failed: ${error.message || error}`, LOG_LEVELS.ERROR);
    }
  } finally {
    showSpinner(false);
    // For streaming, onDone is called by the provider
    // For bulk, onDone is called above
    // This finally block just ensures spinner is hidden
  }
}

/**
 * Sets up event listeners for auto-fetching models when config changes.
 */
function setupModelAutoFetch() {
    const modelTypeEl = document.getElementById('modelType');
    const apiKeyEl = document.getElementById('apiKey');
    const modelUrlEl = document.getElementById('modelUrl');
    
    // Note: This function now calls fetchModels() which is defined
    // in this same file.
    modelTypeEl.addEventListener('change', () => setTimeout(fetchModels, 100));
    
    let apiKeyTimeout;
    apiKeyEl.addEventListener('input', function() {
        clearTimeout(apiKeyTimeout);
        if (modelTypeEl.value === 'openai' && this.value.trim().length > 10) {
            apiKeyTimeout = setTimeout(fetchModels, 1000);
        }
    });

    let urlTimeout;
    modelUrlEl.addEventListener('input', function() {
        clearTimeout(urlTimeout);
        if (modelTypeEl.value === 'selfhosted' && this.value.trim().length > 5) {
            urlTimeout = setTimeout(fetchModels, 1000);
        }
    });
}


// ===================================================================
// ====================  Application Entry Point  ====================
// ===================================================================

document.addEventListener('DOMContentLoaded', () => {
    log('DOM fully loaded and parsed.');

    // --- Get DOM Elements ---
    const modelTypeEl = document.getElementById('modelType');
    const openaiSettingsEl = document.getElementById('openai-settings');
    const selfhostedSettingsEl = document.getElementById('selfhosted-settings');
    const sendButton = document.getElementById('sendButton');
    const promptEl = document.getElementById('prompt');
    const responseEl = document.getElementById('response');
    const refreshModelsBtn = document.getElementById('refreshModels');
    const streamCheckbox = document.getElementById('streamCheckbox'); // Get the checkbox

    // --- Initial Setup ---
    
    // Call the setup function to enable auto-fetching
    setupModelAutoFetch();
    log('Auto-fetch for models has been set up.');

    // Function to toggle visibility of provider-specific settings
    const toggleProviderSettings = () => {
        const selectedType = modelTypeEl.value;
        log(`Model type changed to: ${selectedType}`);
        openaiSettingsEl.style.display = selectedType === 'openai' ? 'block' : 'none';
        selfhostedSettingsEl.style.display = selectedType === 'selfhosted' ? 'block' : 'none';
    };
    
    // --- Attach Event Listeners ---

    // Toggle settings visibility when provider changes
    modelTypeEl.addEventListener('change', toggleProviderSettings);

    // Manually refresh models when the refresh button is clicked
    refreshModelsBtn.addEventListener('click', () => {
        log('Manual model refresh triggered.', LOG_LEVELS.INFO);
        fetchModels();
    });

    // Handle the main "Send" button click
    sendButton.addEventListener('click', async () => {
        const model = document.getElementById('modelSelect').value;
        const prompt = promptEl.value.trim();
        const stream = streamCheckbox.checked; // Check if streaming is enabled

        if (!model) {
            alert('Please select a model from the list.');
            return;
        }
        if (!prompt) {
            alert('Please enter a prompt.');
            return;
        }

        log(`Sending prompt to model: ${model}`, LOG_LEVELS.INFO);
        
        // Clear previous response and set button to loading state
        responseEl.textContent = '';
        sendButton.disabled = true;

        // Construct the message history
        const messages = [{
            role: 'user',
            content: prompt
        }];

        // Call the main streaming function
        await handleAIRequest({
            // --- Core Config ---
            model: model,
            messages: messages,
            stream: stream, // Pass the stream flag

            // --- Callbacks ---
            onContent: (chunk) => {
                // For bulk, 'chunk' will be the full response
                responseEl.textContent += chunk;
            },
            onThinking: (thought) => {
                // You could display this in a separate "thinking..." element
                log(`Model is thinking: ${thought}`, LOG_LEVELS.DEBUG);
            },
            onDone: () => {
                log('Request finished successfully.', LOG_LEVELS.INFO);
                sendButton.disabled = false;
            },
            onError: (err) => {
                console.error('An error occurred during streaming:', err);
                const errorMessage = `ERROR: ${err.status ? `HTTP ${err.status}` : ''} ${err.message || 'An unknown error occurred.'}`;
                responseEl.textContent = errorMessage;
                log(errorMessage, LOG_LEVELS.ERROR, err.body || err);
                sendButton.disabled = false;
            },

            // --- Optional Parameters ---
            think: true, // For self-hosted models that support it
            temperature: 0.7,
            maxTokens: 4000
        });
    });

    // --- Initial State Calls ---
    toggleProviderSettings(); // Set initial visibility
});