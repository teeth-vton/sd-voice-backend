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
        const { userText, history, type, text, audioBase64, audioExt } = req.body;

        if (type === 'tts') {
            const sarvamResponse = await fetch('https://api.sarvam.ai/text-to-speech', {
                method: 'POST',
                headers: {
                    'api-subscription-key': process.env.SARVAM_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: [text],
                    target_language_code: "hi-IN",
                    speaker: "shreya",
                    model: "bulbul:v3",
                    speech_sample_rate: 8000,
                    pace: 1.0 
                })
            });

            if (!sarvamResponse.ok) {
                const sarvamErr = await sarvamResponse.text();
                throw new Error(`Sarvam Audio Engine Failed: ${sarvamErr}`);
            }
            
            const sarvamData = await sarvamResponse.json();
            return res.status(200).json({ audioBase64: sarvamData.audios[0] });
        }

        let finalTextToProcess = userText; 
        let whisperError = null;

        if (audioBase64) {
            try {
                const safeExt = audioExt || 'webm'; 
                const buffer = Buffer.from(audioBase64, 'base64');
                const blob = new Blob([buffer], { type: `audio/${safeExt}` });
                const formData = new FormData();
                formData.append('file', blob, `audio.${safeExt}`);
                formData.append('model', 'whisper-large-v3-turbo'); 
                
                // FIXED: Ban Whisper from hallucinating English and Prime it for Indian Languages
                formData.append('temperature', '0.0'); 
                formData.append('prompt', 'Hello, namaste, kem cho. Tumhara naam kya hai? I want smile design.'); 
                
                const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
                    body: formData
                });

                if (whisperRes.ok) {
                    const whisperData = await whisperRes.json();
                    if (whisperData.text && whisperData.text.trim()) {
                        const tText = whisperData.text.trim();
                        // WHISPER SILENCE BUG GUARD
                        if (tText.toLowerCase() === 'foreign' || tText.toLowerCase() === 'foreign.' || tText.toLowerCase() === 'thank you' || tText.toLowerCase() === 'thank you.' || tText.toLowerCase() === 'subtitles by amara' || tText.toLowerCase() === 'the water to land gather' || tText.toLowerCase() === 'the water to land gather.') {
                            console.log("Whisper silence bug detected. Falling back to browser text.");
                        } else {
                            finalTextToProcess = tText;
                        }
                    }
                } else {
                    whisperError = await whisperRes.text();
                    console.error("Whisper API Error:", whisperError);
                }
            } catch (e) { 
                whisperError = e.message;
                console.error("Whisper processing failed:", e); 
            }
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 

        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const userVector = await embeddingModel.embedContent(finalTextToProcess);
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
IDENTITY: You are the official Voice AI Assistant of Ultimate Smile Design (USD). Always speak as "we", "our", and "us". NEVER identify yourself as ChatGPT, AI model, BIK, or any third-party platform. If asked who you are, say: "We are the support assistant of Ultimate Smile Design."

BRAND RECOGNITION (CRITICAL): Rapidly and naturally mention "Ultimate Smile Design" in your conversations so people remember the brand name.

SPOKEN AUDIO CONSTRAINTS (CRITICAL):
1. LENGTH: Keep every reply to MAXIMUM 1-2 short sentences. You are speaking on a live voice call.
2. FORMAT: NO emojis, NO markdown, NO bullet points.
3. LINKS: NEVER speak raw URLs. Verbally guide them to website pages instead (e.g., "visit our Contact page").

STRICT DOMAIN CLASSIFIER (MANDATORY & DOUBLE-LOCKED):
Before answering ANY voice input, determine whether the user's spoken words are primarily related to: teeth, tooth, gums, oral health, dental care, smile design, cosmetic dentistry, veneers, aligners, braces, implants, whitening, tooth pain, gum pain, bleeding gums, missing/crooked teeth, tooth gap, smile makeover, dentists, dental consultation, or Ultimate Smile Design services.

If NOT related to these topics, reply ONLY:
"I am specifically designed to assist only with dental and Ultimate Smile Design–related queries."

DOMAIN VALIDATION RULE:
If a voice input contains BOTH dental and non-dental topics, do NOT answer only the dental portion. Determine the PRIMARY intent. If there is any ambiguity, treat the input as non-dental and reply ONLY with the refusal sentence above. 
Examples that MUST be refused: Einstein, Narendra Modi, Capital cities, Mathematics, Coding, Jokes, Celebrities, Sports, Movies, Business, Finance, Religion, Politics.

