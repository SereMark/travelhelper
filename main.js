const $ = (id) => document.getElementById(id);
const micStatusIcon = $("micStatusIcon");
const restartSpeechBtn = $("restartSpeechBtn");

const updateStatus = (txt, micState = "default") => {
  $("status").textContent = txt;
  switch (micState) {
    case "listening": micStatusIcon.style.color = "green"; break;
    case "processing": micStatusIcon.style.color = "blue"; break;
    case "error": micStatusIcon.style.color = "orange"; break;
    case "off": micStatusIcon.style.color = "grey"; break;
    default: break; 
  }
};

let apiKey = localStorage.getItem("OPENAI_KEY") || "";
const apiInput = $("apiKey");
const snapBtn  = $("snapBtn");

if (apiKey) {
  apiInput.value = "********";
  enableApp();
} else {
  updateStatus("Please enter your OpenAI API key to start.", "off");
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
  restartSpeechBtn.style.display = "none";
  updateStatus("Key cleared. Enter a new key to continue.", "off");
  apiInput.value = "";
  disableApp();
};

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
    updateStatus("Camera enumeration not supported.", "error");
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    cameraSelect.innerHTML = '';

    if (videoDevices.length === 0) {
      updateStatus("No video input devices found.", "error");
      return;
    }

    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });
    
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
    updateStatus("Error listing cameras: " + err.message, "error");
  }
}

async function startCamera(deviceId) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  const constraints = {
    video: {
      aspectRatio: { ideal: 4 / 3 },
      width: { ideal: 512 },
      facingMode: deviceId ? undefined : "environment",
      deviceId: deviceId ? { exact: deviceId } : undefined
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    currentTrack = stream.getVideoTracks()[0];
    updateStatus("Camera started. Say \"snap\" or press the button.", isSpeechRecognitionIntended ? "listening" : "default");
    initializeCameraControls(currentTrack);
  } catch (err) {
    console.error("Error starting camera:", err);
    updateStatus(`Camera error: ${err.name}. Try another camera or check permissions.`, "error");
    disableCameraControls();
  }
}

function initializeCameraControls(track) {
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  const settings = track.getSettings ? track.getSettings() : {};
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
      } catch (err) { console.error("Error applying zoom:", err); }
    };
  } else {
    zoomControlGroup.style.display = "none";
    zoomSlider.disabled = true;
  }

  const focusModeControlGroup = $("focusModeControlGroup");
  if (capabilities.focusMode) {
    focusModeControlGroup.style.display = "flex";
    focusModeSelect.innerHTML = '';
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
        updateFocusDistanceAvailability(track);
      } catch (err) { console.error("Error applying focus mode:", err); }
    };
  } else {
    focusModeControlGroup.style.display = "none";
    focusModeSelect.disabled = true;
  }
  updateFocusDistanceAvailability(track);
}

