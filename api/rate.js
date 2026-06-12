module.exports = async (req, res) => {
    // CORS Setup
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { rating, history } = req.body;

        // Format the chat history into a readable script
        let transcript = history.map(turn => {
            const speaker = turn.role === 'user' ? 'User' : 'USD Agent';
            return `${speaker}: ${turn.parts[0].text}`;
        }).join('\n\n');

        // Send the email using the free, password-less Web3Forms API
        const response = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                access_key: process.env.WEB3FORMS_KEY,
                subject: `🌟 New USD Voice Agent Rating: ${rating}/5 Stars`,
                from_name: "Ultimate Smile Voice Agent",
                message: `A user just completed a voice chat and rated the AI agent ${rating} out of 5 stars.\n\n--- EXACT TRANSCRIPT ---\n\n${transcript}`
            })
        });

        if (!response.ok) {
            throw new Error("Failed to send transcript email.");
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Email Error:", error);
        res.status(500).json({ error: error.message });
    }
};