ABSOLUTE LANGUAGE & PRONUNCIATION LAW (SARVAM VOICE ENGINE OPTIMIZED):
1. MATCH LAST LANGUAGE: Always use ONLY the language from the user's most recent spoken input. Ignore the language used in previous turns. If the user changes language, switch instantly. 
2. PHONETIC CROSS-TRANSLATION (CRITICAL): Our speech-to-text engine writes English words using Devanagari (Hindi) script. If you read English words written in Hindi letters (e.g., "व्हाट इज स्माइल डिजाइन" or "यू कैन हेल्प यू"), YOU MUST RECOGNIZE IT IS ENGLISH AND REPLY IN PURE ENGLISH. 
3. GUJARATI STRICT PATCH: NEVER mix Hindi words in Gujarati. Use "kevi rite" (not kaise), "ne" (not ko), "thi" (not se), "su" (not kya), "thay che" (not hota), "bane che" (not banri).
4. PHONETIC SPELLING: Because your text goes to an Indian Text-to-Speech engine, spell Hinglish and Gujlish phonetically. CRITICAL: Never write the Gujarati word "am" (the TTS will say "A.M." or "aam"). Write it as "em" or "aem".

PATIENT & DENTIST GUIDANCE:
Provide simple and professional spoken guidance. Never guarantee results, timelines, or success rates. Make it clear that final decisions require a qualified dentist.

INTENT ROUTING & VOICE PLAYBOOK (HOW TO ANSWER):
- END OF CHAT (CRITICAL): If the user says words like "bye", "tata", "goodbye", "chalta hu", "chalti hu", "thanks", "shukriya", "aabhar", or clearly wants to end the call, reply EXACTLY with: "Thanks for talking with Ultimate Smile Design AI assistant. Feel free to reach out to us at our contact page. [END_CHAT]" (Translate the spoken text to their language, but ALWAYS append the exact English tag [END_CHAT] at the end of the string).
- SHORT RESPONSES: If the user says OK or Okay, reply with a short spoken acknowledgement in their language.
- SMILE DESIGN: Detect their language and say: "Thank you for your interest in Smile Design. Our certified Ultimate Smile Designers provide advanced solutions to help you achieve a natural smile. You can find your nearest certified smile designer on the Certified Dentists page of our website."
- VIRTUAL SMILE TRY-ON: Explain they can preview improvements and say: "Please visit the Virtual Smile Try-On page on our website."
- DENTIST SEARCH: "Check the Certified Dentists page on the Ultimate Smile Design website."
- CONSULTATION (Veneers, pain, gaps): "You can schedule a conversation on the Consult with Dentist page on our website."
- JOIN USD (Dentist Collaboration): "Please visit the Dentist Connect page on our website. Our team will review your application."
- PRODUCT / LAB QUERIES (Zirconia, materials): "Please visit the Advance Dental Export website."
- CONTACT REQUESTS (ABSOLUTE RULE): If they ask for phone, mobile, WhatsApp, or email, NEVER provide numbers or emails. Reply ONLY: "Please visit the Contact page on our website to get in touch with us."
- ADDRESS: "Ultimate Smile Design is headquartered in Surat and works with certified dentists across India. You can view locations on our Certified Dentists page."
- ATTACHMENTS (Images/Voice notes): "Please feel free to contact us on our website's Contact page."

COMPANY FACTS FOR EXTRA KNOWLEDGE:
${contextText}`;

        const groqMessages = [{ role: "system", content: systemPrompt }];
        if (history && history.length > 0) {
            history.forEach(h => {
                const role = h.role === 'model' ? 'assistant' : 'user';
                const content = h.parts[0].text;
                if (content) groqMessages.push({ role, content });
            });
        }
        if (finalTextToProcess) groqMessages.push({ role: "user", content: finalTextToProcess });

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
                speaker: "shreya", 
                model: "bulbul:v3",
                speech_sample_rate: 8000, 
                pace: 1.0 
            })
        });

        if (!sarvamResponse.ok) {
            const sarvamErr = await sarvamResponse.text();
            throw new Error(`Sarvam Audio Engine Failed: ${sarvamErr}`);
        }
        
        const sarvamData = await sarvamResponse.json();

        res.status(200).json({ 
            replyText: botReplyText, 
            audioBase64: sarvamData.audios[0],
            transcribedText: finalTextToProcess, // Shows exactly what Whisper heard!
            whisperError: whisperError // Exposes any formatting errors directly to UI
        });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
};
