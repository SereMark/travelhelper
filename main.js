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
    snapBtn: $("snapBtn"),
    restartSpeechBtn: $("restartSpeechBtn"),
    statusContainer: $("statusContainer"),
    micStatusIcon: $("micStatusIcon"),
    statusText: $("status"),
};

let appState = {
    apiKey: localStorage.getItem("OPENAI_KEY") || "",
    mediaStream: null,
    currentVideoTrack: null,
    speechRecognition: null,
    isSpeechRecognitionIntended: false,
    isCameraActive: false,
    isInitializing: false,
    triggerCommands: ["snap", "capture photo", "okay vision", "take picture", "go vision", "activate"],
};

const updateStatus = (text, micState = "default", isError = false) => {
    uiElements.statusText.textContent = text;
    uiElements.statusText.style.color = isError ? "var(--error-text, #d9534f)" : "var(--status-text, inherit)";
    const micColorMap = {
        listening: "green",
        processing: "blue",
        error: "orange",
        off: "grey",
        default: uiElements.micStatusIcon.style.color || "grey",
    };
    uiElements.micStatusIcon.style.color = micColorMap[micState];
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
};

const clearApiKey = () => {
    appState.apiKey = "";
    localStorage.removeItem("OPENAI_KEY");
    uiElements.apiKeyInput.value = "";
    uiElements.apiKeyInput.disabled = false;
    uiElements.saveKeyBtn.disabled = false;
    uiElements.clearKeyBtn.disabled = true;
    updateStatus("API Key cleared. Please enter your OpenAI API key.", "off");
    shutdownApp();
};

const populateCameraList = async () => {
    uiElements.cameraSelect.innerHTML = '';
    uiElements.cameraSelect.disabled = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        updateStatus("Camera access not supported by this browser.", "error", true);
        return false;
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        if (videoDevices.length === 0) {
            updateStatus("No video input devices found.", "error", true);
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
        updateStatus(`Error listing cameras: ${err.message}`, "error", true);
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
    uiElements.snapBtn.disabled = true;
    updateStatus(`Starting camera ${uiElements.cameraSelect.selectedOptions[0]?.text || 'selected'}...`, "default");

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
                    updateStatus(errorMsg, "error", true);
                    reject(new Error(errorMsg));
                    return;
                }
                appState.isCameraActive = true;
                const cameraName = appState.currentVideoTrack.label || 'Selected Camera';
                updateStatus(`Camera: ${cameraName}. Say 'capture photo' or other triggers.`, appState.isSpeechRecognitionIntended ? "listening" : "default");
                initializeCameraControlsUI(appState.currentVideoTrack);
                uiElements.snapBtn.disabled = false;
                resolve(true);
            };
            uiElements.videoElement.onerror = (e) => {
                const errorMsg = `Error playing video from camera (${appState.currentVideoTrack?.label || deviceId}).`;
                updateStatus(errorMsg, "error", true);
                console.error("Video element error:", e);
                appState.isCameraActive = false;
                uiElements.snapBtn.disabled = true;
                reject(new Error(errorMsg));
            };
        });

    } catch (err) {
        updateStatus(`Failed to start camera (${uiElements.cameraSelect.selectedOptions[0]?.text || deviceId}): ${err.message}. Check permissions and try another camera.`, "error", true);
        console.error("Error starting camera:", err);
        appState.isCameraActive = false;
        uiElements.snapBtn.disabled = true;
        return false;
    }
};

const stopCamera = () => {
    if (appState.mediaStream) {
        appState.mediaStream.getTracks().forEach(track => track.stop());
    }
    appState.mediaStream = null;
    appState.currentVideoTrack = null;
    appState.isCameraActive = false;
    uiElements.videoElement.srcObject = null;
    uiElements.videoElement.onloadedmetadata = null;
    uiElements.videoElement.onerror = null;
    disableCameraControlsUI();
};

