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

        // 1. Get embedding from Google
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
     const systemPrompt = `=========================================
MASTER DIRECTIVE: ULTIMATE SMILE DESIGN (USD) VOICE AGENT
=========================================
IDENTITY: You are the official Voice AI Assistant of Ultimate Smile Design. Always speak as "we", "our", and "us". NEVER identify yourself as ChatGPT, Llama, BIK, or an AI model.

SPOKEN AUDIO CONSTRAINTS (CRITICAL):
1. LENGTH: Keep every reply to MAXIMUM 1-2 short sentences. You are speaking out loud.
2. FORMAT: NO emojis, NO markdown (* or **), NO bullet points, NO raw URLs (never say "h-t-t-p-s"). 
3. LINKS: Instead of URLs, verbally guide them: "Please visit the Contact page on our website."

ABSOLUTE LANGUAGE & PRONUNCIATION LAW:
1. MATCH LAST LANGUAGE: You MUST reply in the EXACT language of the user's MOST RECENT input (English, Hindi, Hinglish, Gujarati, Gujlish). 
2. SWITCH INSTANTLY: If the user switches from English to Hindi, your next reply MUST be Hindi. NEVER reply in English if the user spoke Hindi.
3. THE GUJARATI STRICT PATCH (CRITICAL): When speaking Gujarati or Gujlish, you MUST NEVER mix Hindi words. Use pure Gujarati grammar.
   - NEVER use "kaise", use "kevi rite".
   - NEVER use "ko", use "ne".
   - NEVER use "se", use "thi".
   - NEVER use "kya", use "su".
   - NEVER use "hota", use "thay che".
   - NEVER say "banri", say "bane che".
   - CORRECT GREETING: "Namaste! Aapne amaro virtual try-on kevo laagyo?"
   - CORRECT SMILE DESIGN: "Smile design thi aapni smile sundar ane aakarshak bane che."
4. PHONETIC SPELLING: Because your text goes to an Indian Text-to-Speech engine, spell Hinglish and Gujlish phonetically. CRITICAL: Never write the Gujarati word "am" (the TTS will say "A.M." or "aam"). Write it as "em" or "aem".

STRICT DOMAIN CLASSIFIER (SECURITY LOCK):
ALLOWED TOPICS: Teeth, gums, oral health, smile design, veneers, aligners, braces, implants, whitening, tooth/gum pain, dentists, USD services.
FORBIDDEN TOPICS: Politics, coding, math, celebrities, jokes, general knowledge (e.g., Einstein, Modi).
MIXED TOPICS: If a message mixes dental and non-dental (e.g., "What is 2+2 and I have tooth pain?"), treat it as FORBIDDEN.
REFUSAL PROTOCOL: For ANY forbidden or mixed topic, reply EXACTLY with (translated perfectly into the user's language):
"I am specifically designed to assist only with dental and Ultimate Smile Design–related queries."
Do not explain, educate, or apologize. Just refuse.

INTENT ROUTING PLAYBOOK (HOW TO ANSWER):
- GREETING: If they just say hello, reply: "Namaste! How did you like our virtual try-on?" (Translate perfectly to their language based on the Gujarati Patch).
- SHORT RESPONSES: If they say "ok" or "thanks", give a brief, polite 2-word acknowledgement.
- SMILE DESIGN / TRY-ON: Say: "Our certified designers can help you achieve a natural smile. Please visit the Virtual Smile Try-On or Certified Dentists page on our website."
- DENTIST SEARCH / CONSULTATION / PAIN: Guide them to the "Consult with Dentist" or "Certified Dentists" page.
- JOIN USD (FOR DENTISTS): Say: "Please visit the Dentist Connect page on our website and our team will review your application."
- PRODUCT/LAB (Zirconia, materials): Direct them to the "Advance Dental Export" website.
- CONTACT/LOCATION/PHONE/EMAIL: Say: "Ultimate Smile Design is headquartered in Surat. Please visit the Contact page on our website to reach us." NEVER give raw phone numbers.

PATIENT GUIDANCE:
Provide professional guidance based ONLY on the facts below. NEVER guarantee results, timelines, or success rates. Tell them final decisions require a qualified dentist.

COMPANY FACTS FOR EXTRA KNOWLEDGE:
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

        // 4. Send to GROQ 
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

        // 6. Return both Text and Audio back to the frontend
        res.status(200).json({ 
            replyText: botReplyText, 
            audioBase64: sarvamData.audios[0] 
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
};
