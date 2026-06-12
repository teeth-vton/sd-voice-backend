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

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 

        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const userVector = await embeddingModel.embedContent(userText);
        const vector768 = userVector.embedding.values.slice(0, 768);

        const searchResults = await index.query({
            vector: vector768,
            topK: 2,
            includeMetadata: true
        });

        let contextText = "No relevant articles found.";
        if (searchResults.matches && searchResults.matches.length > 0) {
            contextText = searchResults.matches.map(match => match.metadata.content).join("\n\n");
        }

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

        const groqMessages = [{ role: "system", content: systemPrompt }];
        if (history && history.length > 0) {
            history.forEach(h => {
                const role = h.role === 'model' ? 'assistant' : 'user';
                const content = h.parts[0].text;
                if (content) groqMessages.push({ role, content });
            });
        }
        if (userText) groqMessages.push({ role: "user", content: userText });

        // SWAPPED MODEL TO THE NEWEST, ACTIVE 70B MODEL
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

        // DETAILED ERROR LOGGING
        if (!groqResponse.ok) {
            const errText = await groqResponse.text();
            console.error("Groq Raw Error:", errText);
            throw new Error(`Groq API Error: ${errText}`);
        }

        const groqData = await groqResponse.json();
        const botReplyText = groqData.choices[0].message.content;

        const cleanSpokenText = botReplyText.replace('[END_CHAT]', '').trim();

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

        // DETAILED AUDIO ERROR LOGGING
        if (!sarvamResponse.ok) {
            const sarvamErr = await sarvamResponse.text();
            throw new Error(`Sarvam Audio Engine Failed: ${sarvamErr}`);
        }
        
        const sarvamData = await sarvamResponse.json();

        res.status(200).json({ 
            replyText: botReplyText, 
            audioBase64: sarvamData.audios[0] 
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
};