function updateFocusDistanceAvailability(track) {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    const settings = track.getSettings ? track.getSettings() : {};
    const focusDistanceControlGroup = $("focusDistanceControlGroup");

    if (capabilities.focusDistance && (focusModeSelect.value === 'manual' || !capabilities.focusMode || capabilities.focusMode.length === 0)) {
        focusDistanceControlGroup.style.display = "flex";
        focusSlider.min = capabilities.focusDistance.min;
        focusSlider.max = capabilities.focusDistance.max;
        focusSlider.step = capabilities.focusDistance.step;
        focusSlider.value = settings.focusDistance || capabilities.focusDistance.min;
        focusDistanceValueOutput.textContent = parseFloat(focusSlider.value).toFixed(2);
        focusSlider.disabled = false;
        focusSlider.oninput = async () => {
            try {
                if (capabilities.focusMode && settings.focusMode !== 'manual') {
                     await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
                     if (focusModeSelect.value !== 'manual') focusModeSelect.value = 'manual';
                }
                await track.applyConstraints({ advanced: [{ focusDistance: focusSlider.value }] });
                focusDistanceValueOutput.textContent = parseFloat(focusSlider.value).toFixed(2);
            } catch (err) { console.error("Error applying focus distance:", err); }
        };
    } else {
        focusDistanceControlGroup.style.display = "none";
        focusSlider.disabled = true;
        focusDistanceValueOutput.textContent = capabilities.focusMode ? "auto" : "N/A";
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

let recog;
let isSpeechRecognitionIntended = false;

restartSpeechBtn.onclick = () => {
    updateStatus("Restarting microphone...", "error");
    if (recog) {
        isSpeechRecognitionIntended = false; // Prevent onend from auto-restarting the old instance being stopped
        try {
            recog.abort(); // Forcefully stop
        } catch (e) {
            console.warn("Error aborting speech for manual restart:", e);
        }
    }
    setTimeout(() => {
        startSpeech(); // This will set isSpeechRecognitionIntended = true and create a new instance
    }, 250); // Brief delay
};

function startSpeech() {
  if (!apiKey) {
    updateStatus("API Key needed for speech recognition.", "off");
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateStatus("Speech recognition not supported. Use the button.", "error");
    return;
  }

  if (recog) { // If an old instance exists, try to stop it cleanly first
      try {
          isSpeechRecognitionIntended = false; // Mark old one as not intended to prevent its onend restart
          recog.abort();
      } catch(e) { console.warn("Could not abort previous recog instance before starting new:", e); }
  }
  
  isSpeechRecognitionIntended = true; // Set intent for the new instance
  recog = new SpeechRecognition();
  recog.continuous = true;
  recog.interimResults = false;

  recog.onstart = () => {
    updateStatus("Listening... Say \"snap\".", "listening");
  };

  recog.onresult = (e) => {
    updateStatus("Heard you!", "processing");
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
        transcript += e.results[i][0].transcript;
    }
    const command = transcript.trim().toLowerCase();
    if (command.includes("snap")) {
      updateStatus("Heard \"snap\"! Capturing...", "processing");
      takePhoto();
    } else {
        if (isSpeechRecognitionIntended) updateStatus("Listening... Say \"snap\".", "listening");
    }
  };

  recog.onerror = (event) => {
    console.error('Speech recognition error:', event.error, event.message);
    let errorMsg = `Speech error: ${event.error}.`;
    if (event.error === 'no-speech') errorMsg += " No speech detected.";
    else if (event.error === 'audio-capture') errorMsg += " Mic problem.";
    else if (event.error === 'network') errorMsg += " Network error.";
    else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      errorMsg += " Permission/service denied.";
      isSpeechRecognitionIntended = false; // Critical, stop trying to auto-restart this instance
      if (recog) recog.abort(); // Stop it fully.
    }
    updateStatus(errorMsg, "error");
  };

  recog.onend = () => {
    if (isSpeechRecognitionIntended) {
      // Only restart if it's supposed to be running (not manually stopped or critically errored)
      try {
          if (recog) recog.start(); // Attempt to restart the current instance
      } catch (e) {
          console.error("Error restarting speech recognition from onend:", e);
          updateStatus("Speech recognition stopped. Try Restart Mic.", "error");
      }
    } else {
        updateStatus("Speech recognition off.", "off");
    }
  };

  try {
    updateStatus("Initializing speech recognition...", "error");
    recog.start();
  } catch (e) {
    console.error("Error starting speech recognition:", e);
    updateStatus("Could not start speech. Use button or Restart Mic.", "error");
    isSpeechRecognitionIntended = false;
  }
}

function stopSpeech() {
  isSpeechRecognitionIntended = false;
  if (recog) {
    try {
        recog.abort(); // Use abort for a more immediate stop
    } catch(e) { console.warn("Error aborting speech in stopSpeech:", e);}
  }
  updateStatus("Speech recognition stopped.", "off");
}

snapBtn.onclick = takePhoto;

async function takePhoto() {
  if (!apiKey) {
    updateStatus("Enter your API key first!", "error");
    alert("Enter your API key first!");
    return;
  }
  if (!stream || !stream.active || !currentTrack) {
    updateStatus("Camera not active.", "error");
    alert("Camera not active. Please ensure camera is working and selected.");
    return;
  }

  snapBtn.disabled = true;
  updateStatus("🔄 Capturing…", "processing");

  const canvas = $("photo");
  const ctx = canvas.getContext("2d");
  const videoWidth = videoElement.videoWidth;
  const videoHeight = videoElement.videoHeight;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = videoWidth;
  tempCanvas.height = videoHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);

  ctx.clearRect(0,0, canvas.width, canvas.height);
  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);

  const dataURL = canvas.toDataURL("image/jpeg", 0.8);

  updateStatus("📨 Sending to OpenAI…", "processing");

  try {
    const answer = await queryOpenAI(dataURL);
    updateStatus(answer, isSpeechRecognitionIntended ? "listening" : "default");
    speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
  } catch (err) {
    console.error(err);
    updateStatus("❌ " + err.message, "error");
  } finally {
    snapBtn.disabled = false;
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
      model: "o4-mini",
      max_tokens: 50,
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
    const errorMsg = errData.error?.message || `HTTP error ${res.status}: ${res.statusText}`;
    throw new Error(errorMsg);
  }

  const json = await res.json();
  return json.choices[0].message.content.trim();
}

async function enableApp() {
  snapBtn.disabled = false;
  restartSpeechBtn.style.display = "inline-block";
  await populateCameraList(); 
  if (cameraSelect.options.length > 0) {
    if (!stream || !stream.active) {
        await startCamera(cameraSelect.value); 
    }
  } else {
    updateStatus("No cameras found. Connect a camera and refresh.", "error");
    disableCameraControls();
  }
  startSpeech(); 
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
    restartSpeechBtn.style.display = "none";
    disableCameraControls();
    updateStatus("App disabled. Enter API Key.", "off");
}

if (apiKey) {
  enableApp().catch(err => {
      console.error("Error on initial enableApp:", err);
      updateStatus("Error initializing app: " + err.message, "error");
  });
}