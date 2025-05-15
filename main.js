const $ = (id) => document.getElementById(id);

const uiElements = {
    apiKeyInput: $("apiKey"),
    saveKeyBtn: $("saveKey"),
    clearKeyBtn: $("clearKey"),
    controlsArea: $("controlsArea"),
    cameraSelect: $("cameraSelect"),
    zoomControlGroup: $("zoomControlGroup"),
    zoomSlider: $("zoomSlider"),
    zoomValueOutput: $("zoomValue"),
    focusModeControlGroup: $("focusModeControlGroup"),
    focusModeSelect: $("focusModeSelect"),
    focusDistanceControlGroup: $("focusDistanceControlGroup"),
    focusSlider: $("focusSlider"),
    focusDistanceValueOutput: $("focusDistanceValue"),
    videoElement: $("view"),
    photoCanvas: $("photo"),
    startAutoBtn: $("startAutoBtn"), // Changed from snapBtn
    stopAutoBtn: $("stopAutoBtn"),   // New button
    statusContainer: $("statusContainer"),
    statusText: $("status"),
};

let appState = {
    apiKey: localStorage.getItem("OPENAI_KEY") || "",
    mediaStream: null,
    currentVideoTrack: null,
    isCameraActive: false,
    isInitializing: false,
    isAutoModeActive: false,      // New state for auto mode
    autoPhotoTimeoutId: null,   // New state for timeout ID
};

const updateStatus = (text, isError = false) => {
    uiElements.statusText.textContent = text;
    uiElements.statusText.style.color = isError ? "var(--error-text, #d9534f)" : "var(--status-text, inherit)";
};

const updateAutoButtonStates = () => {
    const canStartAuto = appState.apiKey && appState.isCameraActive;
    if (appState.isAutoModeActive) {
        uiElements.startAutoBtn.disabled = true;
        uiElements.stopAutoBtn.disabled = false;
    } else {
        uiElements.startAutoBtn.disabled = !canStartAuto;
        uiElements.stopAutoBtn.disabled = true;
    }
};

const saveApiKey = (key) => {
    appState.apiKey = key;
    localStorage.setItem("OPENAI_KEY", key);
    uiElements.apiKeyInput.value = "********";
    uiElements.apiKeyInput.disabled = true;
    uiElements.saveKeyBtn.disabled = true;
    uiElements.clearKeyBtn.disabled = false;
    updateStatus("API Key saved. Initializing application...");
    initializeApp();
    updateAutoButtonStates(); 
};

const clearApiKey = () => {
    appState.apiKey = "";
    localStorage.removeItem("OPENAI_KEY");
    uiElements.apiKeyInput.value = "";
    uiElements.apiKeyInput.disabled = false;
    uiElements.saveKeyBtn.disabled = false;
    uiElements.clearKeyBtn.disabled = true;
    if (appState.isAutoModeActive) {
        stopAutoMode();
    }
    updateStatus("API Key cleared. Please enter your OpenAI API key.");
    shutdownApp();
    updateAutoButtonStates();
};