const startSpeechRecognition = () => {
    if (!appState.apiKey) {
        updateStatus("API Key needed for speech recognition.", "off");
        return;
    }
    if (appState.isInitializing && !appState.apiKey) return;

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
        updateStatus("Speech recognition not supported by this browser. Use the button.", "error", true);
        return;
    }

    if (appState.speechRecognition) {
        try { appState.speechRecognition.abort(); }
        catch (e) { console.warn("Could not abort previous speech instance:", e); }
        appState.speechRecognition = null;
    }
    
    appState.isSpeechRecognitionIntended = true;
    appState.speechRecognition = new SpeechRecognitionAPI();
    appState.speechRecognition.continuous = true;
    appState.speechRecognition.interimResults = false;
    appState.speechRecognition.lang = navigator.language || "en-US";

    appState.speechRecognition.onstart = () => {
        updateStatus("Listening... Say 'capture photo' or other triggers.", "listening");
    };

    appState.speechRecognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
        }
        const command = transcript.trim().toLowerCase();
        
        const matchedTrigger = appState.triggerCommands.find(trigger => command.includes(trigger));

        if (matchedTrigger) {
            updateStatus(`Heard "${matchedTrigger}"! Capturing...`, "processing");
            takePhotoAndQuery();
        } else {
            if (appState.isSpeechRecognitionIntended) {
                updateStatus("Didn't catch a trigger. Listening...", "listening");
            }
        }
    };

    appState.speechRecognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error, event.message);
        let errorMsg = `Speech error: ${event.error}.`;
        let micState = "error";
        if (event.error === 'no-speech') errorMsg += " No speech detected.";
        else if (event.error === 'audio-capture') errorMsg += " Mic problem.";
        else if (event.error === 'network') errorMsg += " Network error.";
        else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          errorMsg += " Permission/service denied.";
          appState.isSpeechRecognitionIntended = false;
          micState = "off";
          if (appState.speechRecognition) try { appState.speechRecognition.abort(); } catch(e){}
        }
        updateStatus(errorMsg, micState, true);
    };

    appState.speechRecognition.onend = () => {
        if (appState.isSpeechRecognitionIntended) {
            try {
                if (appState.speechRecognition) appState.speechRecognition.start();
            } catch (e) {
                console.error("Error restarting speech recognition from onend:", e);
                updateStatus("Speech recognition stopped. Try Restart Mic.", "error", true);
            }
        } else {
            updateStatus("Speech recognition off.", "off");
        }
    };

    try {
        updateStatus("Initializing speech recognition...", "error");
        appState.speechRecognition.start();
    } catch (e) {
        console.error("Error starting speech recognition:", e);
        updateStatus("Could not start speech. Use button or Restart Mic.", "error", true);
        appState.isSpeechRecognitionIntended = false;
    }
};

const stopSpeechRecognition = () => {
    appState.isSpeechRecognitionIntended = false;
    if (appState.speechRecognition) {
        try { appState.speechRecognition.abort(); }
        catch (e) { console.warn("Error aborting speech in stopSpeech:", e); }
        appState.speechRecognition = null;
    }
    updateStatus("Speech recognition stopped.", "off");
};

const takePhotoAndQuery = async () => {
    if (!appState.apiKey) {
        updateStatus("API key is missing.", "error", true);
        alert("API key is missing. Please save your API key.");
        return;
    }
    if (!appState.isCameraActive || !appState.currentVideoTrack || !uiElements.videoElement.srcObject) {
        updateStatus("Camera not active or stream not found.", "error", true);
        alert("Camera is not active. Please ensure the camera is working and selected.");
        return;
    }

    uiElements.snapBtn.disabled = true;
    updateStatus("🔄 Capturing photo...", "processing");

    const canvas = uiElements.photoCanvas;
    const ctx = canvas.getContext("2d");
    
    const videoWidth = uiElements.videoElement.videoWidth;
    const videoHeight = uiElements.videoElement.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) {
        updateStatus("Cannot capture, video dimensions are zero.", "error", true);
        uiElements.snapBtn.disabled = false;
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

    updateStatus("📨 Sending to AI...", "processing");

    try {
        const responseText = await queryOpenAIWithImage(dataURL);
        updateStatus(`AI: ${responseText}`, appState.isSpeechRecognitionIntended ? "listening" : "default");
        speechSynthesis.speak(new SpeechSynthesisUtterance(responseText));
    } catch (err) {
        updateStatus(`❌ AI Error: ${err.message}`, "error", true);
        console.error("OpenAI Query Error:", err);
    } finally {
        uiElements.snapBtn.disabled = false;
    }
};

