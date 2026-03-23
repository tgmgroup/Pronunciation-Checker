document.addEventListener("DOMContentLoaded", async () => {
	// --- DOM Elements ---
	const htmlElement = document.documentElement;
	const themeToggle = document.getElementById("theme-toggle");
	const languageSelect = document.getElementById("languageSelect");
	const textToPractice = document.getElementById("textToPractice");
	const speakButton = document.getElementById("speakButton");
	const recordButton = document.getElementById("recordButton");
	const stopButton = document.getElementById("stopButton");
	const sampleTextButton = document.getElementById("sampleTextButton");
	const rateSlider = document.getElementById("rateSlider");
	const rateValueSpan = document.getElementById("rateValue");
	const statusDiv = document.getElementById("status");
	const feedbackDiv = document.getElementById("visualFeedback");
	const accuracyValue = document.getElementById("accuracyValue");
	const historyTable = document.querySelector("#historyTable tbody");
	const coachDiv = document.getElementById("translationCoach");
	const coachAdvice = document.getElementById("coachAdvice");
	const historyList = document.getElementById("textHistoryList");
	const waveformCanvas = document.getElementById("waveformCanvas");
	const waveformCtx = waveformCanvas.getContext("2d");

	// --- State Variables ---
	let mediaRecorder;
	let audioChunks = [];
	let isRecording = false;
	let audioContext;
	let analyser;
	let waveformAnimation;

	// --- 1. i18n Dictionary ---
	const i18n = {
		en: {
			title: "Reading Coach",
			start: "Start Reading",
			stop: "Stop",
			listen: "Listen to Coach",
			speed: "Speed",
			history: "Practice History",
			coachTip: "Click a red word for coaching.",
		},
		ja: {
			title: "リーディング・コーチ",
			start: "録音開始",
			stop: "停止",
			listen: "お手本を聞く",
			speed: "速度",
			history: "練習履歴",
			coachTip: "赤い単語をクリックしてコーチングを受ける。",
		},
		es: {
			title: "Entrenador de Lectura",
			start: "Grabar",
			stop: "Parar",
			listen: "Escuchar al Coach",
			speed: "Velocidad",
			history: "Historial",
			coachTip: "Haz clic en una palabra roja para recibir ayuda.",
		},
	};

	async function ensurePuterLogin() {
		try {
			const signedIn = await puter.auth.isSignedIn();
			if (!signedIn) {
				statusDiv.textContent = "Status: Signing in to AI...";
				await puter.auth.signIn();
			}
		} catch (err) {
			statusDiv.textContent = "Status: Login failed.";
			console.error(err);
		}
	}

	// --- 2. Sidebar History Logic ---
	function addToSidebar(text) {
		if (!text || !text.trim()) return;
		if (
			historyList.firstChild &&
			historyList.firstChild.dataset.fullText === text.trim()
		)
			return;

		const item = document.createElement("div");
		item.className = "history-item";
		item.dataset.fullText = text.trim();
		item.innerText = text.length > 40 ? text.substring(0, 40) + "..." : text;
		item.onclick = () => {
			textToPractice.value = text;
		};
		historyList.prepend(item);
	}

	// --- 3. URL Query Parameter Logic (NEW) ---
	function loadFromURL() {
		const urlParams = new URLSearchParams(window.location.search);
		const textParam = urlParams.get("text");
		const langParam = urlParams.get("lang");

		if (textParam) {
			const decodedText = decodeURIComponent(textParam);
			textToPractice.value = decodedText;
			addToSidebar(decodedText);
			statusDiv.textContent = "Status: Text loaded from link.";
		}
		if (langParam && i18n[langParam]) {
			languageSelect.value = langParam;
			languageSelect.dispatchEvent(new Event("change"));
		}
	}

	// --- 4. Dark Mode Logic ---
	function applyTheme(theme) {
		htmlElement.classList.remove("light-mode", "dark-mode");
		if (theme === "dark") htmlElement.classList.add("dark-mode");
		else if (theme === "light") htmlElement.classList.add("light-mode");

		theme === "system"
			? localStorage.removeItem("theme")
			: localStorage.setItem("theme", theme);
		updateThemeUI();
	}

	function updateThemeUI() {
		const isDark =
			htmlElement.classList.contains("dark-mode") ||
			(!htmlElement.classList.contains("light-mode") &&
				window.matchMedia("(prefers-color-scheme: dark)").matches);
		if (themeToggle) {
			themeToggle.innerHTML = isDark ? "Dark 🌙" : "Light ☀️";
		}
	}

	if (themeToggle) {
		themeToggle.addEventListener("click", () => {
			const isCurrentlyDark = htmlElement.classList.contains("dark-mode");
			applyTheme(isCurrentlyDark ? "light" : "dark");
		});
	}

	// --- 5. Speech & AI Logic ---
	rateSlider.oninput = () => {
		rateValueSpan.textContent = parseFloat(rateSlider.value).toFixed(1);
	};

	recordButton.addEventListener("click", async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			startWaveform(stream);
			mediaRecorder = new MediaRecorder(stream);
			audioChunks = [];

			mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
			mediaRecorder.onstop = async () => {
				cancelAnimationFrame(waveformAnimation);
				waveformCtx.clearRect(
					0,
					0,
					waveformCanvas.width,
					waveformCanvas.height,
				);
				statusDiv.textContent = "Status: Analyzing pronunciation...";

				const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
				try {
					await ensurePuterLogin();
					const response = await puter.ai.transcribe(audioBlob);
					evaluatePronunciation(response.text);

					const aiFeedback = await evaluateWithAI(
						textToPractice.value.trim(),
						response.text,
					);
					if (aiFeedback) {
						const div = document.createElement("div");
						div.className = "ai-coach-feedback";
						div.innerHTML = `<strong>AI Coach</strong><br>${aiFeedback.replace(/\n/g, "<br>")}`;
						document.getElementById("resultsArea").appendChild(div);
					}
				} catch (err) {
					statusDiv.textContent = "Status: Transcription error.";
				}
			};

			mediaRecorder.start();
			toggleRecordingUI(true);
		} catch (err) {
			statusDiv.textContent = "Status: Mic access denied.";
		}
	});

	stopButton.addEventListener("click", () => {
		if (mediaRecorder && mediaRecorder.state === "recording") {
			mediaRecorder.stop();
			toggleRecordingUI(false);
		}
	});

	speakButton.addEventListener("click", async () => {
		const text = textToPractice.value.trim();
		if (!text) return;
		await ensurePuterLogin();
		statusDiv.textContent = "Status: Coach is speaking...";
		const audio = await puter.ai.txt2speech(text);
		audio.play();
		audio.onended = () => (statusDiv.textContent = "Status: Idle");
	});

	function toggleRecordingUI(recording) {
		isRecording = recording;
		recordButton.disabled = recording;
		stopButton.disabled = !recording;
		statusDiv.textContent = recording
			? "Status: Listening..."
			: "Status: Processing...";
	}

	function evaluatePronunciation(userSpeech) {
		const targetText = textToPractice.value.trim();
		addToSidebar(targetText); // Save to history
		const normTarget = targetText.toLowerCase().replace(/[.,!?;:]/g, "");
		const targetWords = normTarget.split(/\s+/).filter(Boolean);
		const userWords = userSpeech
			.toLowerCase()
			.replace(/[.,!?;:]/g, "")
			.split(/\s+/);

		document.getElementById("resultsArea").style.display = "block";
		feedbackDiv.innerHTML = "";
		let correctCount = 0;
		let missedWords = [];

		targetWords.forEach((word) => {
			const span = document.createElement("span");
			span.innerText = word + " ";
			if (userWords.includes(word)) {
				span.className = "word-correct";
				correctCount++;
			} else {
				span.className = "word-missed";
				span.onclick = () => getCoachHelp(word);
				missedWords.push(word);
			}
			feedbackDiv.appendChild(span);
		});

		const score = Math.round((correctCount / targetWords.length) * 100);
		accuracyValue.textContent = score;
		updateHistory(score, missedWords);
	}

	async function evaluateWithAI(targetText, userSpeech) {
		const prompt = `Pronunciation Coach: Target "${targetText}", Student said "${userSpeech}". 1 short tip.`;
		try {
			const response = await puter.ai.chat(prompt);
			return response.toString();
		} catch (err) {
			return null;
		}
	}

	async function getCoachHelp(word) {
		const lang = languageSelect.value;
		coachDiv.style.display = "block";
		coachAdvice.innerHTML = `<em>Thinking about "${word}"...</em>`;
		const prompt = `Explain how to pronounce "${word}" for a ${lang} speaker. Translation, phonetics, 1 tip.`;
		await ensurePuterLogin();
		const response = await puter.ai.chat(prompt);
		coachAdvice.innerHTML =
			"<strong>Help:</strong><br>" + response.toString().replace(/\n/g, "<br>");

		try {
			const audio = await puter.ai.txt2speech(word); // Corrected to speak just the word
			audio.play();
		} catch (err) {
			console.error(err);
		}
	}

	function updateHistory(score, missed) {
		const row = historyTable.insertRow(0);
		const time = new Date().toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
		row.innerHTML = `<td>${time}</td><td><strong>${score}%</strong></td><td>${missed.length > 0 ? missed.join(", ") : "Perfect!"}</td>`;
	}

	languageSelect.addEventListener("change", (e) => {
		const t = i18n[e.target.value];
		document.getElementById("ui-title").innerText = t.title;
		recordButton.innerText = t.start;
		stopButton.innerText = t.stop;
		speakButton.innerText = t.listen;
		document.getElementById("ui-label-speed").innerText = t.speed;
		document.getElementById("ui-label-history").innerText = t.history;
		coachAdvice.innerText = t.coachTip;
	});

	sampleTextButton.addEventListener("click", () => {
		const samples = [
			"The quick brown fox jumps over the lazy dog.",
			"Practice makes perfect.",
			"Puter AI is amazing.",
		];
		const text = samples[Math.floor(Math.random() * samples.length)];
		textToPractice.value = text;
		addToSidebar(text);
	});

	// --- Init ---
	updateThemeUI();
	loadFromURL();
	await ensurePuterLogin();
});

