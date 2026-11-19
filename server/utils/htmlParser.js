/**
 * Flexible HTML parser for Gemini-generated & custom JEE / CBT test files.
 * Extracts title, duration, question count, and subjects list.
 */
function parseCbtHtml(htmlContent, originalFilename = '') {
  let title = '';
  let durationMinutes = 180;
  let totalQuestions = 0;
  let subjects = [];
  let hasQuestionsArray = false;

  // 1. Extract Title
  const titleTagMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTagMatch && titleTagMatch[1]) {
    title = titleTagMatch[1].replace(/&amp;/g, '&').trim();
  }

  if (!title) {
    const h1Match = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      title = h1Match[1].replace(/&amp;/g, '&').trim();
    }
  }

  if (!title && originalFilename) {
    title = originalFilename
      .replace(/\.html$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
  }

  // 2. Extract Duration
  const durationSecMatch = htmlContent.match(/(?:TOTAL_DURATION_SEC|durationSec|totalSec)\s*=\s*(\d+)/i);
  if (durationSecMatch && durationSecMatch[1]) {
    const sec = parseInt(durationSecMatch[1], 10);
    if (!isNaN(sec) && sec > 0) {
      durationMinutes = Math.round(sec / 60);
    }
  } else {
    const durationMinMatch = htmlContent.match(/(\d+)\s*(?:Minutes|mins|min)/i);
    if (durationMinMatch && durationMinMatch[1]) {
      durationMinutes = parseInt(durationMinMatch[1], 10);
    }
  }

  // 3. Extract Subjects
  const subjectsArrayMatch = htmlContent.match(/(?:const|var|let)\s+SUBJECTS\s*=\s*(\[[^\]]+\])/i);
  if (subjectsArrayMatch && subjectsArrayMatch[1]) {
    try {
      subjects = JSON.parse(subjectsArrayMatch[1].replace(/'/g, '"'));
    } catch (e) {
      // fallback regex for strings in array
      const matches = subjectsArrayMatch[1].match(/['"]([^'"]+)['"]/g);
      if (matches) {
        subjects = matches.map(s => s.replace(/['"]/g, '').trim());
      }
    }
  }

  // 4. Extract Questions count & details
  // Look for QUESTIONS array
  const questionsRegex = /(?:const|var|let)\s+(?:QUESTIONS|questions|Questions)\s*=\s*(\[[\s\S]*?\])\s*;/;
  const qMatch = htmlContent.match(questionsRegex);

  if (qMatch && qMatch[1]) {
    try {
      // Fast count of question objects by "qid" or "num"
      const qidMatches = qMatch[1].match(/"qid"\s*:/g) || qMatch[1].match(/qid\s*:/g);
      if (qidMatches && qidMatches.length > 0) {
        totalQuestions = qidMatches.length;
        hasQuestionsArray = true;
      }

      // If subjects not found earlier, discover from subject fields
      if (subjects.length === 0) {
        const subMatches = [...qMatch[1].matchAll(/"subject"\s*:\s*"([^"]+)"/g)];
        if (subMatches.length > 0) {
          const subSet = new Set(subMatches.map(m => m[1].trim()));
          subjects = Array.from(subSet);
        }
      }
    } catch (err) {
      console.warn('Questions parsing warning:', err);
    }
  }

  // Fallback question count from badges or DOM patterns
  if (totalQuestions === 0) {
    const numMatches = htmlContent.match(/Question\s*(?:No\.?)?\s*(\d+)/gi);
    if (numMatches && numMatches.length > 0) {
      totalQuestions = numMatches.length;
    } else {
      const qCountMatch = htmlContent.match(/(\d+)\s*Questions/i);
      if (qCountMatch) {
        totalQuestions = parseInt(qCountMatch[1], 10);
      }
    }
  }

  // Default subjects if none detected
  if (subjects.length === 0) {
    subjects = ['General'];
  }

  return {
    title: title || 'Untitled CBT Test',
    durationMinutes: durationMinutes || 180,
    totalQuestions: totalQuestions || 75,
    subjects,
    hasQuestionsArray
  };
}

module.exports = { parseCbtHtml };
