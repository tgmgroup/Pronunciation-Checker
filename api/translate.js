// api/translate.js
export default async function handler(req, res) {
	const { text, sourceLang = "en", targetLang = "ja" } = req.query;

	if (!text) {
		return res.status(400).json({ error: "Text is required" });
	}

	// This is hidden from the user
	const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

	// Debug: console.log("Targeting URL:", GOOGLE_SCRIPT_URL); // Check Vercel logs for this!

	if (!GOOGLE_SCRIPT_URL) {
		return res.status(500).json({ error: "Server configuration missing" });
	}

	try {
		//const apiUrl = `${GOOGLE_SCRIPT_URL}?text=${encodeURIComponent(text)}&sourceLang=${sourceLang}&targetLang=${targetLang}`;
		const apiUrl = `${GOOGLE_SCRIPT_URL}?text=${encodeURIComponent(text)}&sourceLang=${sourceLang}&targetLang=ja`; // default to JA for now

		const response = await fetch(apiUrl);
		const data = await response.json();

		// Return the data to your frontend
		res.status(200).json(data);
	} catch (error) {
		console.error("Translation Proxy Error:", error);
		res.status(500).json({ error: "Failed to fetch translation" });
	}
}
