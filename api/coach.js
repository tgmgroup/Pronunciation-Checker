import fetch from "node-fetch";

export default async function handler(req, res) {
	// 1. CORS Headers
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");

	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method Not Allowed" });
	}

	const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

	try {
		const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
		const { audio, language, targetText, mode } = body;

		if (!audio) {
			return res.status(400).json({ error: "No audio data provided" });
		}

		const base64Data = audio.includes(",") ? audio.split(",")[1] : audio;
		const isDeepAnalysis = mode === "deep_analysis";

		// --- DYNAMIC PROMPT UPDATED FOR BILINGUAL SUPPORT ---
		const prompt = `
            You are an expert language coach for ${language}. 
            The beginner English language student is practicing this text: "${targetText}"

            Tasks:
            1. Transcribe the student's audio exactly.
            2. Provide a coaching tip in the target language (${language}).
            3. Provide a translation of that coaching tip into the student's native language. 
               (If the target language is English, translate to Japanese/Spanish based on context. 
                If the user language is ${language}, provide English as the translation).
            ${
							isDeepAnalysis
								? `
            4. Analyze the INTONATION, RHYTHM, and FLOW. 
            5. Provide an "intonation_score" from 0 to 100 based on rhythm and stress.
            `
								: `4. Focus primarily on basic word pronunciation.`
						}

            Return ONLY a valid JSON object: 
            {
                "transcript": "exact transcription", 
                "feedback": "your coaching tip in ${language}",
                "feedback_translated": "translation of the coaching tip",
                "intonation_score": ${isDeepAnalysis ? "number" : "null"}
            }
        `;

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{ text: prompt },
								{ inline_data: { mime_type: "audio/webm", data: base64Data } },
							],
						},
					],
					generationConfig: {
						response_mime_type: "application/json",
					},
				}),
			},
		);

		const data = await response.json();

		if (data.error) {
			console.error("Gemini API Error:", data.error);
			return res.status(500).json({ error: data.error.message });
		}

		if (!data.candidates || !data.candidates[0].content) {
			throw new Error("Invalid response from Gemini API");
		}

		const rawText = data.candidates[0].content.parts[0].text;

		// Gemini's JSON mode is usually very clean, but we strip backticks just in case
		const cleanJson = rawText.replace(/```json|```/g, "").trim();
		const aiResponse = JSON.parse(cleanJson);

		res.status(200).json(aiResponse);
	} catch (error) {
		console.error("Coach Server Error:", error);
		res.status(500).json({
			error: "Failed to process audio",
			details: error.message,
			transcript: "",
			feedback:
				"The AI Coach is having trouble analyzing the audio. Ensure your mic is clear!",
		});
	}
}
