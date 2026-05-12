// ═════════════════════════════════════════════════════════════════════════
// [SHARED] Caption pattern classifier. Bucketing rules are intentionally
// shallow regex — the goal is "what hook is this post using" at a glance,
// not deep NLP. Order matters: the first matching pattern wins. Bilingual
// aware (English + Arabic + common transliteration).
// ═════════════════════════════════════════════════════════════════════════

const PATTERNS = [
  {
    key: 'price_deal',
    label: 'Price + Deal',
    tone: 'magenta',
    test: (s) => /\b\d{1,3}\s*%\s*(off|discount)?|خصم|\bsave\b|\bdeal\b|\boff\b\s+\d|\b(sar|aed|usd|kwd|qar)\s*\d/i.test(s)
              || /[\$£€]\s*\d/.test(s)
              || /\bريال\b|\bدرهم\b/.test(s),
  },
  {
    key: 'new_arrival',
    label: 'New Arrival',
    tone: 'ultra',
    test: (s) => /\b(new\s+arrival|just\s+dropped|just\s+in|now\s+available|launching)\b/i.test(s)
              || /وصل\s+حديث|جديد\s+لدينا|متوفر\s+الآن/.test(s),
  },
  {
    key: 'bnpl',
    label: 'Installment / BNPL',
    tone: 'lime',
    test: (s) => /\b(installment|0%\s*finance|tabby|tamara|spotii|postpay|afterpay|klarna)\b/i.test(s)
              || /تقسيط|بدون\s+فوائد/.test(s),
  },
  {
    key: 'seasonal',
    label: 'Seasonal',
    tone: 'amber',
    test: (s) => /\b(ramadan|eid|christmas|black\s*friday|white\s*friday|national\s*day|back\s*to\s*school|valentine|new\s*year|halloween|diwali)\b/i.test(s)
              || /رمضان|عيد|اليوم\s+الوطني|الجمعة\s+البيضاء|عودة\s+المدارس/.test(s),
  },
  {
    key: 'tutorial',
    label: 'Tutorial / How-to',
    tone: 'ultra',
    test: (s) => /\b(how\s+to|tutorial|step[-\s]?by[-\s]?step|guide|tips?)\b/i.test(s)
              || /كيف|طريقة|دليل|خطوات/.test(s),
  },
  {
    key: 'unboxing',
    label: 'Unboxing / Review',
    tone: 'ultra',
    test: (s) => /\b(unbox(?:ing)?|review|first\s+look|hands[-\s]?on|test)\b/i.test(s)
              || /مراجعة|تجربة|فتح\s+العلبة/.test(s),
  },
  {
    key: 'collab',
    label: 'Collab / Feature',
    tone: 'magenta',
    test: (s) => /\b(collab(oration)?|partnership|ft\.?|featuring|powered\s+by|x\b)\b/i.test(s)
              || /بالتعاون|شراكة/.test(s),
  },
  {
    key: 'cultural',
    label: 'Cultural',
    tone: 'lime',
    test: (s) => /#(saudi|ksa|uae|kuwait|qatar|bahrain|oman|jeddah|riyadh|dubai|abu\s*dhabi|heritage|tradition)\b/i.test(s)
              || /السعودي|الإمارات|الكويت|تراث|ثقافة|الوطن/.test(s),
  },
  {
    key: 'cta_app',
    label: 'App / CTA',
    tone: 'ultra',
    test: (s) => /\b(download|link\s+in\s+bio|swipe\s+up|shop\s+now|order\s+now|app\s+store|google\s+play)\b/i.test(s)
              || /حمّل|حمل\s+التطبيق|اطلب\s+الآن|اشتري\s+الآن/.test(s),
  },
  {
    key: 'humour',
    label: 'Humour',
    tone: 'magenta',
    // Multiple emojis OR exaggerated punctuation (a soft signal — placed last)
    test: (s) => (s.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length >= 2
              || /\b(lol|haha|😂|🤣|💀)\b/i.test(s),
  },
];

// Returns the first matching pattern, or a neutral fallback.
export function classifyCaption(caption) {
  const text = String(caption || '').trim();
  if (!text) return { key: 'plain', label: 'Plain post', tone: 'neutral' };
  for (const p of PATTERNS) {
    if (p.test(text)) return { key: p.key, label: p.label, tone: p.tone };
  }
  return { key: 'plain', label: 'Plain post', tone: 'neutral' };
}
