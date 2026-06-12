const nodemailer = require('nodemailer');

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

        // Format the chat history into a nice readable script for your email
        let transcript = history.map(turn => {
            const speaker = turn.role === 'user' ? 'User' : 'USD Agent';
            return `**${speaker}:** ${turn.parts[0].text}`;
        }).join('\n\n');

        // Configure Nodemailer with Gmail
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'learnaiwithnik@gmail.com',
            subject: `🌟 New Chat Rating: ${rating}/5 Stars`,
            text: `A user just completed a voice chat and rated the AI agent ${rating} out of 5 stars.\n\nHere is the exact transcript of the conversation:\n\n${transcript}`
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Email Error:", error);
        res.status(500).json({ error: error.message });
    }
};
