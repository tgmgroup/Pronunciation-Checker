// --- GLOBAL STATE ---
let finalTranscript = "";
let lastAudioBase64 = null;
let isEditMode = true;
let isAiAnalyzing = false;
let highlightedSpan = null;
let mediaRecorder;
let audioChunks = [];
let waveformAnimation;
let currentStream = null;
let availableVoices = [];

// DOM Elements (Declared globally for Firefox Scope)
let htmlElement,
	themeToggle,
	languageSelect,
	genderSelect,
	textEditor,
	speakButton,
	replayButton,
	aiCheckButton,
	recordButton,
	stopButton,
	sampleTextButton,
	rateSlider,
	rateValueSpan,
	statusDiv,
	feedbackDiv,
	accuracyValue,
	historyTable,
	historyList,
	waveformCanvas,
	waveformCtx,
	loadingScanner,
	resultsArea,
	practiceWordsDiv,
	wordsToPracticeText,
	globalPopover;

const translationsCache = {};

// --- 1. Internationalization ---
const i18n = {
	en: {
		title: "Reading Coach",
		listen: "Listen to Coach",
		edit: "Edit Text ✏️",
	},
	ja: {
		title: "リーディング・コーチ",
		listen: "お手本を聞く",
		edit: "テキスト編集 ✏️",
	},
	es: {
		title: "Entrenador de Lectura",
		listen: "Escuchar al Coach",
		edit: "Editar Texto ✏️",
	},
};

