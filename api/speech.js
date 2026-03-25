import fetch from "node-fetch";

export default async function handler(req, res) {
	// 1. Set CORS headers for local/Vercel development
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	// Handle Pre-flight request
	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method Not Allowed" });
	}

	const { text, language, gender, speed } = req.body;

	// Ensure we use the correct environment variable name from your .env
	const API_KEY = process.env.GOOGLE_CLOUD_API_KEY;

	// Mapping for Google Cloud Neural2 voices
	const voiceMap = {
		en: { female: "en-US-Neural2-F", male: "en-US-Neural2-D" },
		ja: { female: "ja-JP-Neural2-B", male: "ja-JP-Neural2-C" },
		es: { female: "es-ES-Neural2-A", male: "es-ES-Neural2-B" },
	};

	// Fallback logic to prevent "undefined" voice name errors
	const selectedLanguage = language || "en";
	const selectedGender = gender || "female";
	const voiceName =
		voiceMap[selectedLanguage] && voiceMap[selectedLanguage][selectedGender]
			? voiceMap[selectedLanguage][selectedGender]
			: "en-US-Neural2-F";

	// Convert speed to a number and bound it between 0.25 and 4.0 (Google's limits)
	const speakingRate = speed
		? Math.max(0.25, Math.min(4.0, parseFloat(speed)))
		: 1.0;

	try {
		const response = await fetch(
			`https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					input: { text },
					voice: {
						languageCode:
							selectedLanguage === "ja"
								? "ja-JP"
								: selectedLanguage === "es"
									? "es-ES"
									: "en-US",
						name: voiceName,
					},
					audioConfig: {
						audioEncoding: "MP3",
						speakingRate: speakingRate,
					},
				}),
			},
		);

		const data = await response.json();

		if (data.error) {
			console.error("Google API Error:", data.error);
			return res.status(500).json({ error: data.error.message });
		}

		// Return the base64 audio string to the frontend
		res.status(200).json({ audioContent: data.audioContent });
	} catch (err) {
		console.error("Server Crash:", err);
		res.status(500).json({ error: "Google TTS failed to respond" });
	}
}
