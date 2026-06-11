const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

module.exports = async (req, res) => {
    // FIXED CORS: Dynamically allow the exact frontend URL requesting it
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle the preflight request instantly so the browser lets it through
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { userText, history } = req.body;

        // Connect securely using hidden environment variables
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 

        // 1. Convert user's words into AI Vectors
        const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
        const userVector = await embeddingModel.embedContent(userText);

        // 2. Search Pinecone for the 2 most relevant articles
        const searchResults = await index.query({
            vector: userVector.embedding.values,
            topK: 2,
            includeMetadata: true
        });

        let contextText = "No relevant articles found.";
        if (searchResults.matches && searchResults.matches.length > 0) {
            contextText = searchResults.matches.map(match => match.metadata.content).join("\n\n");
        }

        // 3. Send the Pinecone Articles + User Question to Gemini
        const chatModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const systemPrompt = `You are the official voice assistant for Ultimate Smile Design. 
Keep replies to 1 short sentence max. DETECT THE USER'S LANGUAGE: Reply in the exact language they used (English, Hindi, or Hinglish). 
Use the following facts from our website to answer the user's question accurately. If the answer is not in the facts, politely say you don't know and offer to connect them with the clinic.

COMPANY FACTS:
${contextText}`;

        const chat = chatModel.startChat({
            history: history || [],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        });

        const result = await chat.sendMessage(userText);
        const botReplyText = result.response.text();

        // 4. Send Gemini's answer to Sarvam for the Voice Output
        const sarvamResponse = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: [botReplyText],
                target_language_code: "hi-IN",
                speaker: "priya",
                model: "bulbul:v3"
            })
        });

        if (!sarvamResponse.ok) throw new Error("Sarvam Audio Engine Failed");
        const sarvamData = await sarvamResponse.json();

        // 5. Return both Text and Audio back to the frontend!
        res.status(200).json({ 
            replyText: botReplyText, 
            audioBase64: sarvamData.audios[0] 
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
};
