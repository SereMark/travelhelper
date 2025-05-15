// ===== 0. DOM helpers ===================================================
const $ = (id) => document.getElementById(id);
const updateStatus = (txt) => { $("status").textContent = txt; };

// ===== 1. API-key workflow =============================================
let apiKey = localStorage.getItem("OPENAI_KEY") || "";
const apiInput = $("apiKey");
const snapBtn  = $("snapBtn");

if (apiKey) {
  apiInput.value = "********";
  enableApp();
} else {
  updateStatus("Please enter your OpenAI API key to start.");
}

$("apiForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const val = apiInput.value.trim();
  if (!val) return;
  apiKey = val;
  localStorage.setItem("OPENAI_KEY", apiKey);
  apiInput.value = "********";
  enableApp();
});

$("clearKey").onclick = () => {
  localStorage.removeItem("OPENAI_KEY");
  apiKey = "";
  snapBtn.disabled = true;
  updateStatus("Key cleared. Enter a new key to continue.");
  apiInput.value = "";
  disableApp();
};

// ===== 2. Camera & Controls =============================================
let stream;
let currentTrack;
const videoElement = $("view");
const cameraSelect = $("cameraSelect");
const zoomSlider = $("zoomSlider");
const zoomValueOutput = $("zoomValue");
const focusModeSelect = $("focusModeSelect");
const focusSlider = $("focusSlider");
const focusDistanceValueOutput = $("focusDistanceValue");

