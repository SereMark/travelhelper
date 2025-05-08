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
  updateStatus("Key saved. Say \"snap\" or press the button.");
});

$("clearKey").onclick = () => {
  localStorage.removeItem("OPENAI_KEY");
  apiKey = "";
  snapBtn.disabled = true;
  updateStatus("Key cleared. Enter a new key to continue.");
  apiInput.value = "";
};

// ===== 2. Camera bootstrap =============================================
let stream;
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: 512, height: 512 }
  });
  $("view").srcObject = stream;
}

// ===== 3. Speech recognition trigger ===================================
let recog;
function startSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // not supported; the button will still work
  recog = new SpeechRecognition();
  recog.continuous = true;
  recog.interimResults = false;
  recog.onresult = (e) => {
    const last = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (last.includes("snap")) takePhoto();
  };
  recog.start();
}

// ===== 4. Photo capture & act ========================================
snapBtn.onclick = takePhoto;

async function takePhoto() {
  if (!apiKey) return alert("Enter your API key first!");
  snapBtn.disabled = true;
  updateStatus("🔄 Capturing…");

  const canvas = $("photo");
  const ctx = canvas.getContext("2d");
  ctx.drawImage($("view"), 0, 0, canvas.width, canvas.height);
  const dataURL = canvas.toDataURL("image/jpeg", 0.7);

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
          { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
          { type: "text", text: "Solve the problem in the image and only tell the answer in a concoise but understandable way." }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || res.statusText);
  }

  const json = await res.json();
  return json.choices[0].message.content.trim();
}

// ===== 5. App init ======================================================
async function enableApp() {
  snapBtn.disabled = false;
  if (!stream)  startCamera().catch(e => updateStatus("Camera error: " + e.message));
  if (!recog)   startSpeech();
  updateStatus("Say \"snap\" or press the button.");
}