document.addEventListener("DOMContentLoaded", async () => {
	// --- Initialize DOM Elements ---
	htmlElement = document.documentElement;
	themeToggle = document.getElementById("theme-toggle");
	languageSelect = document.getElementById("languageSelect");
	genderSelect = document.getElementById("genderSelect");
	textEditor = document.getElementById("textToPractice");
	speakButton = document.getElementById("speakButton");
	replayButton = document.getElementById("replayButton");
	aiCheckButton = document.getElementById("aiCheckButton");
	recordButton = document.getElementById("recordButton");
	stopButton = document.getElementById("stopButton");
	sampleTextButton = document.getElementById("sampleTextButton");
	rateSlider = document.getElementById("rateSlider");
	rateValueSpan = document.getElementById("rateValue");
	statusDiv = document.getElementById("status");
	feedbackDiv = document.getElementById("visualFeedback");
	accuracyValue = document.getElementById("accuracyValue");
	historyTable = document.querySelector("#historyTable tbody");
	historyList = document.getElementById("textHistoryList");
	waveformCanvas = document.getElementById("waveformCanvas");
	waveformCtx = waveformCanvas.getContext("2d");
	loadingScanner = document.getElementById("loadingScanner");
	resultsArea = document.getElementById("resultsArea");
	practiceWordsDiv = document.getElementById("practiceWordsDiv");
	wordsToPracticeText = document.getElementById("wordsToPracticeText");

	globalPopover = document.createElement("div");
	globalPopover.id = "globalPopover";
	document.body.appendChild(globalPopover);

	// Initial Load
	loadHistoryFromLocal();

	// --- 2. Speech Recognition Setup ---
	const SpeechRecognition =
		window.SpeechRecognition || window.webkitSpeechRecognition;
	const recognition = SpeechRecognition ? new SpeechRecognition() : null;
	if (recognition) {
		recognition.continuous = false;
		recognition.interimResults = false;
	}

	// --- 3. Mode Switching ---
	function switchToPracticeMode() {
		const text = textEditor.textContent.trim();
		if (!text) return false;
		isEditMode = false;
		let charCounter = 0;
		const words = text.split(/\s+/);
		textEditor.innerHTML = words
			.map((word) => {
				const start = charCounter;
				charCounter += word.length + 1;
				return `<span class="word-span word" data-start="${start}" style="cursor:pointer; padding: 0 2px; border-radius: 3px;">${word}</span>`;
			})
			.join(" ");
		textEditor.contentEditable = "false";
		textEditor.classList.add("practice-mode");
		speakButton.innerHTML = i18n[languageSelect.value]?.edit || "Edit Text ✏️";
		replayButton.style.display = "inline-block";
		recordButton.disabled = false;
		return true;
	}

	function switchToEditMode() {
		isEditMode = true;
		window.speechSynthesis.cancel();
		const plainText = textEditor.textContent;
		textEditor.innerHTML = plainText;
		textEditor.contentEditable = "true";
		textEditor.classList.remove("practice-mode");
		speakButton.innerHTML =
			i18n[languageSelect.value]?.listen || "Listen to Coach";
		replayButton.style.display = "none";
		aiCheckButton.style.display = "none";
		if (practiceWordsDiv) practiceWordsDiv.style.display = "none";
		recordButton.disabled = true;
		textEditor.focus();
	}

	// --- 4. Speech Synthesis ---
	async function playCoachSpeech() {
		window.speechSynthesis.cancel();
		const text = textEditor.textContent.trim();
		if (!text) return;

		const langCode = languageSelect.value;
		const preferredGender = genderSelect.value;
		const rate = parseFloat(rateSlider.value);

		const voices = window.speechSynthesis.getVoices();
		const edgeVoice = voices.find(
			(v) =>
				v.lang.startsWith(langCode) &&
				v.name.includes("Natural") &&
				(preferredGender === "female"
					? v.name.includes("Aria") || v.name.includes("Jenny")
					: v.name.includes("Guy")),
		);

		if (edgeVoice) {
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.voice = edgeVoice;
			utterance.rate = rate;
			utterance.onboundary = (e) => {
				if (e.name === "word") highlightWordAtOffset(e.charIndex);
			};
			utterance.onend = () => clearHighlights();
			window.speechSynthesis.speak(utterance);
		} else {
			try {
				const response = await fetch("/api/speech", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						text,
						language: langCode,
						gender: preferredGender,
						speed: rate,
					}),
				});
				const data = await response.json();
				const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
				simulateHighlighting(text, rate);
				audio.play();
				audio.onended = () => clearHighlights();
			} catch (err) {
				console.error("Speech API Error:", err);
				const fallback = new SpeechSynthesisUtterance(text);
				fallback.lang = langCode;
				window.speechSynthesis.speak(fallback);
			}
		}
	}

	// --- 5. Levenshtein Comparison Logic ---
	function levenshteinDistance(s, t) {
		if (!s.length) return t.length;
		if (!t.length) return s.length;
		const matrix = Array(t.length + 1)
			.fill(null)
			.map(() => Array(s.length + 1).fill(null));
		for (let i = 0; i <= t.length; i++) matrix[i][0] = i;
		for (let j = 0; j <= s.length; j++) matrix[0][j] = j;
		for (let i = 1; i <= t.length; i++) {
			for (let j = 1; j <= s.length; j++) {
				const cost = s[j - 1] === t[i - 1] ? 0 : 1;
				matrix[i][j] = Math.min(
					matrix[i - 1][j] + 1,
					matrix[i][j - 1] + 1,
					matrix[i - 1][j - 1] + cost,
				);
			}
		}
		return matrix[t.length][s.length];
	}

	function normalizeText(text) {
		return text
			.toLowerCase()
			.replace(/[.,!?;:]/g, "")
			.trim();
	}

	function calculateAccuracy(originalText, recognizedText) {
		const normOriginal = normalizeText(originalText);
		const normRecognized = normalizeText(recognizedText);
		if (!normOriginal) return { accuracy: 0, troublesomeWords: [] };

		const distance = levenshteinDistance(normOriginal, normRecognized);
		const maxLength = Math.max(normOriginal.length, normRecognized.length);
		const accuracy = Math.round(
			(maxLength === 0 ? 1 : 1 - distance / maxLength) * 100,
		);

		const originalWords = normOriginal.split(/\s+/).filter(Boolean);
		const recognizedWordSet = new Set(
			normRecognized.split(/\s+/).filter(Boolean),
		);
		const troublesomeWords = originalWords.filter(
			(word) => !recognizedWordSet.has(word),
		);

		return { accuracy, troublesomeWords };
	}

	function compareText() {
		const originalText = textEditor.textContent.trim();
		const recognizedText = finalTranscript.trim();
		if (!originalText) return;

		const { accuracy, troublesomeWords } = calculateAccuracy(
			originalText,
			recognizedText,
		);

		feedbackDiv.innerHTML = "";
		feedbackDiv.className =
			accuracy >= 80
				? "score-high"
				: accuracy >= 50
					? "score-medium"
					: "score-low";

		const summaryHeader = document.createElement("div");
		summaryHeader.style.marginBottom = "10px";
		summaryHeader.innerHTML = `
            <div style="font-size: 0.9em; opacity: 0.8; margin-bottom: 5px;">I heard: "${recognizedText || "..."}"</div>
            <strong>Accuracy: ${accuracy}%</strong>
        `;
		feedbackDiv.appendChild(summaryHeader);

		const wordContainer = document.createElement("div");
		const originalWords = originalText.split(/\s+/).filter(Boolean);
		const normRecognized = normalizeText(recognizedText);
		const recognizedWordSet = new Set(normRecognized.split(/\s+/));

		originalWords.forEach((word) => {
			const span = document.createElement("span");
			span.innerText = word + " ";
			if (recognizedWordSet.has(normalizeText(word))) {
				span.className = "word-correct";
			} else {
				span.className = "word-missed";
			}
			wordContainer.appendChild(span);
		});
		feedbackDiv.appendChild(wordContainer);

		accuracyValue.textContent = accuracy;
		feedbackDiv.style.display = "block";
		resultsArea.style.display = "block";

		if (troublesomeWords.length > 0 && wordsToPracticeText) {
			wordsToPracticeText.textContent = troublesomeWords.join(", ");
			if (practiceWordsDiv) practiceWordsDiv.style.display = "block";
		} else if (practiceWordsDiv) {
			practiceWordsDiv.style.display = "none";
		}

		// Trigger History and Sidebar updates
		updateHistory(accuracy, troublesomeWords);
		addToSidebar(originalText, accuracy);
	}

	// --- 6. Recording and AI Logic ---
	//function stopRecordingSequence() {
	//		if (recognition) recognition.stop();
	//		if (mediaRecorder && mediaRecorder.state !== "inactive")
	//			mediaRecorder.stop();
	//		toggleRecordingUI(false);
	//	}

	// --- Updated State Variable ---
	let interimTranscript = "";

	function stopRecordingSequence() {
		console.log("Stopping...");

		if (recognition) {
			try {
				recognition.stop();
			} catch (e) {
				console.warn("Recognition already stopped or not started.");
			}
		}

		if (mediaRecorder && mediaRecorder.state !== "inactive") {
			mediaRecorder.stop();
		}

		// FIREFOX FIX: If finalTranscript is empty but we have interim text,
		// use the interim text as the result.
		if (!finalTranscript && interimTranscript) {
			console.log("Using interim transcript as fallback:", interimTranscript);
			finalTranscript = interimTranscript;
			compareText();
		} else if (!finalTranscript && !interimTranscript) {
			statusDiv.textContent = "Status: No speech heard. Try again!";
			statusDiv.style.color = "var(--danger, #f44336)";
		}

		toggleRecordingUI(false);
	}

	recordButton.addEventListener("click", async () => {
		if (isEditMode) return;
		try {
			currentStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			startWaveform(currentStream);

			// Reset both variables
			finalTranscript = "";
			interimTranscript = "";

			if (recognition) {
				recognition.lang = languageSelect.value === "ja" ? "ja-JP" : "en-US";
				recognition.continuous = true; // Keep listening to catch everything
				recognition.interimResults = true; // CRITICAL for Firefox

				recognition.onresult = (e) => {
					let currentInterim = "";
					for (let i = e.resultIndex; i < e.results.length; ++i) {
						if (e.results[i].isFinal) {
							finalTranscript += e.results[i][0].transcript;
						} else {
							currentInterim += e.results[i][0].transcript;
						}
					}
					// Store the latest "best guess" in our global interim variable
					interimTranscript = finalTranscript + currentInterim;
					console.log("Live Transcript:", interimTranscript);
				};

				recognition.onerror = (e) => {
					console.error("Speech Error:", e.error);
					if (e.error === "no-speech") {
						statusDiv.textContent = "Status: No speech detected.";
					}
					stopRecordingSequence();
				};

				recognition.start();
			}

			mediaRecorder = new MediaRecorder(currentStream);
			audioChunks = [];
			mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
			mediaRecorder.onstop = () => {
				cancelAnimationFrame(waveformAnimation);
				const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
				const reader = new FileReader();
				reader.readAsDataURL(audioBlob);
				reader.onloadend = () => {
					lastAudioBase64 = reader.result.split(",")[1];
					aiCheckButton.style.display = "inline-block";
				};
				if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
			};

			mediaRecorder.start();
			toggleRecordingUI(true);
			statusDiv.textContent = "Status: Listening... Click STOP when done.";
			statusDiv.style.color = "var(--success, #4CAF50)";
		} catch (err) {
			console.error("Mic Access Error:", err);
			statusDiv.textContent = "Status: Microphone blocked.";
		}
	});

	recordButton.addEventListener("click", async () => {
		if (isEditMode) return;
		try {
			currentStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			startWaveform(currentStream);
			finalTranscript = "";

			if (recognition) {
				recognition.lang = languageSelect.value === "ja" ? "ja-JP" : "en-US";
				recognition.onresult = (e) => {
					finalTranscript = e.results[0][0].transcript;
					console.log("Local Transcript:", finalTranscript);
					compareText();
				};
				recognition.onspeechend = () => setTimeout(stopRecordingSequence, 500);
				recognition.onerror = (e) => {
					console.error("Recognition error:", e.error);
					stopRecordingSequence();
				};
				recognition.start();
			}

			mediaRecorder = new MediaRecorder(currentStream);
			audioChunks = [];
			mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
			mediaRecorder.onstop = () => {
				cancelAnimationFrame(waveformAnimation);
				const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
				const reader = new FileReader();
				reader.readAsDataURL(audioBlob);
				reader.onloadend = () => {
					lastAudioBase64 = reader.result.split(",")[1];
					aiCheckButton.style.display = "inline-block";
				};
				if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
			};
			mediaRecorder.start();
			toggleRecordingUI(true);
			statusDiv.textContent = "Status: Listening...";
		} catch (err) {
			statusDiv.textContent = "Status: Mic error.";
			console.error(err);
		}
	});

	aiCheckButton.addEventListener("click", async () => {
		if (!lastAudioBase64) return;
		isAiAnalyzing = true;
		loadingScanner.style.display = "block";
		statusDiv.textContent = "Status: AI analyzing flow...";

		try {
			const res = await fetch("/api/coach", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					audio: lastAudioBase64,
					language: languageSelect.value,
					targetText: textEditor.textContent.trim(),
					mode: "lite",
				}),
			});
			const result = await res.json();

			const existing = document.querySelector(".ai-coach-feedback");
			if (existing) existing.remove();

			const div = document.createElement("div");
			div.className = "ai-coach-feedback";
			div.style.cssText =
				"border-left: 4px solid #673ab7; padding: 15px; margin-top: 15px; background: rgba(103, 58, 183, 0.1); border-radius: 8px;";
			div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <strong>✨ AI Coach Feedback</strong>
                    <span class="score-badge" style="background: #673ab7; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">
                        Flow: ${result.intonation_score || 0}%
                    </span>
                </div>
                <p style="margin: 5px 0; font-weight: 500;">${result.feedback}</p>
                <p style="margin: 5px 0; font-style: italic; opacity: 0.8; font-size: 0.9em; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 5px;">
                    ${result.feedback_translated || ""}
                </p>
            `;
			resultsArea.appendChild(div);
			resultsArea.style.display = "block";
		} catch (e) {
			statusDiv.textContent = "Status: AI Error.";
		} finally {
			loadingScanner.style.display = "none";
			isAiAnalyzing = false;
		}
	});

	stopButton.addEventListener("click", stopRecordingSequence);

	// --- 7. Utility UI Functions ---
	function highlightWordAtOffset(charIndex) {
		const spans = textEditor.querySelectorAll(".word-span");
		spans.forEach((span) => {
			const start = parseInt(span.dataset.start);
			if (charIndex >= start && charIndex < start + span.innerText.length) {
				if (highlightedSpan)
					highlightedSpan.style.backgroundColor = "transparent";
				span.style.backgroundColor = "#ffeb3b";
				highlightedSpan = span;
			}
		});
	}

	function simulateHighlighting(text, rate) {
		const spans = textEditor.querySelectorAll(".word-span");
		let currentDelay = 0;
		spans.forEach((span) => {
			const baseMsPerWord = 400 / rate;
			setTimeout(() => {
				if (highlightedSpan)
					highlightedSpan.style.backgroundColor = "transparent";
				span.style.backgroundColor = "#ffeb3b";
				highlightedSpan = span;
			}, currentDelay);
			currentDelay += baseMsPerWord;
		});
	}

	function clearHighlights() {
		if (highlightedSpan) highlightedSpan.style.backgroundColor = "transparent";
	}

	function toggleRecordingUI(rec) {
		recordButton.disabled = rec;
		stopButton.disabled = !rec;
		statusDiv.textContent = rec ? "Status: Listening..." : "Status: Done.";
	}

	function startWaveform(stream) {
		const ctx = new (window.AudioContext || window.webkitAudioContext)();
		const src = ctx.createMediaStreamSource(stream);
		const ans = ctx.createAnalyser();
		ans.fftSize = 256;
		src.connect(ans);
		const data = new Uint8Array(ans.frequencyBinCount);
		function draw() {
			waveformAnimation = requestAnimationFrame(draw);
			ans.getByteTimeDomainData(data);
			waveformCtx.fillStyle = "#141414";
			waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
			waveformCtx.lineWidth = 2;
			waveformCtx.strokeStyle = "#4CAF50";
			waveformCtx.beginPath();
			let x = 0;
			const slice = waveformCanvas.width / data.length;
			for (let i = 0; i < data.length; i++) {
				const y = ((data[i] / 128.0) * waveformCanvas.height) / 2;
				i === 0 ? waveformCtx.moveTo(x, y) : waveformCtx.lineTo(x, y);
				x += slice;
			}
			waveformCtx.stroke();
		}
		draw();
	}

	// --- 8. Standard Interaction Listeners ---
	speakButton.onclick = () =>
		isEditMode
			? switchToPracticeMode() && playCoachSpeech()
			: switchToEditMode();
	replayButton.onclick = playCoachSpeech;
	rateSlider.oninput = () =>
		(rateValueSpan.textContent = parseFloat(rateSlider.value).toFixed(1) + "x");

	sampleTextButton.onclick = () => {
		if (!isEditMode) switchToEditMode();
		const s = [
			"The quick brown fox jumps over the lazy dog.",
			"Practice makes perfect.",
			"Hello. I will help you read some words.",
			"Hello. How are you doing today?",
			"Peter Piper picked a peck of pickled peppers.",
			"Let's practice our English pronunciation!",
			"Please speak clearly into the microphone.",
		];
		textEditor.textContent = s[Math.floor(Math.random() * s.length)];
	};

	themeToggle.onclick = () => {
		const dark = htmlElement.classList.toggle("dark-mode");
		htmlElement.classList.toggle("light-mode", !dark);
		localStorage.setItem("theme", dark ? "dark" : "light");
	};

	// Translation Hover Logic
	textEditor.addEventListener("mouseover", (event) => {
		if (isEditMode || !event.target.classList.contains("word")) return;
		const wordSpan = event.target;
		const word = wordSpan.textContent.trim().replace(/[.,!?;:]/g, "");
		let targetLang =
			languageSelect.value === "en" ? "ja" : languageSelect.value;
		const cacheKey = `${targetLang}-${word}`;

		const showPopover = (trans) => {
			const rect = wordSpan.getBoundingClientRect();
			globalPopover.textContent = trans;
			globalPopover.style.display = "block";
			globalPopover.style.top = `${rect.top + window.scrollY - globalPopover.offsetHeight - 10}px`;
			globalPopover.style.left = `${rect.left + window.scrollX + rect.width / 2 - globalPopover.offsetWidth / 2}px`;
			globalPopover.style.opacity = "1";
		};

		if (translationsCache[cacheKey]) showPopover(translationsCache[cacheKey]);
		else {
			showPopover("...");
			fetch(
				`/api/translate?text=${encodeURIComponent(word)}&sourceLang=en&targetLang=${targetLang}`,
			)
				.then((res) => res.json())
				.then((data) => {
					translationsCache[cacheKey] = data.translatedText;
					showPopover(data.translatedText);
				})
				.catch(() => showPopover("Error"));
		}
	});

	textEditor.addEventListener("mouseout", (event) => {
		if (event.target.classList.contains("word")) {
			globalPopover.style.opacity = "0";
			globalPopover.style.display = "none";
		}
	});
});

// --- 9. History & Sidebar Management (Global Scope for Firefox) ---

function saveHistoryToLocal() {
	if (!historyList) return;
	const items = Array.from(historyList.children).map(
		(item) => item.dataset.fullText,
	);
	localStorage.setItem("coachTextHistory", JSON.stringify(items));
}

function loadHistoryFromLocal() {
	const saved = localStorage.getItem("coachTextHistory");
	if (saved) {
		const items = JSON.parse(saved);
		items.reverse().forEach((text) => addToSidebar(text));
	}
}

function updateHistory(score, missed) {
	if (!historyTable) return;
	const row = historyTable.insertRow(0);
	const time = new Date().toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	row.innerHTML = `
        <td>${time}</td>
        <td><strong>${score}%</strong></td>
        <td>${missed.length ? missed.join(", ") : "Perfect!"}</td>
    `;
}

function addToSidebar(text, score = 0) {
	if (!historyList || !text.trim()) return;
	const cleanText = text.replace(/<[^>]*>/g, "").trim();
	let item = Array.from(historyList.children).find(
		(i) => i.dataset.fullText === cleanText,
	);

	if (!item) {
		item = document.createElement("div");
		item.className = "history-item";
		item.dataset.fullText = cleanText;
		const shortText =
			cleanText.length > 40 ? cleanText.substring(0, 40) + "..." : cleanText;
		item.innerHTML = `<span>${shortText}</span><span class="score-badge"></span>`;
		item.onclick = () => {
			if (!isEditMode) switchToEditMode();
			textEditor.textContent = cleanText;
		};
		historyList.prepend(item);
	}

	const badge = item.querySelector(".score-badge");
	if (badge) {
		badge.innerText = `${score}%`;
		badge.style.backgroundColor =
			score >= 80
				? "var(--success, #4caf50)"
				: score >= 50
					? "#ffa500"
					: "var(--danger, #f44336)";
	}
	saveHistoryToLocal();
}

const clearBtn = document.getElementById("clearHistoryBtn");
if (clearBtn) {
	clearBtn.onclick = () => {
		if (confirm("Are you sure?")) {
			if (historyList) historyList.innerHTML = "";
			if (historyTable) historyTable.innerHTML = "";
			localStorage.removeItem("coachTextHistory");
		}
	};
}

// Voice change sync
window.speechSynthesis.onvoiceschanged = () => {
	availableVoices = window.speechSynthesis.getVoices();
};
