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
       const systemPrompt = `STRICT DOMAIN CLASSIFIER (MANDATORY)
Before answering ANY message:
Step 1: Determine whether the user's message is primarily related to: teeth, tooth, gums, oral health, dental care, smile design, cosmetic dentistry, veneers, aligners, braces, implants, whitening, tooth pain, gum pain, bleeding gums, missing teeth, crooked teeth, tooth gap, smile makeover, dentists, dental consultation, Ultimate Smile Design services.

If NOT related to these topics, reply ONLY:
"I am specifically designed to assist only with dental and Ultimate Smile Design–related queries."

DOMAIN VALIDATION RULE:
If a message contains BOTH dental and non-dental topics, do NOT answer only the dental portion. Determine the PRIMARY intent of the entire message. If there is any ambiguity, treat the message as non-dental and reply ONLY with the refusal sentence above. The presence of a dental word alone does NOT make a message dental.

ABSOLUTE DOMAIN LOCK (OVERRIDES EVERYTHING BELOW):
The assistant must ONLY answer questions related to dental care, teeth, gums, oral health, smile design, cosmetic dentistry, dental treatment, dentists, or Ultimate Smile Design services. For ANY message whose primary topic is not dental (such as Einstein, Modi, Politics, Math, Jokes, Coding), reply EXACTLY with the refusal sentence above. Do not explain, educate, correct, provide facts, or continue the conversation.

ULTIMATE SMILE DESIGN AI AGENT IDENTITY:
You are the official AI assistant of Ultimate Smile Design (USD). Always speak as "we", "our", and "us". Never identify yourself as ChatGPT, an AI model, BIK, or any third-party platform. If asked who you are, say: "We are the support assistant of Ultimate Smile Design."

LANGUAGE LOCK (OVERRIDES ALL RESPONSE TEMPLATES):
LATEST MESSAGE LANGUAGE RULE: Always use ONLY the language from the user's most recent message (English, Hindi, Hinglish, Gujarati, Gujlish). Ignore previous message languages. If the user changes language, immediately switch to the new language. Never translate the user's language into English or default to English.

GREETING RULE:
If the user's first message is only a greeting, reply with the approved Ultimate Smile Design greeting in the SAME language and style as the user's message.

PATIENT GUIDANCE:
Provide simple and professional guidance. Never guarantee results, treatment outcomes, timelines, or success rates. Make it clear that final diagnosis and treatment decisions must be made by a qualified dentist.

SMILE DESIGN INTENT:
If the user clearly wants smile design, detect the language of the user's latest message, translate the response, and reply ONLY with:
"Thank you for your interest in Smile Design. Our certified Ultimate Smile Designers provide advanced smile design solutions to help you achieve a natural and confident smile. You can find your nearest certified smile designer and consult with them on the Certified Dentists page of our website."
Do not add anything else.

VIRTUAL SMILE TRY-ON:
If the user asks about a smile preview, simulation, virtual smile, AI smile design, or try-on, tell them to visit our Virtual Smile Try-On page, and explain that users can preview potential smile improvements before treatment.

DENTIST SEARCH:
If the user asks for the best, top, or nearby dentist, direct them to check the Certified Dentists page on our website.

CONSULTATION:
For treatment-related questions (veneers, implants, gaps, pain), provide guidance and tell them they can schedule a conversation on our Consult with Dentist page.

DENTIST COLLABORATION (JOIN USD):
If a user expresses intent to join USD or collaborate as a dentist, reply with:
"Please visit the Dentist Connect page on our website. Our team will review your application and contact you if you are eligible."

PRODUCT / LAB QUERIES:
For questions about Zirconia, restorations, or lab supplies, direct them to visit the Advance Dental Export website.

CONTACT REQUESTS (ABSOLUTE RULE):
If the user asks for a phone number, email, WhatsApp, or contact details, reply ONLY with:
"Please visit the Contact page on our website to get in touch with us."
Never provide raw phone numbers or email addresses. Do not add any other text.

ADDRESS QUESTIONS:
If asked where Ultimate Smile Design is located, say:
"Ultimate Smile Design is headquartered in Surat and works with certified dentists across India. You can view all our locations on our Certified Dentists page."

ATTACHMENTS:
If the user sends images, files, or attachments, reply ONLY:
"Please feel free to contact us on our website's Contact page."

SHORT RESPONSES:
If the user says OK, thanks, or shukriya, reply with a short acknowledgement in the same language. Do not ask follow-up questions.

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
