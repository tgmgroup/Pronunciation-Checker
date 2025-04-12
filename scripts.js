document.addEventListener("DOMContentLoaded", () => {
	// --- DOM Elements ---
	const textToPractice = document.getElementById("textToPractice");
	const speakButton = document.getElementById("speakButton");
	const recordButton = document.getElementById("recordButton");
	const stopButton = document.getElementById("stopButton");
	const sampleTextButton = document.getElementById("sampleTextButton");
	const voiceSelect = document.getElementById("voiceSelect");
	const rateSlider = document.getElementById("rateSlider");
	const rateValueSpan = document.getElementById("rateValue");
	const statusDiv = document.getElementById("status");
	const recognitionResultDiv = document.getElementById("recognitionResult");
	const resultTextSpan = document.getElementById("resultText");
	const feedbackDiv = document.getElementById("feedback");
	const practiceWordsDiv = document.getElementById("practiceWords");
	const wordsToPracticeTextSpan = document.getElementById(
		"wordsToPracticeText"
	);

	// --- State Variables ---
	let recognition;
	let isRecording = false;
	let finalTranscript = "";
	let synthVoices = []; // To store available voices

	// --- Feature Detection ---
	const SpeechRecognition =
		window.SpeechRecognition || window.webkitSpeechRecognition;
	const speechSynthesis = window.speechSynthesis;

	// --- Sample Texts Definition ---
	const sampleTexts = [
		"Hello. I will help you read some words.",
		"Hello. How are you doing today?",
		"Peter Piper picked a peck of pickled peppers.",
		"Practice makes perfect, keep trying!",
		"Hello, how are you doing on this fine day?",
		"Let's practice our English pronunciation!",
		"Please speak clearly into the microphone.",
		"Can you read this sentence aloud?",
	];

	// =========================================
	// == Text Loading Logic (URL Param / Sample) ==
	// =========================================
	let textLoadedFromUrl = false;
	try {
		const urlParams = new URLSearchParams(window.location.search);
		const textFromUrl = urlParams.get("text");
		if (textFromUrl !== null && textFromUrl.trim() !== "") {
			textToPractice.value = textFromUrl;
			statusDiv.textContent = "Status: Text loaded from URL. Ready.";
			textLoadedFromUrl = true;
			console.log("Loaded text from URL parameter 'text'.");
		}
	} catch (error) {
		console.error("Error processing URL parameters:", error);
	}

	function loadRandomSample(updateStatus = true) {
		// Clear previous results when loading new text
		feedbackDiv.style.display = "none";
		recognitionResultDiv.style.display = "none";
		practiceWordsDiv.style.display = "none";

		if (sampleTexts && sampleTexts.length > 0) {
			const randomIndex = Math.floor(Math.random() * sampleTexts.length);
			textToPractice.value = sampleTexts[randomIndex];
			if (updateStatus) {
				statusDiv.textContent = "Status: Sample text loaded. Ready.";
			}
		} else if (updateStatus) {
			statusDiv.textContent = "Status: No sample texts defined.";
		}
	}

	if (!textLoadedFromUrl) {
		loadRandomSample(true); // Load initial default sample
		console.log(
			"Loaded default sample text because no URL parameter was found."
		);
	}

	if (sampleTextButton) {
		sampleTextButton.addEventListener("click", () => loadRandomSample(true));
	}

	// --- Text-to-Speech Setup ---
	function populateVoiceList() {
		if (!speechSynthesis) return;
		synthVoices = speechSynthesis.getVoices();
		voiceSelect.innerHTML = ""; // Clear previous options

		// Filter slightly - sometimes default voices are duplicated across languages
		const uniqueVoices = synthVoices.filter(
			(voice, index, self) =>
				index ===
				self.findIndex((v) => v.name === voice.name && v.lang === voice.lang)
		);

		if (uniqueVoices.length === 0) {
			statusDiv.textContent = "Status: No speech synthesis voices found.";
			return;
		}

		for (let i = 0; i < uniqueVoices.length; i++) {
			const option = document.createElement("option");
			option.textContent = `${uniqueVoices[i].name} (${uniqueVoices[i].lang})`;
			option.setAttribute("data-lang", uniqueVoices[i].lang);
			option.setAttribute("data-name", uniqueVoices[i].name);
			voiceSelect.appendChild(option);
		}
		statusDiv.textContent = "Status: Voices loaded. Ready.";
	}

	// Initial population & handle dynamic changes
	if (speechSynthesis) {
		populateVoiceList();
		if (speechSynthesis.onvoiceschanged !== undefined) {
			speechSynthesis.onvoiceschanged = populateVoiceList;
		}
		// Update rate display
		rateSlider.oninput = () => {
			rateValueSpan.textContent = parseFloat(rateSlider.value).toFixed(1);
		};
	} else {
		statusDiv.textContent = "Status: Error - Speech Synthesis not supported.";
		speakButton.disabled = true;
		voiceSelect.disabled = true;
		rateSlider.disabled = true;
	}

	// --- Speak Button Handler ---
	speakButton.addEventListener("click", () => {
		const text = textToPractice.value.trim();
		if (!text || !speechSynthesis || synthVoices.length === 0) {
			statusDiv.textContent = text
				? "Status: No voices available or synthesis error."
				: "Status: Please enter text first.";
			return;
		}
		if (speechSynthesis.speaking) {
			speechSynthesis.cancel();
		}

		const utterance = new SpeechSynthesisUtterance(text);
		const selectedOption = voiceSelect.selectedOptions[0];
		const voiceName = selectedOption.getAttribute("data-name");

		// Find the selected voice object
		const selectedVoice = synthVoices.find((voice) => voice.name === voiceName);

		if (selectedVoice) {
			utterance.voice = selectedVoice;
			utterance.lang = selectedVoice.lang; // Match language too
		} else {
			console.warn("Selected voice not found, using default.");
			// Use default voice if selection fails
		}

		utterance.rate = parseFloat(rateSlider.value);
		utterance.pitch = 1; // Default pitch

		utterance.onstart = () => {
			speakButton.disabled = true;
			recordButton.disabled = true; // Prevent recording while speaking
			statusDiv.textContent = "Status: Speaking...";
		};
		utterance.onend = () => {
			speakButton.disabled = false;
			recordButton.disabled = false;
			statusDiv.textContent = "Status: Idle";
		};
		utterance.onerror = (event) => {
			statusDiv.textContent = `Status: Error during speech: ${event.error}`;
			console.error("Speech synthesis error", event);
			speakButton.disabled = false;
			recordButton.disabled = false;
		};
		speechSynthesis.speak(utterance);
	});

	// --- Speech Recognition Setup ---
	if (!SpeechRecognition) {
		statusDiv.textContent = "Status: Error - Speech Recognition not supported.";
		recordButton.disabled = true;
		stopButton.disabled = true;
	} else {
		recognition = new SpeechRecognition();
		recognition.continuous = false;
		recognition.interimResults = false;
		// Note: Set language based on expected input if possible,
		// maybe linked to the selected voice's language? For now, default 'en-US'
		recognition.lang = "en-US";

		recognition.onstart = () => {
			isRecording = true;
			statusDiv.textContent = "Status: Listening...";
			recordButton.disabled = true;
			stopButton.disabled = false;
			speakButton.disabled = true; // Prevent speaking while recording
			feedbackDiv.style.display = "none";
			recognitionResultDiv.style.display = "none";
			practiceWordsDiv.style.display = "none";
		};

		recognition.onresult = (event) => {
			finalTranscript = event.results[0][0].transcript;
			resultTextSpan.textContent = finalTranscript;
			recognitionResultDiv.style.display = "block";
		};

		recognition.onerror = (event) => {
			statusDiv.textContent = `Status: Error occurred in recognition: ${event.error}`;
			console.error("Speech recognition error", event);
			stopRecording(); // Reset state
		};

		recognition.onend = () => {
			if (finalTranscript) {
				compareText(); // Perform comparison and show results
			}
			stopRecording(); // Reset UI and state
			finalTranscript = ""; // Clear for next attempt
		};
	}

	// --- Recording Button Handlers ---
	recordButton.addEventListener("click", () => {
		if (!isRecording && recognition) {
			const text = textToPractice.value.trim();
			if (!text) {
				statusDiv.textContent = "Status: Please enter text to practice first.";
				return;
			}
			// Optional: Try setting recognition language based on selected voice
			const selectedLang =
				voiceSelect.selectedOptions[0]?.getAttribute("data-lang");
			if (selectedLang) {
				recognition.lang = selectedLang;
				console.log(`Recognition language set to: ${selectedLang}`);
			} else {
				recognition.lang = "en-US"; // Fallback
			}

			finalTranscript = ""; // Clear previous
			try {
				recognition.start();
			} catch (error) {
				statusDiv.textContent = `Status: Could not start recording: ${error.message}`;
				console.error("Error starting recognition:", error);
				stopRecording();
			}
		}
	});

	stopButton.addEventListener("click", () => {
		if (isRecording && recognition) {
			recognition.stop(); // This will trigger 'onend'
		}
	});

	function stopRecording() {
		isRecording = false;
		statusDiv.textContent = "Status: Idle";
		recordButton.disabled = false;
		stopButton.disabled = true;
		speakButton.disabled = false; // Re-enable speak button
	}

	// --- Comparison Logic ---
	// --- Comparison Logic ---
	function normalizeText(text) {
		// Keep the same normalization
		return text
			.toLowerCase()
			.replace(/[.,!?;:]/g, "")
			.trim();
	}

	function calculateAccuracy(originalText, recognizedText) {
		const normOriginal = normalizeText(originalText);
		const normRecognized = normalizeText(recognizedText);

		if (!normOriginal && !normRecognized)
			return { accuracy: 100, troublesomeWords: [] };
		if (!normOriginal || !normRecognized)
			return {
				accuracy: 0,
				troublesomeWords: normOriginal.split(/\s+/).filter(Boolean),
			};

		// --- Calculate Levenshtein-based Accuracy Score ---
		const distance = levenshteinDistance(normOriginal, normRecognized);
		const maxLength = Math.max(normOriginal.length, normRecognized.length);
		// Similarity is 1 - (distance / max length). Avoid division by zero.
		const similarity = maxLength === 0 ? 1 : 1 - distance / maxLength;
		const accuracy = Math.round(similarity * 100); // Convert to percentage

		// --- Identify Troublesome Words (using previous word-matching logic) ---
		const originalWords = normOriginal.split(/\s+/).filter(Boolean);
		const recognizedWords = normRecognized.split(/\s+/).filter(Boolean);
		const recognizedWordSet = new Set(recognizedWords);
		const troublesomeWords = [];

		if (originalWords.length > 0) {
			for (const word of originalWords) {
				// Still identify original words missing from the recognized set
				if (!recognizedWordSet.has(word)) {
					troublesomeWords.push(word);
				}
			}
		}

		// Return Levenshtein accuracy and word-based troublesome words
		return { accuracy: accuracy, troublesomeWords: troublesomeWords };
	}

	// The `compareText` function remains the same as it just consumes
	// the output of `calculateAccuracy`.
	function compareText() {
		const originalText = textToPractice.value.trim();
		const recognizedText = finalTranscript.trim(); // Set in onresult

		if (!originalText || !recognizedText) {
			feedbackDiv.textContent = "Comparison failed: Missing text.";
			feedbackDiv.className = "score-low"; // Assign class for styling
			feedbackDiv.style.display = "block";
			practiceWordsDiv.style.display = "none";
			return;
		}

		// This function now uses Levenshtein for accuracy internally
		const { accuracy, troublesomeWords } = calculateAccuracy(
			originalText,
			recognizedText
		);

		// Update Feedback Div (same logic as before)
		feedbackDiv.textContent = `Accuracy: ${accuracy}%`; // Added note
		feedbackDiv.className = ""; // Clear previous classes
		if (accuracy >= 80) {
			feedbackDiv.classList.add("score-high");
		} else if (accuracy >= 50) {
			feedbackDiv.classList.add("score-medium");
		} else {
			feedbackDiv.classList.add("score-low");
		}
		feedbackDiv.style.display = "block";

		// Update Practice Words Div (same logic as before)
		if (troublesomeWords.length > 0) {
			wordsToPracticeTextSpan.textContent = troublesomeWords.join(", ");
			practiceWordsDiv.style.display = "block";
		} else {
			// Also hide if accuracy perfect, even if comparison method changed
			if (accuracy === 100) {
				practiceWordsDiv.style.display = "none";
			} else {
				// If accuracy < 100 but no specific words were flagged as missing
				// (e.g., only substitutions happened), maybe add a generic message
				wordsToPracticeTextSpan.textContent =
					"(Consider reviewing the full text for minor differences)";
				practiceWordsDiv.style.display = "block";
			}
		}
	}

	/**
	 * Calculates the Levenshtein distance between two strings.
	 * (Minimum number of single-character edits: insertions, deletions, substitutions).
	 * Implementation uses dynamic programming (Wagner-Fischer algorithm).
	 * @param {string} s Source string.
	 * @param {string} t Target string.
	 * @returns {number} The Levenshtein distance.
	 */
	function levenshteinDistance(s, t) {
		if (!s || !s.length) return t ? t.length : 0;
		if (!t || !t.length) return s.length;

		// Create a 2D array (matrix)
		// rows = t.length + 1, cols = s.length + 1
		const matrix = Array(t.length + 1)
			.fill(null)
			.map(() => Array(s.length + 1).fill(null));

		// Initialize first column
		for (let i = 0; i <= t.length; i++) {
			matrix[i][0] = i;
		}

		// Initialize first row
		for (let j = 0; j <= s.length; j++) {
			matrix[0][j] = j;
		}

		// Fill the rest of the matrix
		for (let i = 1; i <= t.length; i++) {
			for (let j = 1; j <= s.length; j++) {
				const cost = s[j - 1] === t[i - 1] ? 0 : 1; // Cost is 0 if chars match, 1 otherwise

				matrix[i][j] = Math.min(
					matrix[i - 1][j] + 1, // Deletion from s
					matrix[i][j - 1] + 1, // Insertion into s
					matrix[i - 1][j - 1] + cost // Substitution
				);
			}
		}

		// The distance is the value in the bottom-right cell
		return matrix[t.length][s.length];
	}
});
