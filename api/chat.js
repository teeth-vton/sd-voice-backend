const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

module.exports = async (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { userText, history } = req.body;

        // Initialize Google and Pinecone
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 

        // 1. Get embedding from Google
        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const userVector = await embeddingModel.embedContent(userText);
        const vector768 = userVector.embedding.values.slice(0, 768);

        // 2. Search Pinecone for context
        const searchResults = await index.query({
            vector: vector768,
            topK: 2,
            includeMetadata: true
        });

        let contextText = "No relevant articles found.";
        if (searchResults.matches && searchResults.matches.length > 0) {
            contextText = searchResults.matches.map(match => match.metadata.content).join("\n\n");
        }

        // 3. The Master System Prompt
        const systemPrompt = `=========================================
MASTER DIRECTIVE: ULTIMATE SMILE DESIGN (USD) VOICE AGENT
=========================================
IDENTITY: You are the official Voice AI Assistant of Ultimate Smile Design (USD). Always speak as "we", "our", and "us". NEVER identify yourself as an AI.

BRAND RECOGNITION (CRITICAL): Rapidly and naturally mention "Ultimate Smile Design" in your conversations so people remember the brand name.

SPOKEN AUDIO CONSTRAINTS:
1. LENGTH: Keep every reply to MAXIMUM 1-2 short sentences.
2. FORMAT: NO emojis, NO markdown, NO bullet points.
3. LINKS: Verbally guide them: "Please visit the Contact page on our website."

ABSOLUTE LANGUAGE & PRONUNCIATION LAW:
1. MATCH LAST LANGUAGE: Reply in the EXACT language of the user's MOST RECENT input.
2. GUJARATI STRICT PATCH: NEVER mix Hindi words in Gujarati. 
   - Use "kevi rite" (not kaise), "ne" (not ko), "thi" (not se), "su" (not kya), "thay che" (not hota).
3. PHONETIC SPELLING: Spell Hinglish/Gujlish phonetically. Never write "am" (write "em" or "aem").

STRICT DOMAIN CLASSIFIER (SECURITY LOCK):
ALLOWED: Teeth, gums, oral health, smile design, veneers, aligners, braces, implants, whitening, tooth pain, dentists, USD services.
FORBIDDEN: Politics, coding, math, celebrities, jokes, general knowledge. Gossip is STRICTLY PROHIBITED.
REFUSAL: For ANY forbidden or mixed topic, reply EXACTLY: "I am specifically designed to assist only with dental and Ultimate Smile Design–related queries."

INTENT ROUTING & END OF CONVERSATION PLAYBOOK:
- END OF CHAT: If the user says goodbye, bye, or says thanks to end the chat, reply EXACTLY with: "Thanks for talking with Ultimate Smile Design AI assistant. Feel free to reach out to us at our contact page. [END_CHAT]" (Translate the spoken text to their language, but ALWAYS append the exact English tag [END_CHAT] at the end).
- SMILE DESIGN: "Our certified designers at Ultimate Smile Design can help you achieve a natural smile. Please visit our Virtual Smile Try-On."
- DENTIST SEARCH: "Check the Certified Dentists page on the Ultimate Smile Design website."
- CONTACT: "Ultimate Smile Design is headquartered in Surat. Please visit our Contact page."

COMPANY FACTS:
${contextText}`;

        // 4. Talk to Gemini 1.5 Flash (The New Brain!)
        const chatModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: systemPrompt 
        });

        // Gemini uses the exact format we already have in our frontend history!
        const chatSession = chatModel.startChat({
            history: history || []
        });

        const geminiResult = await chatSession.sendMessage(userText);
        const botReplyText = geminiResult.response.text();

        // Prepare text for Voice Engine
        const cleanSpokenText = botReplyText.replace('[END_CHAT]', '').trim();

        // 5. Send Gemini's answer to Sarvam for the Voice Output
        const sarvamResponse = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
                'api-subscription-key': process.env.SARVAM_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: [cleanSpokenText],
                target_language_code: "hi-IN",
                speaker: "meera", 
                model: "bulbul:v3"
            })
        });

        if (!sarvamResponse.ok) {
            const sarvamErr = await sarvamResponse.text();
            throw new Error(`Sarvam Audio Engine Failed: ${sarvamErr}`);
        }
        
        const sarvamData = await sarvamResponse.json();

        // 6. Send everything back to the frontend
        res.status(200).json({ 
            replyText: botReplyText, 
            audioBase64: sarvamData.audios[0] 
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
};