function startWaveform(stream) {
	audioContext = new AudioContext();
	const source = audioContext.createMediaStreamSource(stream);
	analyser = audioContext.createAnalyser();
	analyser.fftSize = 2048;
	source.connect(analyser);

	const bufferLength = analyser.fftSize;
	const dataArray = new Uint8Array(bufferLength);
	const waveformCanvas = document.getElementById("waveformCanvas");
	const waveformCtx = waveformCanvas.getContext("2d");

	function draw() {
		waveformAnimation = requestAnimationFrame(draw);
		analyser.getByteTimeDomainData(dataArray);
		waveformCtx.fillStyle = "#111";
		waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
		waveformCtx.lineWidth = 2;
		waveformCtx.strokeStyle = "#4CAF50";
		waveformCtx.beginPath();
		const sliceWidth = waveformCanvas.width / bufferLength;
		let x = 0;
		for (let i = 0; i < bufferLength; i++) {
			const v = dataArray[i] / 128.0;
			const y = (v * waveformCanvas.height) / 2;
			if (i === 0) waveformCtx.moveTo(x, y);
			else waveformCtx.lineTo(x, y);
			x += sliceWidth;
		}
		waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
		waveformCtx.stroke();
	}
	draw();
}

document.getElementById("clearHistoryBtn").onclick = () => {
	if (confirm("Clear all practiced texts?")) {
		document.getElementById("textHistoryList").innerHTML = "";
	}
};
