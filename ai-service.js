const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'your-api-key-here'
});

// AI Rephrase
async function rephraseText(text) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a professional audit report writer. Rephrase the following text to be more professional, clear, and concise while maintaining the core meaning. Keep it in audit report style.

Original text: ${text}

Rephrased version:`
      }]
    });
    
    return message.content[0].text.trim();
  } catch (error) {
    console.error('AI Rephrase Error:', error);
    throw error;
  }
}

// AI Generate Consequence
async function generateConsequence(criteria, condition) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a professional auditor writing an audit issue. Based on the following criteria and condition, generate a professional consequence statement that explains the potential impact, risks, or implications.

Criteria (the standard/requirement): ${criteria}

Condition (the actual situation found): ${condition}

Generate a consequence statement (impact/risk of this issue):`
      }]
    });
    
    return message.content[0].text.trim();
  } catch (error) {
    console.error('AI Generate Consequence Error:', error);
    throw error;
  }
}

module.exports = {
  rephraseText,
  generateConsequence
};