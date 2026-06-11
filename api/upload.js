const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

// PASTE YOUR COPIED JSON ARRAY HERE:
const myArticles = [
  {
    "id": "article-0",
    "title": "Example",
    "text": "Replace this whole array with your copied JSON..."
  }
];

module.exports = async (req, res) => {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        const index = pc.index("usd-articles"); 
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

        let uploadedCount = 0;

        for (const article of myArticles) {
            // Skip empty text
            if (!article.text) continue; 
            
            // Convert text to AI Vectors
            const result = await embeddingModel.embedContent(article.text);
            
            // Upload to Pinecone database
            await index.upsert([{
                id: article.id.toString(),
                values: result.embedding.values,
                metadata: {
                    title: article.title || "Blog Post",
                    content: article.text
                }
            }]);
            uploadedCount++;
        }

        res.status(200).json({ 
            success: true, 
            message: `🎉 Successfully uploaded ${uploadedCount} articles to Pinecone!` 
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