const populateCameraList = async () => {
    uiElements.cameraSelect.innerHTML = '';
    uiElements.cameraSelect.disabled = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        updateStatus("Camera access not supported by this browser.", true);
        return false;
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        if (videoDevices.length === 0) {
            updateStatus("No video input devices found.", true);
            return false;
        }
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Camera ${index + 1}`;
            uiElements.cameraSelect.appendChild(option);
        });

        const preferredCamera = videoDevices.find(d => d.label && d.label.toLowerCase().includes('back')) || videoDevices[0];
        if (preferredCamera) uiElements.cameraSelect.value = preferredCamera.deviceId;
        
        uiElements.cameraSelect.disabled = false;
        return true;
    } catch (err) {
        updateStatus(`Error listing cameras: ${err.message}`, true);
        console.error("Error enumerating devices:", err);
        return false;
    }
};

const initializeCameraControlsUI = (track) => {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    const settings = track.getSettings ? track.getSettings() : {};

    const setupSlider = (groupEl, sliderEl, valueOutputEl, capKey, settingKey, advancedKey, unit = "") => {
        if (capabilities[capKey] && capabilities[capKey].max > capabilities[capKey].min) {
            groupEl.hidden = false;
            sliderEl.min = capabilities[capKey].min;
            sliderEl.max = capabilities[capKey].max;
            sliderEl.step = capabilities[capKey].step || 0.1;
            sliderEl.value = settings[settingKey] || capabilities[capKey].min;
            valueOutputEl.textContent = `${parseFloat(sliderEl.value).toFixed(1)}${unit}`;
            sliderEl.disabled = false;
            sliderEl.oninput = async () => {
                try {
                    await track.applyConstraints({ advanced: [{ [advancedKey]: parseFloat(sliderEl.value) }] });
                    valueOutputEl.textContent = `${parseFloat(sliderEl.value).toFixed(1)}${unit}`;
                } catch (err) { console.error(`Error applying ${advancedKey}:`, err); }
            };
        } else {
            groupEl.hidden = true;
            sliderEl.disabled = true;
        }
    };

    setupSlider(uiElements.zoomControlGroup, uiElements.zoomSlider, uiElements.zoomValueOutput, "zoom", "zoom", "zoom", "x");
    
    if (capabilities.focusMode && capabilities.focusMode.length > 0) {
        uiElements.focusModeControlGroup.hidden = false;
        uiElements.focusModeSelect.innerHTML = '';
        capabilities.focusMode.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode;
            option.text = mode.charAt(0).toUpperCase() + mode.slice(1);
            uiElements.focusModeSelect.appendChild(option);
        });
        uiElements.focusModeSelect.value = settings.focusMode || capabilities.focusMode[0];
        uiElements.focusModeSelect.disabled = false;
        uiElements.focusModeSelect.onchange = async () => {
            try {
                await track.applyConstraints({ advanced: [{ focusMode: uiElements.focusModeSelect.value }] });
                updateFocusDistanceAvailabilityUI(track);
            } catch (err) { console.error("Error applying focus mode:", err); }
        };
    } else {
        uiElements.focusModeControlGroup.hidden = true;
        uiElements.focusModeSelect.disabled = true;
    }
    updateFocusDistanceAvailabilityUI(track);
};

const updateFocusDistanceAvailabilityUI = (track) => {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    const settings = track.getSettings ? track.getSettings() : {};
    const currentFocusMode = uiElements.focusModeSelect.value;

    if (capabilities.focusDistance && (currentFocusMode === 'manual' || !capabilities.focusMode || capabilities.focusMode.length === 0)) {
        uiElements.focusDistanceControlGroup.hidden = false;
        uiElements.focusSlider.min = capabilities.focusDistance.min;
        uiElements.focusSlider.max = capabilities.focusDistance.max;
        uiElements.focusSlider.step = capabilities.focusDistance.step || 0.01;
        uiElements.focusSlider.value = settings.focusDistance || capabilities.focusDistance.min;
        uiElements.focusDistanceValueOutput.textContent = parseFloat(uiElements.focusSlider.value).toFixed(2);
        uiElements.focusSlider.disabled = false;
        uiElements.focusSlider.oninput = async () => {
            try {
                if (capabilities.focusMode && settings.focusMode !== 'manual' && capabilities.focusMode.includes('manual')) {
                     await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
                     if (uiElements.focusModeSelect.value !== 'manual') uiElements.focusModeSelect.value = 'manual';
                }
                await track.applyConstraints({ advanced: [{ focusDistance: parseFloat(uiElements.focusSlider.value) }] });
                uiElements.focusDistanceValueOutput.textContent = parseFloat(uiElements.focusSlider.value).toFixed(2);
            } catch (err) { console.error("Error applying focus distance:", err); }
        };
    } else {
        uiElements.focusDistanceControlGroup.hidden = true;
        uiElements.focusSlider.disabled = true;
        uiElements.focusDistanceValueOutput.textContent = capabilities.focusMode ? "auto" : "N/A";
    }
};


const disableCameraControlsUI = () => {
    uiElements.zoomControlGroup.hidden = true;
    uiElements.zoomSlider.disabled = true;
    uiElements.focusModeControlGroup.hidden = true;
    uiElements.focusModeSelect.disabled = true;
    uiElements.focusDistanceControlGroup.hidden = true;
    uiElements.focusSlider.disabled = true;
};

const startCamera = async (deviceId) => {
    if (appState.mediaStream) {
        appState.mediaStream.getTracks().forEach(track => track.stop());
        appState.mediaStream = null;
        appState.currentVideoTrack = null;
    }
    appState.isCameraActive = false;
    uiElements.videoElement.srcObject = null;
    disableCameraControlsUI();
    updateAutoButtonStates();
    updateStatus(`Starting camera ${uiElements.cameraSelect.selectedOptions[0]?.text || 'selected'}...`);

    const constraints = {
        video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            facingMode: deviceId ? undefined : "environment",
            width: { ideal: 512 },
            aspectRatio: { ideal: 4 / 3 },
        }
    };

    try {
        appState.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!appState.mediaStream) throw new Error("Media stream acquisition failed.");
        
        appState.currentVideoTrack = appState.mediaStream.getVideoTracks()[0];
        if (!appState.currentVideoTrack) throw new Error("No video track found in stream.");

        uiElements.videoElement.srcObject = appState.mediaStream;
        
        return new Promise((resolve, reject) => {
            uiElements.videoElement.onloadedmetadata = () => {
                if (uiElements.videoElement.videoWidth === 0) {
                    const errorMsg = `Camera (${appState.currentVideoTrack.label || deviceId}) started but stream is black/empty. Try another camera.`;
                    updateStatus(errorMsg, true);
                    appState.isCameraActive = false;
                    updateAutoButtonStates();
                    reject(new Error(errorMsg));
                    return;
                }
                appState.isCameraActive = true;
                const cameraName = appState.currentVideoTrack.label || 'Selected Camera';
                updateStatus(`Camera: ${cameraName}. Ready.`);
                initializeCameraControlsUI(appState.currentVideoTrack);
                updateAutoButtonStates();
                resolve(true);
            };
            uiElements.videoElement.onerror = (e) => {
                const errorMsg = `Error playing video from camera (${appState.currentVideoTrack?.label || deviceId}).`;
                updateStatus(errorMsg, true);
                console.error("Video element error:", e);
                appState.isCameraActive = false;
                updateAutoButtonStates();
                reject(new Error(errorMsg));
            };
        });

    } catch (err) {
        updateStatus(`Failed to start camera (${uiElements.cameraSelect.selectedOptions[0]?.text || deviceId}): ${err.message}. Check permissions and try another camera.`, true);
        console.error("Error starting camera:", err);
        appState.isCameraActive = false;
        updateAutoButtonStates();
        return false;
    }
};

const stopCamera = () => {
    if (appState.mediaStream) {
        appState.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (appState.isAutoModeActive) {
        stopAutoMode(); // Stop auto mode if camera stops
    }
    appState.mediaStream = null;
    appState.currentVideoTrack = null;
    appState.isCameraActive = false;
    uiElements.videoElement.srcObject = null;
    uiElements.videoElement.onloadedmetadata = null;
    uiElements.videoElement.onerror = null;
    disableCameraControlsUI();
    updateAutoButtonStates();
};


const takePhotoAndQuery = async () => {
    if (!appState.apiKey) {
        updateStatus("API key is missing.", true);
        if (appState.isAutoModeActive) stopAutoMode();
        return;
    }
    if (!appState.isCameraActive || !appState.currentVideoTrack || !uiElements.videoElement.srcObject) {
        updateStatus("Camera not active or stream not found.", true);
        if (appState.isAutoModeActive) stopAutoMode();
        return;
    }

    // Button states are managed by start/stopAutoMode and updateAutoButtonStates
    updateStatus("🔄 Capturing photo...");

    const canvas = uiElements.photoCanvas;
    const ctx = canvas.getContext("2d");
    
    const videoWidth = uiElements.videoElement.videoWidth;
    const videoHeight = uiElements.videoElement.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) {
        updateStatus("Cannot capture, video dimensions are zero.", true);
        if (appState.isAutoModeActive) { // Schedule next attempt even on this error if in auto mode
            scheduleNextCapture();
        }
        return;
    }
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = videoWidth;
    tempCanvas.height = videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(uiElements.videoElement, 0, 0, videoWidth, videoHeight);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL("image/jpeg", 0.8);

    updateStatus("📨 Sending to AI...");

    try {
        const responseText = await queryOpenAIWithImage(dataURL);
        updateStatus(`AI: ${responseText}`);
        speechSynthesis.speak(new SpeechSynthesisUtterance(responseText));
    } catch (err) {
        updateStatus(`❌ AI Error: ${err.message}`, true);
        console.error("OpenAI Query Error:", err);
        // Optionally stop auto mode on critical AI error:
        // if (appState.isAutoModeActive) stopAutoMode(); 
    } finally {
        if (appState.isAutoModeActive) {
            scheduleNextCapture();
        }
    }
};

const scheduleNextCapture = () => {
    if (appState.autoPhotoTimeoutId) {
        clearTimeout(appState.autoPhotoTimeoutId);
    }
    appState.autoPhotoTimeoutId = setTimeout(async () => {
        if (appState.isAutoModeActive) { // Check again in case it was stopped
            await takePhotoAndQuery();
        }
    }, 5000); // 5 seconds delay
};

const startAutoMode = async () => {
    if (!appState.apiKey) {
        updateStatus("API key required to start auto mode.", true);
        return;
    }
    if (!appState.isCameraActive) {
        updateStatus("Camera not active. Cannot start auto mode.", true);
        return;
    }
    if (appState.isAutoModeActive) return;

    appState.isAutoModeActive = true;
    updateAutoButtonStates();
    updateStatus("Auto mode started. Capturing first photo...");
    await takePhotoAndQuery(); // Take the first photo immediately, then scheduleNext will handle the loop
};

const stopAutoMode = () => {
    appState.isAutoModeActive = false;
    if (appState.autoPhotoTimeoutId) {
        clearTimeout(appState.autoPhotoTimeoutId);
        appState.autoPhotoTimeoutId = null;
    }
    updateAutoButtonStates();
    updateStatus("Auto mode stopped.");
};


const queryOpenAIWithImage = async (imageDataUrl) => {
    const res = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${appState.apiKey}`
        },
        body: JSON.stringify({
          model: "o4-mini",
          max_completion_tokens: 60,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "The image contains a question or problem. Identify the solution. " +
                    "Return ONLY the identifier, three times, separated by spaces."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imageDataUrl,
                    detail: "high"
                  }
                }
              ]
            }
          ]
        })
      }
    );
  
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? res.statusText);
    return data.choices?.[0]?.message?.content?.trim()
           ?? "(empty assistant message)";
  };  

