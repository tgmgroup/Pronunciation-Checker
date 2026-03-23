// api/coach.js
export default async function handler(req, res) {
	if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

	const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
	const { audio, language, targetText } = JSON.parse(req.body);

	const prompt = `
        You are an expert language coach. 
        The student is practicing this text: "${targetText}"
        The language is: ${language}

        1. Transcribe the provided audio exactly.
        2. Compare it to the target text.
        3. Provide a brief, encouraging coaching tip (max 2 sentences).
        
        Return ONLY a JSON object: 
        {"transcript": "...", "feedback": "..."}
    `;

	try {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{ text: prompt },
								{ inline_data: { mime_type: "audio/webm", data: audio } },
							],
						},
					],
				}),
			},
		);

		const data = await response.json();
		// Extract the JSON string from Gemini's response and parse it
		const aiResponse = JSON.parse(data.candidates[0].content.parts[0].text);

		res.status(200).json(aiResponse);
	} catch (error) {
		console.error("Gemini Error:", error);
		res.status(500).json({ error: "Failed to process audio" });
	}
}
