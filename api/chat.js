const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

module.exports = async (req, res) => {
    // FIXED CORS
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { userText, history } = req.body;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 

        // 1. Get embedding from Google (this part still works perfectly)
        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const userVector = await embeddingModel.embedContent(userText);
        const vector768 = userVector.embedding.values.slice(0, 768);

        // 2. Search Pinecone
        const searchResults = await index.query({
            vector: vector768,
            topK: 2,
            includeMetadata: true
        });

        let contextText = "No relevant articles found.";
        if (searchResults.matches && searchResults.matches.length > 0) {
            contextText = searchResults.matches.map(match => match.metadata.content).join("\n\n");
        }

        // 3. Prepare the conversation for GROQ
        const systemPrompt = `You are the official voice assistant for Ultimate Smile Design. 
Keep replies to 1 short sentence max. DETECT THE USER'S LANGUAGE: Reply in the exact language they used (English, Hindi, or Hinglish). 
Use the following facts from our website to answer the user's question accurately. If the answer is not in the facts, politely say you don't know and offer to connect them with the clinic.

COMPANY FACTS:
${contextText}`;

        // Convert Google frontend history format to Groq format
        const groqMessages = [{ role: "system", content: systemPrompt }];
        if (history && history.length > 0) {
            history.forEach(h => {
                const role = h.role === 'model' ? 'assistant' : 'user';
                const content = h.parts[0].text;
                groqMessages.push({ role, content });
            });
        }
        // Add current user message
        groqMessages.push({ role: "user", content: userText });

        // 4. Send to GROQ (The new brain!)
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: groqMessages,
                max_tokens: 150
            })
        });

        if (!groqResponse.ok) {
            const errText = await groqResponse.text();
            throw new Error(`Groq API Error: ${errText}`);
        }

        const groqData = await groqResponse.json();
        const botReplyText = groqData.choices[0].message.content;

        // 5. Send Groq's answer to Sarvam for the Voice Output
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

        // 6. Return both Text and Audio back to the frontend!
        res.status(200).json({ 
            replyText: botReplyText, 
            audioBase64: sarvamData.audios[0] 
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
};