const queryOpenAIWithImage = async (imageDataUrl) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${appState.apiKey}`
        },
        body: JSON.stringify({
            model: "o4-mini",
            max_tokens: 60,
            messages: [{
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
                    { 
                        type: "text", 
                        text: "The image contains a question or problem. Identify the solution. Respond ONLY with the solution number (e.g. '1', '2'), letter (e.g. 'A', 'B'), or ordinal identifier (e.g. 'First', 'Second'). Repeat your answer three times, separated by spaces. For example, if the answer is 'B', respond 'B B B'. If the answer is '3', respond '3 3 3'. Do not add any other words, explanations, or punctuation." 
                    }
                ]
            }]
        })
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errorMsg = errData.error?.message || `API Error ${res.status}: ${res.statusText}`;
        throw new Error(errorMsg);
    }
    const json = await res.json();
    return json.choices[0]?.message?.content?.trim() || "No response from AI.";
};

const initializeApp = async () => {
    if (appState.isInitializing && appState.apiKey) return; // Prevent re-init if already key'd and running
    appState.isInitializing = true;

    uiElements.controlsArea.hidden = false;
    uiElements.snapBtn.disabled = true; // Will be enabled by camera success
    uiElements.restartSpeechBtn.hidden = false;

    const camerasAvailable = await populateCameraList();
    if (camerasAvailable && uiElements.cameraSelect.value) {
        try {
            await startCamera(uiElements.cameraSelect.value);
        } catch (e) {
            // Status already updated by startCamera
        }
    } else if (!camerasAvailable) {
        updateStatus("No cameras available to start. Connect a camera and refresh.", "error", true);
        uiElements.snapBtn.disabled = true;
    } else {
         updateStatus("Select a camera to begin.", "default");
    }
    
    if (appState.apiKey) {
        startSpeechRecognition();
    } else {
        updateStatus("API Key needed to use speech recognition.", "off");
    }

    appState.isInitializing = false;
};

const shutdownApp = () => {
    appState.isInitializing = false; // Ensure this is reset
    stopCamera();
    stopSpeechRecognition();
    uiElements.controlsArea.hidden = true;
    uiElements.snapBtn.disabled = true;
    uiElements.restartSpeechBtn.hidden = true;
    disableCameraControlsUI();
    uiElements.cameraSelect.disabled = true;
};

uiElements.saveKeyBtn.onclick = (e) => {
    e.preventDefault();
    const key = uiElements.apiKeyInput.value.trim();
    if (key) saveApiKey(key);
    else updateStatus("API key cannot be empty.", "error", true);
};

uiElements.clearKeyBtn.onclick = clearApiKey;

uiElements.cameraSelect.onchange = () => {
    if (uiElements.cameraSelect.value) {
        startCamera(uiElements.cameraSelect.value).catch(err => {
            // Status updated within startCamera
        });
    }
};

uiElements.snapBtn.onclick = takePhotoAndQuery;

uiElements.restartSpeechBtn.onclick = () => {
    updateStatus("Attempting to restart microphone...", "error");
    stopSpeechRecognition(); 
    setTimeout(() => {
        startSpeechRecognition();
    }, 250);
};

document.addEventListener('DOMContentLoaded', () => {
    if (appState.apiKey) {
        uiElements.apiKeyInput.value = "********";
        uiElements.apiKeyInput.disabled = true;
        uiElements.saveKeyBtn.disabled = true;
        uiElements.clearKeyBtn.disabled = false;
        initializeApp();
    } else {
        uiElements.clearKeyBtn.disabled = true;
        shutdownApp(); // Ensure clean state if no API key on load
        updateStatus("Please enter your OpenAI API key to begin.", "off");
    }
});