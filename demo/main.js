// ===================================================================
// =================  Application-Specific Logic  ====================
// ===================================================================
// This is the BROWSER code. It makes fetch requests to our
// OWN server (server.js). It does NOT import 'ai-module'.
// ===================================================================

const LOG_LEVELS = { INFO: 'INFO', DEBUG: 'DEBUG', ERROR: 'ERROR', WARN: 'WARN' };
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
 * This function now fetches models from our server's API.
 */
async function fetchModels() {
    log('Fetching models from server...', LOG_LEVELS.INFO);
    
    const providerType = document.getElementById('modelType').value;
    const apiKey = document.getElementById('apiKey').value.trim();
    const modelUrl = document.getElementById('modelUrl').value.trim();
    
    const select = document.getElementById('modelSelect');
    const refreshBtn = document.getElementById('refreshModels');

    if (!providerType) {
        showStatus('Please select a valid model type.', 'error');
        return;
    }
    
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    refreshBtn.disabled = true;
    select.innerHTML = '<option value="">Fetching...</option>';
    select.disabled = true;

    try {
        // Call our new /api/models endpoint
        const response = await fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                providerType,
                apiKey: apiKey || null,
                modelUrl: modelUrl || null
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `HTTP error! status: ${response.status}`);
        }

        const models = await response.json();
        
        select.innerHTML = '<option value="">Select a model...</option>';
        models.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            select.appendChild(opt);
        });
        select.disabled = false;
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
    const streamCheckbox = document.getElementById('streamCheckbox');
    const modelSelect = document.getElementById('modelSelect');
    const apiKeyEl = document.getElementById('apiKey');
    const modelUrlEl = document.getElementById('modelUrl');
    const imageUploadEl = document.getElementById('imageUpload'); // <-- ADDED

    // --- Initial Setup ---
    setupModelAutoFetch();
    log('Auto-fetch for models has been set up.');
    refreshModelsBtn.disabled = false;
    modelSelect.disabled = false;

    const toggleProviderSettings = () => {
        const selectedType = modelTypeEl.value;
        log(`Model type changed to: ${selectedType}`);
        openaiSettingsEl.style.display = selectedType === 'openai' ? 'block' : 'none';
        selfhostedSettingsEl.style.display = selectedType === 'selfhosted' ? 'block' : 'none';
    };
    
    // --- Attach Event Listeners ---
    modelTypeEl.addEventListener('change', toggleProviderSettings);
    refreshModelsBtn.addEventListener('click', () => {
        log('Manual model refresh triggered.', LOG_LEVELS.INFO);
        fetchModels();
    });

    // Handle the main "Send" button click
    sendButton.addEventListener('click', async () => {
        const model = document.getElementById('modelSelect').value;
        const prompt = promptEl.value.trim();
        const stream = streamCheckbox.checked;
        const imageFile = imageUploadEl.files[0]; // <-- GET THE FILE

        if (!model) {
            alert('Please select a model from the list.');
            return;
        }
        // Allow request if *either* prompt or image is present
        if (!prompt && !imageFile) {
            alert('Please enter a prompt or attach an image.');
            return;
        }

        log(`Sending prompt to model: ${model}`, LOG_LEVELS.INFO);
        responseEl.textContent = '';
        sendButton.disabled = true;
        showSpinner(true);

        // This is the payload object
        const payload = {
            providerType: modelTypeEl.value,
            model: model,
            // Use a default prompt if only an image is given
            messages: [{ role: 'user', content: prompt || "What do you see in this image?" }],
            stream: stream,
            apiKey: apiKeyEl.value.trim() || null,
            modelUrl: modelUrlEl.value.trim() || null,
            think: true,
            temperature: 0.7,
            maxTokens: 4000
        };

        try {
            // 1. Create new FormData
            const formData = new FormData();

            // 2. Stringify the payload and append it as 'payload' field
            formData.append('payload', JSON.stringify(payload));
            
            // 3. ADD THE IMAGE if it exists
            if (imageFile) {
                formData.append('image', imageFile);
                log('Attaching image to request.', LOG_LEVELS.INFO);
            }

            // 4. Call our server's API with the new FormData body
            const response = await fetch('/api/chat', {
                method: 'POST',
                // DO NOT set Content-Type; browser sets it with boundary
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP error! status: ${response.status}`);
            }

            if (stream) {
                // --- Handle Stream ---
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        log('Stream finished.', LOG_LEVELS.INFO);
                        break;
                    }
                    const chunk = decoder.decode(value, { stream: true });
                    responseEl.textContent += chunk;
                }
            } else {
                // --- Handle Bulk ---
                const data = await response.json();
                responseEl.textContent = data.content; // 'content' field
                log('Bulk response received.', LOG_LEVELS.INFO);
            }

        } catch (err) {
            console.error('An error occurred:', err);
            const errorMessage = `ERROR: ${err.message || 'An unknown error occurred.'}`;
            responseEl.textContent = errorMessage;
            log(errorMessage, LOG_LEVELS.ERROR);
        } finally {
            sendButton.disabled = false;
            showSpinner(false);
            imageUploadEl.value = null; // <-- CLEAR THE FILE INPUT
        }
    });

    // --- Initial State Calls ---
    toggleProviderSettings(); // Set initial visibility
});