async function populateCameraList() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    updateStatus("Camera enumeration not supported.");
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    cameraSelect.innerHTML = ''; // Clear existing options

    if (videoDevices.length === 0) {
      updateStatus("No video input devices found.");
      return;
    }

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}` + (device.label && device.label.toLowerCase().includes('back') ? ' (likely rear)' : '');
      cameraSelect.appendChild(option);
    });
    // Automatically select the first rear-facing camera if available, otherwise the first one
    const rearCamera = videoDevices.find(d => d.label && d.label.toLowerCase().includes('back'));
    if (rearCamera) {
        cameraSelect.value = rearCamera.deviceId;
    } else if (videoDevices.length > 0) {
        cameraSelect.value = videoDevices[0].deviceId;
    }


    cameraSelect.onchange = () => {
      startCamera(cameraSelect.value);
    };
  } catch (err) {
    console.error("Error enumerating devices:", err);
    updateStatus("Error listing cameras: " + err.message);
  }
}

async function startCamera(deviceId) {
  if (stream) { // Stop any existing stream
    stream.getTracks().forEach(track => track.stop());
  }
  const constraints = {
    video: {
      width: { ideal: 512 }, // prefer 512, but flexible
      height: { ideal: 512 },
      facingMode: deviceId ? undefined : "environment", // prefer environment if no specific device
      deviceId: deviceId ? { exact: deviceId } : undefined
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    currentTrack = stream.getVideoTracks()[0];
    updateStatus("Camera started. Say \"snap\" or press the button.");
    initializeCameraControls(currentTrack);
  } catch (err) {
    console.error("Error starting camera:", err);
    updateStatus(`Camera error: ${err.name} - ${err.message}. Try another camera or check permissions.`);
    disableCameraControls();
  }
}

function initializeCameraControls(track) {
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  const settings = track.getSettings ? track.getSettings() : {};

  // Zoom
  const zoomControlGroup = $("zoomControlGroup");
  if (capabilities.zoom) {
    zoomControlGroup.style.display = "flex";
    zoomSlider.min = capabilities.zoom.min;
    zoomSlider.max = capabilities.zoom.max;
    zoomSlider.step = capabilities.zoom.step;
    zoomSlider.value = settings.zoom || capabilities.zoom.min;
    zoomValueOutput.textContent = parseFloat(zoomSlider.value).toFixed(1);
    zoomSlider.disabled = false;
    zoomSlider.oninput = async () => {
      try {
        await track.applyConstraints({ advanced: [{ zoom: zoomSlider.value }] });
        zoomValueOutput.textContent = parseFloat(zoomSlider.value).toFixed(1);
      } catch (err) {
        console.error("Error applying zoom:", err);
        updateStatus("Zoom not supported or error.");
      }
    };
  } else {
    zoomControlGroup.style.display = "none";
    zoomSlider.disabled = true;
  }

  // Focus Mode
  const focusModeControlGroup = $("focusModeControlGroup");
  const focusDistanceControlGroup = $("focusDistanceControlGroup");

  if (capabilities.focusMode) {
    focusModeControlGroup.style.display = "flex";
    focusModeSelect.innerHTML = ''; // Clear previous options
    capabilities.focusMode.forEach(mode => {
      const option = document.createElement('option');
      option.value = mode;
      option.text = mode.charAt(0).toUpperCase() + mode.slice(1);
      focusModeSelect.appendChild(option);
    });
    focusModeSelect.value = settings.focusMode || capabilities.focusMode[0];
    focusModeSelect.disabled = false;

    focusModeSelect.onchange = async () => {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: focusModeSelect.value }] });
        updateFocusDistanceAvailability(track); // Re-check if focus distance slider should be active
      } catch (err) {
        console.error("Error applying focus mode:", err);
      }
    };
  } else {
    focusModeControlGroup.style.display = "none";
    focusModeSelect.disabled = true;
  }
  updateFocusDistanceAvailability(track); // Initial check
}

function updateFocusDistanceAvailability(track) {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    const settings = track.getSettings ? track.getSettings() : {};
    const focusDistanceControlGroup = $("focusDistanceControlGroup");

    // Focus Distance (Manual Focus) - typically available when focusMode is 'manual'
    if (capabilities.focusDistance && (focusModeSelect.value === 'manual' || !capabilities.focusMode)) {
        focusDistanceControlGroup.style.display = "flex";
        focusSlider.min = capabilities.focusDistance.min;
        focusSlider.max = capabilities.focusDistance.max;
        focusSlider.step = capabilities.focusDistance.step;
        focusSlider.value = settings.focusDistance || capabilities.focusDistance.min;
        focusDistanceValueOutput.textContent = parseFloat(focusSlider.value).toFixed(2);
        focusSlider.disabled = false;

        focusSlider.oninput = async () => {
            try {
                // Ensure focus mode is manual if trying to set distance
                if (capabilities.focusMode && settings.focusMode !== 'manual') {
                     await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
                     if (focusModeSelect.value !== 'manual') focusModeSelect.value = 'manual'; // Update dropdown if changed
                }
                await track.applyConstraints({ advanced: [{ focusDistance: focusSlider.value }] });
                focusDistanceValueOutput.textContent = parseFloat(focusSlider.value).toFixed(2);
            } catch (err) {
                console.error("Error applying focus distance:", err);
                updateStatus("Manual focus not supported or error.");
            }
        };
    } else {
        focusDistanceControlGroup.style.display = "none";
        focusSlider.disabled = true;
        focusDistanceValueOutput.textContent = "auto";
    }
}


function disableCameraControls() {
    $("zoomControlGroup").style.display = "none";
    zoomSlider.disabled = true;
    $("focusModeControlGroup").style.display = "none";
    focusModeSelect.disabled = true;
    $("focusDistanceControlGroup").style.display = "none";
    focusSlider.disabled = true;
}


// ===== 3. Speech recognition trigger ===================================
let recog;
let isSpeechRecognitionIntended = false; // Flag to control speech recognition state

function startSpeech() {
  if (!apiKey) return; // Don't start if no API key

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateStatus("Speech recognition not supported by this browser. Use the button.");
    return; // not supported; the button will still work
  }

  if (recog && isSpeechRecognitionIntended) { // Already started and intended to run
    return;
  }

  recog = new SpeechRecognition();
  recog.continuous = true; // Keep listening
  recog.interimResults = false; // We only want final results

  recog.onresult = (e) => {
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
        transcript += e.results[i][0].transcript;
    }
    const command = transcript.trim().toLowerCase();
    console.log("Heard:", command);
    if (command.includes("snap")) {
      updateStatus("Heard \"snap\"!");
      takePhoto();
    }
  };

  recog.onerror = (event) => {
    console.error('Speech recognition error:', event.error, event.message);
    let errorMsg = `Speech error: ${event.error}.`;
    if (event.error === 'no-speech') {
      errorMsg += " No speech detected. Listening again.";
    } else if (event.error === 'audio-capture') {
      errorMsg += " Microphone problem.";
    } else if (event.error === 'not-allowed') {
      errorMsg += " Permission denied. Please allow microphone access.";
      isSpeechRecognitionIntended = false; // Stop trying if permission denied
    }
    updateStatus(errorMsg);
     // No automatic restart on 'not-allowed' or if not intended
    if (isSpeechRecognitionIntended && event.error !== 'not-allowed') {
        // recog.start(); // Restart, but be careful of error loops
    }
  };

  recog.onend = () => {
    if (isSpeechRecognitionIntended) {
      console.log("Speech recognition ended, restarting...");
      try {
          recog.start();
      } catch (e) {
          console.error("Error restarting speech recognition:", e);
          updateStatus("Speech recognition stopped. Try refreshing or ensure mic is available.");
          isSpeechRecognitionIntended = false;
      }
    } else {
      console.log("Speech recognition ended (intentionally).");
    }
  };

  try {
    isSpeechRecognitionIntended = true;
    recog.start();
    updateStatus("Speech recognition started. Say \"snap\".");
  } catch (e) {
    console.error("Error starting speech recognition:", e);
    updateStatus("Could not start speech recognition. Use button.");
    isSpeechRecognitionIntended = false;
  }
}

function stopSpeech() {
  isSpeechRecognitionIntended = false;
  if (recog) {
    recog.stop();
    console.log("Speech recognition stopped by app.");
  }
}

// ===== 4. Photo capture & act ========================================
snapBtn.onclick = takePhoto;

async function takePhoto() {
  if (!apiKey) {
    updateStatus("Enter your API key first!");
    alert("Enter your API key first!");
    return;
  }
  if (!stream || !stream.active || !currentTrack) {
    updateStatus("Camera not active or stream not found.");
    alert("Camera not active. Please ensure camera is working and selected.");
    return;
  }

  snapBtn.disabled = true;
  updateStatus("🔄 Capturing…");

  const canvas = $("photo");
  const ctx = canvas.getContext("2d");

  // Get video dimensions to draw correctly
  const videoSettings = currentTrack.getSettings();
  const videoWidth = videoSettings.width || videoElement.videoWidth;
  const videoHeight = videoSettings.height || videoElement.videoHeight;

  // Set canvas dimensions to match video to avoid distortion before drawing
  // The final image sent to OpenAI is still 512x512 due to canvas attributes
  // but we capture from the source resolution first.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = videoWidth;
  tempCanvas.height = videoHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);

  // Now draw from tempCanvas to the fixed size "photo" canvas
  // This will scale the image to 512x512
  ctx.clearRect(0,0, canvas.width, canvas.height); // Clear previous photo
  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);

  const dataURL = canvas.toDataURL("image/jpeg", 0.7); // 0.7 quality

  updateStatus("📨 Sending to ChatGPT…");

  try {
    const answer = await queryOpenAI(dataURL);
    updateStatus(answer);
    speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
  } catch (err) {
    console.error(err);
    updateStatus("❌ " + err.message);
  } finally {
    snapBtn.disabled = false;
    // Consider if speech should be restarted here if it was paused
    if (isSpeechRecognitionIntended && recog && (typeof recog.start === 'function')) {
        try {
            // recog.start(); // Only if we want to ensure it's running after a photo
        } catch(e) { /* ignore if already running or fails */ }
    }
  }
}

async function queryOpenAI(imageDataUrl) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } }, // Use "high" for more detail if needed
          { type: "text", text: "Solve the problem in the image and only tell the answer in a concise but understandable way." }
        ]
      }]
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({})); // Try to parse error, default to empty object
    const errorMsg = errData.error?.message || `HTTP error ${res.status}: ${res.statusText}`;
    throw new Error(errorMsg);
  }

  const json = await res.json();
  return json.choices[0].message.content.trim();
}

// ===== 5. App init & state management ========================================
async function enableApp() {
  snapBtn.disabled = false;
  await populateCameraList(); // Populate before starting camera
  if (cameraSelect.options.length > 0) {
    if (!stream || !stream.active) {
        await startCamera(cameraSelect.value); // Start with the selected (or default) camera
    }
  } else {
    updateStatus("No cameras found. Please connect a camera and refresh.");
    disableCameraControls();
  }
  startSpeech(); // Start or ensure speech recognition is running
  updateStatus("App enabled. Say \"snap\" or press the button.");
}

function disableApp() {
    stopSpeech();
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        currentTrack = null;
        videoElement.srcObject = null;
    }
    snapBtn.disabled = true;
    disableCameraControls();
    updateStatus("App disabled. Enter API Key.");
}

// Initial call if API key is already present
if (apiKey) {
  enableApp().catch(err => {
      console.error("Error on initial enableApp:", err);
      updateStatus("Error initializing app: " + err.message);
  });
}