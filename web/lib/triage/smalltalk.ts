/**
 * Greetings, thanks and other small talk in the five languages. A message made only of these words is not a request for care, so the app
 * answers it and asks what is wrong instead of showing hospitals. It never matches a message that also names a symptom or a service.
 */
const WORDS = new Set([
  // English and Hinglish
  "hello", "hi", "hii", "hiii", "hey", "heyy", "helo", "hallo", "yo", "good", "morning", "afternoon", "evening", "night", "there", "namaste", "namaskar", "namaskaram", "vanakkam", "ok", "okay", "k",
  "thanks", "thank", "you", "thankyou", "thx", "ty", "bye", "goodbye", "cheers", "please", "test", "testing", "hmm", "nevermind", "never", "mind", "great", "cool", "nice",
  "shukriya", "dhanyavad", "nandri", "dhanyavaad", "ji", "sir", "madam", "bhai", "anna", "all", "right", "alright", "welcome", "how", "are", "doing",
  // Hindi
  "हैलो", "हेलो", "हाय", "नमस्ते", "नमस्कार", "धन्यवाद", "शुक्रिया", "ठीक", "है", "अच्छा", "ओके", "जी", "सुप्रभात", "शुभ", "रात्रि", "अलविदा",
  // Tamil
  "வணக்கம்", "ஹலோ", "ஹாய்", "நன்றி", "சரி", "ஓகே", "காலை", "மாலை", "இரவு", "வருகிறேன்",
  // Telugu
  "నమస్కారం", "నమస్తే", "హలో", "హాయ్", "ధన్యవాదాలు", "సరే", "ఓకే", "శుభోదయం", "శుభ", "రాత్రి",
  // Malayalam
  "നമസ്കാരം", "ഹലോ", "ഹായ്", "നന്ദി", "ശരി", "ഓക്കേ", "സുപ്രഭാതം", "ശുഭ", "രാത്രി",
]);

export function isSmallTalk(text: string): boolean {
  const tokens = (text ?? "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 6) return false;
  return tokens.every((w) => WORDS.has(w));
}

/** Words that mean the person is asking for a place of care. Such a message is never small talk, whatever the model thinks. */
const PLACE_OF_CARE = /hospital|clinic|doctor|physician|dispensary|nursing home|health cent|medical cent|pharmacy|chemist|ambulance|emergency room|phc|अस्पताल|क्लिनिक|डॉक्टर|दवाखाना|अस्पताल|மருத்துவமனை|கிளினிக்|மருத்துவர்|டாக்டர்|ఆసుపత్రి|క్లినిక్|డాక్టర్|వైద్యుడు|ആശുപത്രി|ക്ലിനിക്|ഡോക്ടർ/iu;
const ABOUT_THE_APP = /\b(?:are|r)\s+(?:you|u)\b.{0,14}\b(?:doctor|physician|hospital|clinic|nurse|human|real|a\s+bot)\b/iu;   // "are you a doctor?" is a question about the app
export const isAboutTheApp = (text: string) => ABOUT_THE_APP.test((text ?? "").normalize("NFC"));
export const asksForPlaceOfCare = (text: string) => { const t = (text ?? "").normalize("NFC"); return PLACE_OF_CARE.test(t) && !ABOUT_THE_APP.test(t); };

/** Asking the app for medicine, a dose, a diagnosis or a home remedy. The app never gives these; it says so, and still helps find a doctor. */
const ADVICE = /\b(?:dose|dosage|\d+\s?mg|tablets?|pills?|medicines?|medications?|antibiotics?|painkillers?|prescri(?:be|ption)|home\s+remed(?:y|ies)|cure\s+for|diagnos(?:e|is)|what(?:'s|\s+is)\s+wrong\s+with\s+me|do\s+i\s+have|should\s+i\s+take|can\s+i\s+(?:stop|take|give|skip)|how\s+(?:do\s+i\s+|to\s+|can\s+i\s+)?treat|treat\s+(?:it\s+)?at\s+home)\b/iu;
export const asksForAdvice = (text: string) => ADVICE.test((text ?? "").normalize("NFC"));
