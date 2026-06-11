const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

module.exports = async (req, res) => {
    // Enable CORS so your browser console can talk directly to this backend script
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Grab the articles directly from the body of the web request
        const { articles } = req.body;
        
        if (!articles || !Array.isArray(articles)) {
            return res.status(400).json({ success: false, error: "No articles array provided." });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 
        
        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        let uploadedCount = 0;

        for (const article of articles) {
            if (!article.text || article.text.trim() === "") continue; 
            
            const result = await embeddingModel.embedContent(article.text);
            const vector768 = result.embedding.values.slice(0, 768);
            
            await index.upsert([{
                id: article.id.toString(),
                values: vector768,
                metadata: {
                    title: article.title || "Blog Post",
                    content: article.text
                }
            }]);
            uploadedCount++;
        }

        res.status(200).json({ 
            success: true, 
            message: `🎉 Successfully uploaded ${uploadedCount} articles straight to Pinecone!` 
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