const initializeApp = async () => {
    if (appState.isInitializing && appState.apiKey) return; 
    appState.isInitializing = true;

    uiElements.controlsArea.hidden = false;
    updateAutoButtonStates();

    const camerasAvailable = await populateCameraList();
    if (camerasAvailable && uiElements.cameraSelect.value) {
        try {
            await startCamera(uiElements.cameraSelect.value);
        } catch (e) {
            // Status already updated by startCamera
        }
    } else if (!camerasAvailable) {
        updateStatus("No cameras available to start. Connect a camera and refresh.", true);
    } else {
         updateStatus("Select a camera to begin.");
    }
    
    if (!appState.apiKey) {
        updateStatus("API Key needed to start auto mode.");
    }
    updateAutoButtonStates(); // Ensure buttons reflect state after camera init and key check
    appState.isInitializing = false;
};

const shutdownApp = () => {
    appState.isInitializing = false; 
    if (appState.isAutoModeActive) {
        stopAutoMode();
    }
    stopCamera(); // This will also call updateAutoButtonStates
    uiElements.controlsArea.hidden = true;
    disableCameraControlsUI();
    uiElements.cameraSelect.disabled = true;
    updateAutoButtonStates(); // Final check
};

uiElements.saveKeyBtn.onclick = (e) => {
    e.preventDefault();
    const key = uiElements.apiKeyInput.value.trim();
    if (key) saveApiKey(key);
    else updateStatus("API key cannot be empty.", true);
};

uiElements.clearKeyBtn.onclick = clearApiKey;

uiElements.cameraSelect.onchange = () => {
    if (uiElements.cameraSelect.value) {
        if (appState.isAutoModeActive) {
            stopAutoMode(); // Stop auto mode if changing camera
        }
        startCamera(uiElements.cameraSelect.value).catch(err => {
            // Status updated within startCamera
        });
    }
};

uiElements.startAutoBtn.onclick = startAutoMode;
uiElements.stopAutoBtn.onclick = stopAutoMode;


document.addEventListener('DOMContentLoaded', () => {
    if (appState.apiKey) {
        uiElements.apiKeyInput.value = "********";
        uiElements.apiKeyInput.disabled = true;
        uiElements.saveKeyBtn.disabled = true;
        uiElements.clearKeyBtn.disabled = false;
        initializeApp();
    } else {
        uiElements.clearKeyBtn.disabled = true;
        shutdownApp(); 
        updateStatus("Please enter your OpenAI API key to begin.");
    }
    updateAutoButtonStates(); // Set initial button states
});